// Core domain types — shared across probe-node, map-ui, proxy-client

export type BlockType = "dns_poisoning" | "tcp_rst" | "http_block" | "full_unreachable" | "unknown";

export interface ProbeResult {
  id: string;                  // uuid
  nodeWallet: string;          // device wallet address
  targetUrl: string;
  timestamp: number;           // unix ms, set at probe-time
  reachable: boolean;
  blockType: BlockType | null;
  httpStatus: number | null;
  responseTimeMs: number | null;
  dnsExpected: string | null;
  dnsReceived: string | null;
  dnsPoisoned: boolean;
  tcpConnected: boolean;
  tcpRstInjected: boolean;
  geohash: string;             // ~city-block precision (7 chars)
  isp: string;                 // carrier/ISP name
  networkType: "wifi" | "mobile" | "unknown";
  prevResultHash: string;      // hash of previous ProbeResult — chain integrity
}

export interface VolunteerProxy {
  wallet: string;
  sdpOffer: string;            // WebRTC SDP offer JSON
  geohash: string;
  capacitySlots: number;       // how many concurrent peers supported
  createdAt: number;
}

export interface BlockConfirmation {
  id: string;
  targetUrl: string;
  geohash: string;
  isp: string;
  blockType: BlockType;
  firstSeenAt: number;
  lastConfirmedAt: number;
  confirmingNodes: number;     // count of corroborating ProbeResults
  active: boolean;
}

export interface NodeIdentity {
  wallet: string;
  geohash: string;
  isp: string;
  networkType: "wifi" | "mobile" | "unknown";
  capabilities: ("probe" | "proxy")[];
  lastSeenAt: number;
}

export interface NodeIdentityEntry {
  wallet: string;
  geohash: string;
  isp: string;
  networkType: "wifi" | "mobile" | "unknown";
  capabilities: ("probe" | "proxy")[];
}
