// Input types for writes (domain objects going INTO Arkiv)

export type BlockType = "dns_poisoning" | "tcp_rst" | "http_block" | "full_unreachable" | "unknown";

export interface ProbeResult {
  id: string;               // uuid
  nodeWallet: string;       // device wallet address
  targetUrl: string;
  timestamp: number;        // unix ms
  reachable: boolean;
  blockType: BlockType | null;
  httpStatus: number | null;
  responseTimeMs: number | null;
  dnsExpected: string | null;
  dnsReceived: string | null;
  dnsPoisoned: boolean;
  tcpConnected: boolean;
  tcpRstInjected: boolean;
  geohash: string;          // ~city-block precision (7 chars)
  isp: string;
  networkType: "wifi" | "mobile" | "unknown";
  prevResultHash: string;
}

export interface VolunteerProxyEntry {
  wallet: string;
  sdpOffer: string;         // WebRTC SDP offer JSON
  geohash: string;
  capacitySlots: number;
  createdAt: number;        // unix ms
}

export interface NodeIdentityEntry {
  wallet: string;
  geohash: string;
  isp: string;
  networkType: "wifi" | "mobile" | "unknown";
  capabilities: ("probe" | "proxy")[];
  lastSeenAt: number;       // unix ms
}

export interface SignalExchangeEntry {
  volunteerWallet: string;
  clientWallet: string;
  sdpAnswer: string;        // WebRTC SDP answer JSON
  createdAt: number;        // unix ms
}

// Row types returned FROM Arkiv queries

export interface ProbeResultRow {
  entityKey: string;
  nodewallet: string;
  targeturl: string;
  timestamp: number;
  reachable: boolean;
  blocktype: string | null;
  httpstatus: number | null;
  responsetimems: number | null;
  geohash: string;
  isp: string;
  networktype: string;
  prevresulthash: string;
  /** True when this row's prevresulthash does not match any known preceding entityKey
   *  from the same wallet — indicates a chain reset (config deleted or hash forged). */
  chainGap?: boolean;
}

export interface VolunteerProxyRow {
  entityKey: string;
  wallet: string;
  sdpoffer: string;
  geohash: string;
  capacityslots: number;
  createdat: number;
}

export interface SignalExchangeRow {
  entityKey: string;
  volunteerwallet: string;
  clientwallet: string;
  sdpanswer: string;
  createdat: number;
}

export interface NodeIdentityRow {
  entityKey: string;
  wallet: string;
  geohash: string;
  isp: string;
  networktype: string;
  lastseenms: number;
}
