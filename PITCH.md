# ResistNet — Hackathon Pitch

---

## SLIDE 1 — THE HOOK

**The tools to fight censorship exist.**

BitChat. Briar. Tor. Signal. Psiphon.
Mesh messaging. Onion routing. Encrypted tunnels.
The communication infrastructure is built. It works. It's ready.

**There's just one problem.**

Nobody knows when to use it.

771 internet shutdowns. One country. Five years in a row.
Each one starts the same way — people reload the page, switch networks, assume it's a glitch.
By the time they realise it's a block, the window is gone.

The tools are ready. The awareness isn't.

> *"Is this site down — or am I being blocked?"*

Nobody has built a reliable, decentralised, real-time answer to that question.

Until now.

---

## SLIDE 2 — THE EVIDENCE

### India Shuts Down the Internet. Constantly.

**Kashmir — 2019.** Article 370 revoked. All internet killed simultaneously. 213 consecutive days of complete blackout. 4G restored 17 months later. ~$1B economic damage. Journalists barred. Phones searched for VPNs.

**CAA Protests — December 2019.** 121 shutdowns across 16 states in one year. Assam's High Court orders restoration — government ignores it, requiring a second ruling. Delhi's shutdown later ruled **illegal**.

**Farmer Protests — January 2021.** 50 million subscribers cut off for 12 hours. Government then orders Twitter, YouTube, Facebook, Instagram to remove 1,474 accounts. Twitter pushes back. Government threatens employees with **7 years imprisonment**. Twitter complies.

**Manipur — 2023.** Months-long blackout. A gang sexual assault is recorded — blackout buries it for weeks. Chief Minister later defends the shutdown as having prevented "similar incident documentation."

**India–Pakistan Conflict — May 2025.** 8,000+ Twitter accounts removal-requested. Pakistani and independent Indian news sites blocked via TLS interference. Dawn. Geo TV. The Wire. Kashmir Walla. All dark.

**BitChat — July 2026.** Students protest exam leaks. Internet cut. Protesters turn to BitChat — Bluetooth mesh, no servers. India downloads spike to 85% of global traffic. 91,000 downloads in 5 days. Government's response: order GitHub to delete the repository within 3 hours. Jack Dorsey leaks the notice publicly. October: Apple and Google Play remove BitChat from Indian stores under Section 69A. The Internet Freedom Foundation calls it unconstitutional.

> *They didn't just block the internet. They tried to erase the tool people built to survive the block.*

---

## SLIDE 3 — THE GAP

Every existing tool is watching from the wrong side of the wall.

OONI. NetBlocks. ICLAB.

They measure from abroad and *infer* what's happening inside. That creates two fatal blind spots:

**1. ISP-level blocks are invisible from outside**
India's blocks are frequently implemented per-ISP — Jio blocks something that BSNL doesn't. A probe from Frankfurt sees nothing. A probe from a Jio SIM in Lucknow sees exactly what 400 million Jio subscribers see.

**2. Citizens don't know what's happening in real time**
There's no dashboard. No live signal. No way for a journalist, activist, or ordinary person to check right now whether Wikipedia is blocked in their state, their ISP, their city.

---

## SLIDE 4 — RESISTNET

**A decentralised censorship radar. Built to watch from the inside.**

### How It Works

1. **Volunteer nodes** run on ordinary devices — laptops, servers, Raspberry Pis — anywhere in the world, including inside India
2. Every **15 minutes**, each node runs HTTP, DNS, and TCP checks against a set of monitored targets
3. Results are **cryptographically signed** with the node's wallet and written to **Arkiv** — an on-chain entity store
4. The **live dashboard** aggregates those probes into 24-hour availability charts, block-type breakdowns, and a real-time event feed
5. Anyone can **test any URL** directly from the dashboard — result in seconds

### What It Detects

- DNS Poisoning (the most common India method)
- TCP Reset injection
- HTTP 403 / block page injection
- TLS-SNI interference (the method used in May 2025)
- Full unreachability

### Data Sovereignty — The Feature Nobody Else Has

