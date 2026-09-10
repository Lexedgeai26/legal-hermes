import { useEffect, useState } from 'react'

import { getLogs, getStatus } from '@/hermes'
import { evaluateRuntimeReadiness, type RuntimeReadinessResult } from '@/lib/runtime-readiness'
import type { StatusResponse } from '@/types/hermes'

const REFRESH_MS = 15_000
const LOG_TAIL = 12

type GatewayRequester = <T = unknown>(method: string, params?: Record<string, unknown>) => Promise<T>

export function useStatusSnapshot(gatewayState: string | undefined, requestGateway: GatewayRequester) {
  const [statusSnapshot, setStatusSnapshot] = useState<StatusResponse | null>(null)
  const [gatewayLogLines, setGatewayLogLines] = useState<string[]>([])
  const [inferenceStatus, setInferenceStatus] = useState<RuntimeReadinessResult | null>(null)

  useEffect(() => {
    let cancelled = false

    const refresh = async () => {
      try {
        const [next, logs, inference] = await Promise.all([
          getStatus(),
          getLogs({ file: 'gui', lines: LOG_TAIL }).catch(() => ({ lines: [] })),
          gatewayState === 'open'
            ? // unknownReady: true — a genuine "no credentials configured" case
              // always surfaces as a clean, definitive failure on at least one
              // of setup.status/setup.runtime_check (see interpretRuntimeReadiness).
              // Both timing out together instead (the 'fallback' source below,
              // and the .catch() here for a harder failure) means the RPC pool
              // couldn't get scheduled in time — observed in practice on
              // CPU-constrained hardware where an in-flight local-model
              // generation saturates the machine's only 1-2 cores. That's a
              // transient load signal, not evidence credentials vanished, so
              // default to the last-known-good "ready" rather than
              // interrupting an otherwise-working session with a false setup
              // prompt; the next 15s poll gets a definitive answer once load
              // clears.
              evaluateRuntimeReadiness(requestGateway, { unknownReady: true }).catch(error => ({
                checksDisagree: false,
                ready: true,
                reason: error instanceof Error ? error.message : String(error),
                source: 'fallback' as const
              }))
            : Promise.resolve(null)
        ])

        if (cancelled) {
          return
        }

        setStatusSnapshot(next)
        setGatewayLogLines(logs.lines.map(line => line.trim()).filter(Boolean))
        setInferenceStatus(inference)
      } catch {
        // Keep last snapshot through transient gateway flaps.
      }
    }

    void refresh()
    const timer = window.setInterval(() => void refresh(), REFRESH_MS)

    return () => {
      cancelled = true
      window.clearInterval(timer)
    }
  }, [gatewayState, requestGateway])

  return { gatewayLogLines, inferenceStatus, statusSnapshot }
}
