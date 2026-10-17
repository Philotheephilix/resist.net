/**
 * Probe queue worker — polls Arkiv for ProbeQueueEntry jobs and executes them.
 *
 * Any running probe-node automatically picks up queued jobs. Jobs specify:
 *   targetUrl, volunteerCount, repeatCount, intervalSeconds, paymentGlm
 *
 * Claim is implicit: we track processed entityKeys in memory to avoid re-running.
 * A full on-chain claim mechanism would require a signed "claimed" entity — that's
 * a future enhancement once the GLM payment rails are live.
 */

import { ArkivReadClient } from "@resist/arkiv-sdk/src/client.js"
import { ArkivClient } from "@resist/arkiv-sdk/src/client.js"
import { probeTarget } from "./probe.js"
import { syncToArkiv } from "./sync.js"
import { savePrevHash } from "./config.js"
import type { ProbeQueueRow } from "@resist/arkiv-sdk/src/types.js"

const QUEUE_POLL_INTERVAL_MS = 60 * 1000 // check every 60 s
const MAX_CONCURRENT_JOBS = 3

interface ProbeConfig {
  wallet: string
  privateKey: string
  geohash: string
  isp: string
  networkType: "wifi" | "mobile" | "unknown"
  prevHash: string
}

export class QueueWorker {
  private readonly rpcUrl: string
  private readonly config: ProbeConfig
  private readonly processed = new Set<string>()
  private readonly running = new Set<string>()
  private timer: ReturnType<typeof setTimeout> | null = null
  private stopped = false

  constructor(rpcUrl: string, config: ProbeConfig) {
    this.rpcUrl = rpcUrl
    this.config = config
  }

  start() {
    if (this.stopped) return
    this.timer = setTimeout(() => this.poll(), QUEUE_POLL_INTERVAL_MS)
    console.log("[queue] worker started — polling every 60s")
  }

  stop() {
    this.stopped = true
    if (this.timer) { clearTimeout(this.timer); this.timer = null }
    console.log("[queue] worker stopped")
  }

  private async poll() {
    if (this.stopped) return
    try {
      const client = new ArkivReadClient(this.rpcUrl)
      const jobs = await client.queryProbeQueue({ limit: 20, since: Date.now() - 24 * 60 * 60 * 1000 })
      const fresh = jobs.filter(j =>
        !this.processed.has(j.entityKey) &&
        !this.running.has(j.entityKey) &&
        j.expiresat > Date.now()
      )
      if (fresh.length > 0) {
        console.log(`[queue] found ${fresh.length} new job(s)`)
      }
      const slots = MAX_CONCURRENT_JOBS - this.running.size
      const batch = fresh.slice(0, slots)
      for (const job of batch) {
        this.running.add(job.entityKey)
        this.runJob(job)
          .catch(err => console.error(`[queue] job ${job.entityKey} failed:`, err))
          .finally(() => {
            this.running.delete(job.entityKey)
            this.processed.add(job.entityKey)
          })
      }
    } catch (err) {
      console.error("[queue] poll error:", err)
    } finally {
      if (!this.stopped) {
        this.timer = setTimeout(() => this.poll(), QUEUE_POLL_INTERVAL_MS)
      }
    }
  }

  private async runJob(job: ProbeQueueRow) {
    console.log(`[queue] running job ${job.entityKey}: ${job.targeturl} × ${job.repeatcount}`)
    const results = []
    for (let i = 0; i < job.repeatcount; i++) {
      if (this.stopped) break
      try {
        const result = await probeTarget(job.targeturl, this.config)
        results.push(result)
        console.log(`[queue] probe ${i + 1}/${job.repeatcount}: ${result.reachable ? 'reachable' : result.blockType ?? 'blocked'}`)
        if (i < job.repeatcount - 1 && !this.stopped) {
          await new Promise(r => setTimeout(r, job.intervalseconds * 1000))
        }
      } catch (err) {
        console.error(`[queue] probe ${i + 1} error:`, err)
      }
    }
    if (results.length > 0) {
      try {
        await syncToArkiv(results, this.config)
        await savePrevHash(this.config, results[results.length - 1].prevResultHash)
        console.log(`[queue] job ${job.entityKey} complete — ${results.length} results synced (${job.paymentglm.toFixed(3)} GLM reward)`)
      } catch (err) {
        console.error(`[queue] sync error for job ${job.entityKey}:`, err)
      }
    }
  }
}
