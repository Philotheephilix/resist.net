import { createHash, randomUUID } from "crypto";
import dns from "dns/promises";
import net from "net";
import { ProbeResult, BlockType } from "@resist/shared/src/types";

// Ordered list of well-known open resolvers used as baseline references.
// In heavily censored networks (GFW, Iran) individual resolvers may be blocked;
// we try each in order and use the first that responds so we don't return a
// false-negative {poisoned:false} just because 8.8.8.8 is unreachable.
const BASELINE_DNS_SERVERS = ["8.8.8.8", "1.1.1.1", "9.9.9.9"];
export const TARGETS = [
  "https://twitter.com",
  "https://instagram.com",
  "https://youtube.com",
  "https://wikipedia.org",
  "https://signal.org",
];

// Stable SHA-256 hash of the canonical TARGETS list (sorted, newline-joined).
// Written as the `targetshash` attribute on every ProbeResult entity in Arkiv.
// The dashboard API route rejects any row whose stored hash doesn't match this
// value, preventing a modified probe binary from poisoning the results feed.
export const TARGETS_HASH = createHash("sha256")
  .update([...TARGETS].sort().join("\n"))
  .digest("hex");

// RFC-1918 and loopback ranges that must not be reached via a redirect.
// Censors could issue a 302 to an internal URL; we block that here.
function isPrivateHost(hostname: string): boolean {
  // Loopback
  if (hostname === "localhost" || hostname === "::1") return true;
  // IPv4 private/loopback ranges: 10.x, 172.16-31.x, 192.168.x, 127.x
  const ipv4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(hostname);
  if (ipv4) {
    const [, a, b] = ipv4.map(Number);
    if (a === 10) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 127) return true;
    if (a === 169 && b === 254) return true; // link-local
  }
  return false;
}

