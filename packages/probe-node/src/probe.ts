import { createHash, randomUUID } from "crypto";
import dns from "dns/promises";
import net from "net";
import { ProbeResult, BlockType } from "@resist/shared/src/types";

// Ordered list of well-known open resolvers used as baseline references.
// In heavily censored networks (GFW, Iran) individual resolvers may be blocked;
// we try each in order and use the first that responds so we don't return a
// false-negative {poisoned:false} just because 8.8.8.8 is unreachable.
const BASELINE_DNS_SERVERS = ["8.8.8.8", "1.1.1.1", "9.9.9.9"];
const TARGETS = [
  "https://twitter.com",
  "https://instagram.com",
  "https://youtube.com",
  "https://wikipedia.org",
  "https://signal.org",
];

async function httpCheck(url: string): Promise<{ reachable: boolean; status: number | null; ms: number | null }> {
  const start = Date.now();
  try {
    // redirect:'manual' prevents fetch from auto-following 3xx responses.
    // A censor intercepting probe traffic could otherwise issue a 302 to an
    // RFC-1918 URL, causing the probe node to reach internal network services.
    const res = await fetch(url, {
      signal: AbortSignal.timeout(8000),
      redirect: "manual",
    });
    // Treat redirect as blocked/censored — censors commonly redirect blocked
    // content to captive-portal or block pages; real servers serve content directly.
    if (res.status >= 300 && res.status < 400) {
      return { reachable: false, status: res.status, ms: Date.now() - start };
    }
    // Only 2xx is truly reachable — 4xx (403, 451) signals HTTP-level censorship
    return { reachable: res.status >= 200 && res.status < 300, status: res.status, ms: Date.now() - start };
  } catch {
    return { reachable: false, status: null, ms: null };
  }
}

function withDnsTimeout<T>(p: Promise<T>, ms = 5000): Promise<T> {
  let timer: ReturnType<typeof setTimeout>
  const timeout = new Promise<T>((_, reject) => {
    timer = setTimeout(() => reject(new Error("DNS timeout")), ms)
  })
  return Promise.race([
    p.finally(() => clearTimeout(timer)),
    timeout,
  ])
}

async function dnsCheck(domain: string): Promise<{ expected: string | null; received: string | null; poisoned: boolean }> {
  let expected: string | null = null;
  // Query baseline resolvers sequentially with early exit — avoids opening up to
  // 4 resolver × 5 target = 20 concurrent DNS sockets on mobile networks where
  // socket limits are low. Each resolver gets a 2s window before falling through
  // to the next; on a well-connected network the first resolver answers in <50ms.
  for (const server of BASELINE_DNS_SERVERS) {
    try {
      const r = new dns.Resolver();
      r.setServers([server]);
      const addrs = await withDnsTimeout(r.resolve4(domain), 2000);
      if (addrs.length > 0) {
        expected = addrs[0] ?? null;
        break;
      }
    } catch {
      // Resolver unreachable or timed out — try next
    }
  }
  if (expected === null) {
    // All resolvers failed — cannot establish baseline reference.
    return { expected: null, received: null, poisoned: false };
  }
  if (expected === null) {
    return { expected: null, received: null, poisoned: false };
  }

  try {
    const local = new dns.Resolver();
    const [received] = await withDnsTimeout(local.resolve4(domain));
    return { expected, received: received ?? null, poisoned: expected !== received };
  } catch {
    // Local resolver failed but baseline succeeded — treat as poisoned/blocked
    return { expected, received: null, poisoned: true };
  }
}

async function tcpCheck(host: string, port = 443): Promise<{ connected: boolean; rstInjected: boolean; ms: number | null }> {
  return new Promise((resolve) => {
    const start = Date.now();
    const sock = net.connect({ host, port, timeout: 5000 });
    sock.on("connect", () => { sock.destroy(); resolve({ connected: true, rstInjected: false, ms: Date.now() - start }); });
    // timeout fires when connect stalls (no SYN-ACK) — must destroy to trigger 'error'
    sock.on("timeout", () => sock.destroy(new Error("connect timeout")));
    sock.on("error", (e: NodeJS.ErrnoException) => {
      resolve({ connected: false, rstInjected: e.code === "ECONNRESET", ms: Date.now() - start });
    });
  });
}

function classifyBlock(
  httpReachable: boolean,
  dnsPoisoned: boolean,
  tcpConnected: boolean,
  tcpRst: boolean
): BlockType | null {
  if (!httpReachable && !tcpConnected && !dnsPoisoned && !tcpRst) return "full_unreachable"
  if (dnsPoisoned) return "dns_poisoning"
  if (tcpRst) return "tcp_rst"
  if (!httpReachable) return "http_block"
  return null
}

async function probeTarget(url: string, config: { wallet: string; geohash: string; isp: string; prevHash: string }): Promise<ProbeResult> {
  const domain = new URL(url).hostname;
  const [httpRes, dnsRes, tcpRes] = await Promise.all([
    httpCheck(url),
    dnsCheck(domain),
    tcpCheck(domain),
  ]);

  const blockType = classifyBlock(httpRes.reachable, dnsRes.poisoned, tcpRes.connected, tcpRes.rstInjected);
  return {
    id: randomUUID(),
    nodeWallet: config.wallet,
    targetUrl: url,
    timestamp: Date.now(),
    reachable: httpRes.reachable,
    blockType,
    httpStatus: httpRes.status,
    responseTimeMs: httpRes.ms,
    dnsExpected: dnsRes.expected,
    dnsReceived: dnsRes.received,
    dnsPoisoned: dnsRes.poisoned,
    tcpConnected: tcpRes.connected,
    tcpRstInjected: tcpRes.rstInjected,
    geohash: config.geohash,
    isp: config.isp,
    networkType: "unknown",
    prevResultHash: config.prevHash,
  };
}

export async function runProbe(config: { wallet: string; geohash: string; isp: string; prevHash: string }): Promise<{ results: ProbeResult[]; finalHash: string }> {
  // Run all 5 targets in parallel — reduces worst-case total time from
  // O(N × max_timeout) ≈ 40s to O(max_timeout) ≈ 8s on heavily-censored networks.
  const settled = await Promise.allSettled(TARGETS.map(url => probeTarget(url, config)));
  const results: ProbeResult[] = settled
    .filter((r): r is PromiseFulfilledResult<ProbeResult> => r.status === "fulfilled")
    .map(r => r.value);

  // Recompute the tamper-evidence hash chain over the collected results.
  // Sort by targetUrl for deterministic ordering (parallel execution does not
  // guarantee insertion order). Hash only stable, immutable fields.
  results.sort((a, b) => a.targetUrl.localeCompare(b.targetUrl));
  let prevHash = config.prevHash;
  for (const result of results) {
    const hash = createHash("sha256")
      .update(`${result.id}:${result.timestamp}:${result.blockType ?? ""}:${prevHash}`)
      .digest("hex");
    result.prevResultHash = prevHash;
    prevHash = hash;
  }

  return { results, finalHash: prevHash };
}
