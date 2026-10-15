import { createHash, randomUUID } from "crypto";
import dns from "dns/promises";
import net from "net";
import { ProbeResult, BlockType } from "@resist/shared/src/types";

const BASELINE_DNS = "8.8.8.8"; // Google DNS as known-good reference
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
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
    return { reachable: res.ok || res.status < 500, status: res.status, ms: Date.now() - start };
  } catch {
    return { reachable: false, status: null, ms: null };
  }
}

async function dnsCheck(domain: string): Promise<{ expected: string | null; received: string | null; poisoned: boolean }> {
  try {
    const resolver = new dns.Resolver();
    resolver.setServers([BASELINE_DNS]);
    const [expected] = await resolver.resolve4(domain);

    const local = new dns.Resolver();
    const [received] = await local.resolve4(domain);

    return { expected, received, poisoned: expected !== received };
  } catch {
    return { expected: null, received: null, poisoned: false };
  }
}

async function tcpCheck(host: string, port = 443): Promise<{ connected: boolean; rstInjected: boolean; ms: number | null }> {
  return new Promise((resolve) => {
    const start = Date.now();
    const sock = net.connect({ host, port, timeout: 5000 });
    sock.on("connect", () => { sock.destroy(); resolve({ connected: true, rstInjected: false, ms: Date.now() - start }); });
    sock.on("error", (e: NodeJS.ErrnoException) => {
      resolve({ connected: false, rstInjected: e.code === "ECONNRESET", ms: Date.now() - start });
    });
  });
}

function classifyBlock(http: boolean, dnsPoisoned: boolean, tcpRst: boolean): BlockType | null {
  if (dnsPoisoned) return "dns_poisoning";
  if (tcpRst) return "tcp_rst";
  if (!http) return "http_block";
  return null;
}

export async function runProbe(config: { wallet: string; geohash: string; isp: string; prevHash: string }): Promise<ProbeResult[]> {
  const results: ProbeResult[] = [];

  for (const url of TARGETS) {
    const domain = new URL(url).hostname;
    const [httpRes, dnsRes, tcpRes] = await Promise.all([
      httpCheck(url),
      dnsCheck(domain),
      tcpCheck(domain),
    ]);

    const blockType = classifyBlock(httpRes.reachable, dnsRes.poisoned, tcpRes.rstInjected);
    const result: ProbeResult = {
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

    config.prevHash = createHash("sha256").update(JSON.stringify(result)).digest("hex");
    results.push(result);
  }

  return results;
}