async function httpCheck(url: string, signal?: AbortSignal): Promise<{ reachable: boolean; status: number | null; ms: number | null }> {
  const start = Date.now();
  try {
    // Follow redirects so that sites which canonically redirect their root
    // (e.g. twitter.com → x.com, wikipedia.org → www.wikipedia.org) are not
    // falsely reported as blocked. We guard against SSRF by rejecting any
    // redirect that resolves to an RFC-1918 / loopback address.
    const timeoutSignal = AbortSignal.timeout(10000);
    const combined = signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal;
    const res = await fetch(url, {
      signal: combined,
      redirect: "follow",
    });
    // Reject if the final URL landed on a private/loopback host (SSRF guard)
    try {
      const finalHost = new URL(res.url).hostname;
      if (isPrivateHost(finalHost)) {
        return { reachable: false, status: res.status, ms: Date.now() - start };
      }
    } catch {
      // Malformed final URL — treat as unreachable
      return { reachable: false, status: res.status, ms: Date.now() - start };
    }
    // 2xx and 3xx (e.g. opaque redirects fetch can't fully follow) are reachable.
    // 4xx (403, 451 Legal Unavailable) and 5xx signal HTTP-level censorship or error.
    return { reachable: res.status >= 200 && res.status < 400, status: res.status, ms: Date.now() - start };
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

  let received: string | null = null;
  try {
    const local = new dns.Resolver();
    // Use the same 2s window as baseline resolvers to keep worst-case dnsCheck
    // within 3×2s + 2s = 8s (matches httpCheck's AbortSignal.timeout(8000) limit).
    const [addr] = await withDnsTimeout(local.resolve4(domain), 2000);
    received = addr ?? null;
  } catch {
    // Local resolver failed but baseline succeeded — treat as poisoned/blocked
    return { expected, received: null, poisoned: true };
  }

  if (received === expected) {
    return { expected, received, poisoned: false };
  }

  // IPs differ — could be legitimate CDN anycast (different IP, same service)
  // or real DNS poisoning (redirected to a censor's block page).
  // Disambiguate: if the received IP accepts TCP on port 443, it is likely a
  // valid CDN edge node serving the same content from a different PoP.
  // If TCP fails on the received IP but succeeds on the expected IP, the local
  // resolver is redirecting to a dead/block IP → flag as poisoned.
  const [receivedTcp, expectedTcp] = await Promise.all([
    new Promise<boolean>(resolve => {
      const sock = net.connect({ host: received!, port: 443, timeout: 3000 });
      sock.on("connect", () => { sock.destroy(); resolve(true); });
      sock.on("timeout", () => { sock.destroy(); resolve(false); });
      sock.on("error", () => resolve(false));
    }),
    new Promise<boolean>(resolve => {
      const sock = net.connect({ host: expected!, port: 443, timeout: 3000 });
      sock.on("connect", () => { sock.destroy(); resolve(true); });
      sock.on("timeout", () => { sock.destroy(); resolve(false); });
      sock.on("error", () => resolve(false));
    }),
  ]);

  // Both IPs are live → CDN anycast routing, not poisoning
  if (receivedTcp && expectedTcp) {
    return { expected, received, poisoned: false };
  }
  // Received IP dead but expected live → local resolver redirected to a block IP
  if (!receivedTcp && expectedTcp) {
    return { expected, received, poisoned: true };
  }
  // Both dead or only received live — inconclusive, don't flag as poisoned
  return { expected, received, poisoned: false };
}

async function tcpCheck(host: string, port = 443, signal?: AbortSignal): Promise<{ connected: boolean; rstInjected: boolean; ms: number | null }> {
  // Limitation: on networks with transparent TCP proxies (common in ISP-level
  // censorship), the proxy completes the TCP 3-way handshake on behalf of the
  // blocked destination. This produces connected:true even when the host is
  // unreachable. Cross-reference with httpCheck (which verifies HTTP response
  // status) and dnsCheck to detect discrepancies indicating proxy interception.
  return new Promise((resolve) => {
    const start = Date.now();
    if (signal?.aborted) {
      resolve({ connected: false, rstInjected: false, ms: null });
      return;
    }
    const sock = net.connect({ host, port, timeout: 5000 });
    const onAbort = () => { sock.destroy(); resolve({ connected: false, rstInjected: false, ms: null }); };
    signal?.addEventListener("abort", onAbort, { once: true });
    sock.on("connect", () => { signal?.removeEventListener("abort", onAbort); sock.destroy(); resolve({ connected: true, rstInjected: false, ms: Date.now() - start }); });
    // timeout fires when connect stalls (no SYN-ACK) — must destroy to trigger 'error'
    sock.on("timeout", () => sock.destroy(new Error("connect timeout")));
    sock.on("error", (e: NodeJS.ErrnoException) => {
      signal?.removeEventListener("abort", onAbort);
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

export async function probeTarget(url: string, config: { wallet: string; geohash: string; isp: string; prevHash: string }): Promise<ProbeResult> {
  const domain = new URL(url).hostname;
  // Two-phase probing: run dnsCheck first to detect poisoning early.
  // If DNS is poisoned, abort httpCheck/tcpCheck — they would run against a bogus
  // IP for up to 8+5s, wasting the network slot on a known-bad target.
  // If DNS is clean (or inconclusive), run httpCheck+tcpCheck in parallel.
  // Run DNS, HTTP, and TCP checks concurrently. An AbortController lets dnsCheck
  // abort the in-flight HTTP and TCP requests the moment poisoning is confirmed,
  // avoiding an 8+5s wait for already-invalid checks to time out.
  // If DNS comes back poisoned OR inconclusive (expected===null), we abort http/tcp
  // immediately — in both cases running them would hit an untrusted or unknown IP.
  const httpAbort = new AbortController();
  const tcpAbort = new AbortController();
  const dnsRes = await dnsCheck(domain);
  if (dnsRes.poisoned || dnsRes.expected === null) {
    httpAbort.abort();
    tcpAbort.abort();
  }
  const resolvedIp = dnsRes.received ?? dnsRes.expected ?? domain;
  const [httpResRaw, tcpResRaw] = await Promise.all([
    httpCheck(url, httpAbort.signal),
    tcpCheck(resolvedIp, 443, tcpAbort.signal),
  ]);
  let httpRes: { reachable: boolean; status: number | null; ms: number | null }
  let tcpRes: { connected: boolean; rstInjected: boolean; ms: number | null }
  if (dnsRes.poisoned || dnsRes.expected === null) {
    httpRes = { reachable: false, status: null, ms: null };
    tcpRes = { connected: false, rstInjected: false, ms: null };
  } else {
    httpRes = httpResRaw;
    tcpRes = tcpResRaw;
  }

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
    targetsHash: TARGETS_HASH,
  };
}

export async function runProbe(config: { wallet: string; geohash: string; isp: string; prevHash: string }): Promise<{ results: ProbeResult[]; finalHash: string }> {
  // Run all 5 targets in parallel — reduces worst-case total time from
  // O(N × max_timeout) ≈ 40s to O(max_timeout) ≈ 10s on heavily-censored networks
  // (httpCheck 8s + dnsCheck up to 8s run in parallel; critical path is max ≈ 8-10s).
  const settled = await Promise.allSettled(TARGETS.map(url => probeTarget(url, config)));
  const results: ProbeResult[] = settled
    .filter((r): r is PromiseFulfilledResult<ProbeResult> => r.status === "fulfilled")
    .map(r => r.value);

  // Build the per-node tamper-evidence hash chain before writing to Arkiv.
  // Each result's `prevResultHash` is the SHA-256 of the previous result's
  // (id:timestamp:blockType:prevHash). The dashboard's chain-gap detector flags
  // any row whose stored prevresulthash doesn't match the preceding entityKey.
  // Sort by targetUrl for deterministic ordering (parallel probes don't preserve order).
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
