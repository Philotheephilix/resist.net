# ResistNet — 2-Minute Pitch Script

> ~280 words · ~2 minutes at normal speaking pace

---

*[Pause. Look at the room.]*

India has shut down the internet **771 times** in the last seven years.

More than any country on earth.

And every single time — people just sat there, refreshing. Thinking it was their router.

That's the problem. Not the shutdown. **The silence around it.**

---

The tools to fight censorship exist. BitChat, Tor, Signal, Psiphon — they're all built. But they only work if people know *when* to reach for them.

There's no early warning system. No witness. Nothing that says: **this is a block, not a glitch.**

That's what we built.

---

**ResistNet** is a decentralised censorship radar.

Volunteer nodes — one command, any machine — probe monitored sites every 15 minutes from inside the country, on real ISPs. Not from Frankfurt. Not from a cloud server. From the same network the blocked person is on.

Every result is cryptographically signed by the node's wallet and written to **Arkiv** — immutable, on-chain, permanent.

That means it's not just a dashboard. It's **evidence**. Timestamped, signed, admissible.

---

*[Demo beat — show the screen]*

Live right now. You can see Twitter, Instagram, Wikipedia — their availability over the last 24 hours, by ISP, by block type: DNS poisoning, TCP reset, full shutdown.

And you can test any URL in seconds.

---

Here's what's different about us.

Every existing monitor — OONI, NetBlocks — probes from outside the country. They miss ISP-level blocks that only affect people inside.

We probe from inside. And we don't just detect — we **identify** the mechanism. That matters for the lawyers trying to challenge these shutdowns in court.

---

The entire stack runs on two commands:

```
npx resist-probe
npx resistnet-proxy
```

No accounts. No servers. No trust required.

---

We're asking for one thing: **your node.**

Run it on a laptop. Run it on a Raspberry Pi. Run it in a data centre in Chennai.

Every node that joins makes the evidence stronger, the detection faster, and the silence harder to maintain.

*[Pause.]*

771 shutdowns. The next one is coming.

**ResistNet will see it.**

---

## Delivery notes

- Pause hard after "771 times" — let it land
- "Not from Frankfurt" — slight emphasis, this is the technical differentiator
- Slow down on "timestamped, signed, admissible" — judges will write that down
- The two `npx` commands: say them out loud, don't skip them
- Final line: drop your voice, don't rush it