> **Probes originate from Indian IPs, on Indian ISPs, in Indian jurisdictions. The raw traffic never leaves.**

The node generates a signed result object: URL, reachable true/false, block type, latency, timestamp, geohash. That compact object is what hits Arkiv. No raw response bodies. No PII. No traffic mirroring. No content hosted or relayed.

This matters:

- **Legally defensible**: visiting a website and noting whether it loaded is not circumvention — it's witnessing. The node is a witness, not a proxy. No question of facilitating anything.
- **Sovereignty preserved**: India's data stays measured from India, by Indians, without exporting the measurement infrastructure to foreign servers
- **ISP fidelity**: a Jio node catches Jio blocks. A BSNL node catches BSNL blocks. External probes never could.

In short: **ResistNet lets India watch itself — from inside — without breaking data sovereignty.**

---

## SLIDE 5 — THE STACK POSITION

Think of the censorship-resistance ecosystem as layers:

| Layer | Tool | What it does |
|---|---|---|
| **Evidence** | **ResistNet** | Proves it was blocked — signed, timestamped, on-chain |
| **Awareness** | **ResistNet** | Tells you it's blocked, right now, before you give up |
| **Messaging** | BitChat / Briar | Peer-to-peer chat over Bluetooth/WiFi mesh |
| **Routing** | Tor / Psiphon | Traffic tunnelling around blocks |
| **Publishing** | IPFS / Nostr | Censorship-resistant content hosting |

**ResistNet sits at two layers nobody else covers: awareness and evidence.**

The rest of the stack bypasses censorship or routes around it. ResistNet does something different — it **witnesses** it and **proves** it happened.

### For users in the moment
When a block starts, ResistNet tells you within 15 minutes: this site is down in your region, on your ISP, with this block method. Not a glitch. A block. Now you know to open BitChat.

### For journalists, NGOs, and courts — after the fact
Every probe result written to Arkiv is cryptographically signed by the node's wallet, timestamped on-chain, and permanent. Government cannot quietly delete it. Cannot claim the shutdown was brief when it wasn't. Cannot deny the block existed.

This is the difference between a screenshot and **evidence admissible in front of a human rights body**.

When the Assam High Court ordered the government to restore internet and the government ignored the order — requiring a second ruling — there was no tamper-proof record of exactly when the block started, how long it ran per ISP, and what method was used. ResistNet would have that record. Signed. On-chain. Undeniable.

**The communication tools fight censorship. ResistNet proves it happened.**

---

## SLIDE 6 — THE ASK

### The communication problem is solved. The awareness problem isn't.

BitChat lets you message when the internet is cut — Bluetooth mesh, no servers, no censorship.
Briar routes around blocks. Tor tunnels through them. Psiphon bypasses them.

**Every single one of these tools assumes you already know you need them.**

That's the gap. When a shutdown starts, most people don't reach for BitChat — they reload the page. They switch networks. They wait. They assume it's a glitch. By the time they realise it's a block, they've missed the window.

**ResistNet is the early warning system.**

It tells you — in real time, before you even notice something is wrong — that Twitter is being DNS-poisoned in your state, that your ISP started dropping TCP packets to Signal 8 minutes ago, that 14 other nodes in your region are seeing the same thing.

*Now* you know to open BitChat.
*Now* you know to start the Tor bridge.
*Now* you know it's not a glitch — it's a shutdown.

ResistNet doesn't replace the tools that exist. It tells you **when to use them**.

---

**For volunteer nodes:**
Run a probe from any country. One command: `npx @resist/probe-node`. Your node earns on-chain reputation with every signed result. Inside India, you're seeing what your ISP actually does — that data is the most valuable of all.

**For integration partners:**
Any VPN, Tor bridge, or mesh-chat app can query the ResistNet API to surface real-time block status directly to users — "Twitter is currently blocked in your region" — before they even try to load it.

---

## CLOSING LINE

> **771 shutdowns. Zero accountability. Until now.**
>
> ResistNet — see what's blocked, everywhere, right now.

---

*Demo: [localhost:3000](http://localhost:3000) | Node: `npx @resist/probe-node` | On-chain: Arkiv*
