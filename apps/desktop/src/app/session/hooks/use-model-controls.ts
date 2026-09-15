import { type QueryClient } from '@tanstack/react-query'
import { useCallback, useRef } from 'react'

import { getGlobalModelInfo, getModelContextFloor } from '@/hermes'
import { useI18n } from '@/i18n'
import { notifyError } from '@/store/notifications'
import {
  $activeSessionId,
  $currentModel,
  $currentProvider,
  setCurrentModel,
  setCurrentProvider
} from '@/store/session'
import type { ModelOptionsResponse } from '@/types/hermes'

interface ModelSelection {
  model: string
  provider: string
}

interface ModelControlsOptions {
  activeSessionId: string | null
  queryClient: QueryClient
  requestGateway: <T = unknown>(method: string, params?: Record<string, unknown>) => Promise<T>
}

export function useModelControls({ activeSessionId, queryClient, requestGateway }: ModelControlsOptions) {
  const { t } = useI18n()
  const copy = t.desktop

  const updateModelOptionsCache = useCallback(
    (provider: string, model: string, includeGlobal: boolean) => {
      const patch = (prev: ModelOptionsResponse | undefined) => ({ ...(prev ?? {}), provider, model })

      queryClient.setQueryData<ModelOptionsResponse>(['model-options', activeSessionId || 'global'], patch)

      if (includeGlobal) {
        queryClient.setQueryData<ModelOptionsResponse>(['model-options', 'global'], patch)
      }
    },
    [activeSessionId, queryClient]
  )

  // Seed the composer's model state from the profile default. `force` reseeds
  // for a profile swap (the new profile has its own default); otherwise this
  // only fills an EMPTY selection so a user's pick (plain UI state in
  // $currentModel) survives the lifecycle refreshes that fire on boot / fresh
  // draft / session events. A live session owns the footer, so skip entirely.
  const refreshCurrentModel = useCallback(async (force = false) => {
    try {
      if ($activeSessionId.get()) {
        return
      }

      if (!force && $currentModel.get()) {
        return
      }

      const result = await getGlobalModelInfo()

      if ($activeSessionId.get() || (!force && $currentModel.get())) {
        return
      }

      if (typeof result.model === 'string') {
        setCurrentModel(result.model)
      }

      if (typeof result.provider === 'string') {
        setCurrentProvider(result.provider)
      }
    } catch {
      // The delayed session.info event still updates this once the agent is ready.
    }
  }, [])

  // The composer's sticky pick (COMPOSER_MODEL_KEY — see store/session.ts's
  // comment on why it's never re-seeded once set) is never re-checked against
  // the profile default, so a Private AI install that provisioned a model
  // later found to sit below Hermes Agent's context floor (e.g. qwen2.5:0.5b
  // at 8192 tokens, before the installer itself started enforcing that floor)
  // stays selected forever across an upgrade — the user only discovers it
  // when a chat turn raises "context window ... is below the minimum 64,000
  // required by Hermes Agent". This catches that at launch instead, so the
  // composer is never handed a model Hermes Agent will refuse before the
  // user has even sent a message.
  //
  // Scoped to `private-ai-local` (skipped entirely otherwise) because that's
  // the only provider where a sub-floor pick is actually reachable — cloud
  // models are always well above 64K, so probing them here would just be a
  // wasted round-trip on every single launch. Runs once per app lifetime
  // (the ref below), not on every reconnect: a floor violation doesn't
  // reappear on its own once resolved, so repeating the probe on every
  // gateway reconnect would add nothing but latency.
  const hasCheckedContextFloorRef = useRef(false)

  const clearStickyModelBelowContextFloor = useCallback(async () => {
    if (hasCheckedContextFloorRef.current) {
      return
    }
    hasCheckedContextFloorRef.current = true

    const provider = $currentProvider.get()
    const model = $currentModel.get()
    if (provider !== 'private-ai-local' || !model) {
      return
    }

    try {
      const result = await getModelContextFloor(provider, model)
      if (result.below_floor) {
        await refreshCurrentModel(true)
      }
    } catch {
      // Best-effort: a probe failure (runtime briefly down, model renamed)
      // must never block the composer or surface as a user-visible error —
      // worst case, the existing failure mode (a chat-turn ValueError) still
      // catches it, same as before this check existed.
    }
  }, [refreshCurrentModel])

  // Returns whether the switch succeeded so callers can await it before applying
  // follow-up changes. The composer model is plain UI state: with no live
  // session it's just stored (and shipped on the next session.create); with one
  // it's scoped to that session via config.set. It NEVER writes the profile
  // default — that lives in Settings → Model — so picking a model here can't
  // silently mutate global config.
  const selectModel = useCallback(
    async (selection: ModelSelection): Promise<boolean> => {
      // Snapshot for rollback: the switch is applied optimistically, so a
      // failure must restore the prior model/provider (store + query cache)
      // rather than leave the UI showing a model the backend never selected.
      const prevModel = $currentModel.get()
      const prevProvider = $currentProvider.get()

      setCurrentModel(selection.model)
      setCurrentProvider(selection.provider)
      updateModelOptionsCache(selection.provider, selection.model, !activeSessionId)

      // No live session yet: the pick is pure UI state. session.create reads
      // $currentModel/$currentProvider and applies it as that session's override.
      if (!activeSessionId) {
        return true
      }

      try {
        await requestGateway('config.set', {
          session_id: activeSessionId,
          key: 'model',
          value: `${selection.model} --provider ${selection.provider}`
        })

        void queryClient.invalidateQueries({ queryKey: ['model-options', activeSessionId] })

        return true
      } catch (err) {
        setCurrentModel(prevModel)
        setCurrentProvider(prevProvider)
        updateModelOptionsCache(prevProvider, prevModel, !activeSessionId)
        notifyError(err, copy.modelSwitchFailed)

        return false
      }
    },
    [activeSessionId, copy.modelSwitchFailed, queryClient, requestGateway, updateModelOptionsCache]
  )

  return { refreshCurrentModel, selectModel, updateModelOptionsCache, clearStickyModelBelowContextFloor }
}
