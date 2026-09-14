import { useStore } from '@nanostores/react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { createContext, useContext, useMemo, useState } from 'react'

import { Codicon } from '@/components/ui/codicon'
import {
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  dropdownMenuRow,
  DropdownMenuSearch,
  dropdownMenuSectionLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubTrigger
} from '@/components/ui/dropdown-menu'
import { Skeleton } from '@/components/ui/skeleton'
import type { HermesGateway } from '@/hermes'
import { getGlobalModelOptions, getPrivateAIProvisionStatus, startPrivateAI } from '@/hermes'
import { useI18n } from '@/i18n'
import { currentPickerSelection, displayModelName, modelDisplayParts, reasoningEffortLabel } from '@/lib/model-status-label'
import { cn } from '@/lib/utils'
import { $modelPresets, applyModelPreset, modelPresetKey } from '@/store/model-presets'
import {
  $visibleModels,
  collapseModelFamilies,
  DEFAULT_VISIBLE_PER_PROVIDER,
  effectiveVisibleKeys,
  type ModelFamily,
  modelVisibilityKey,
  setModelVisibilityOpen
} from '@/store/model-visibility'
import {
  $activeSessionId,
  $currentFastMode,
  $currentModel,
  $currentProvider,
  $currentReasoningEffort
} from '@/store/session'
import type { ModelOptionProvider, ModelOptionsResponse } from '@/types/hermes'

import { ModelEditSubmenu, resolveFastControl } from './model-edit-submenu'

// Lets the host dropdown (model-pill) hand the panel a way to dismiss itself so
// clicking a model row commits + closes, while the hover-revealed edit submenu
// (reasoning/fast) stays open to play with (its items preventDefault on select).
export const ModelMenuCloseContext = createContext<() => void>(() => {})

interface ModelMenuPanelProps {
  gateway?: HermesGateway
  onSelectModel: (selection: { model: string; provider: string }) => Promise<boolean> | void
  requestGateway: <T>(method: string, params?: Record<string, unknown>) => Promise<T>
}

interface ProviderGroup {
  families: ModelFamily[]
  provider: ModelOptionProvider
}

export function ModelMenuPanel({ gateway, onSelectModel, requestGateway }: ModelMenuPanelProps) {
  const { t } = useI18n()
  const copy = t.shell.modelMenu
  const closeMenu = useContext(ModelMenuCloseContext)
  const [search, setSearch] = useState('')
  const [refreshing, setRefreshing] = useState(false)
  const [startingPrivateAi, setStartingPrivateAi] = useState(false)
  const [privateAiError, setPrivateAiError] = useState('')
  const queryClient = useQueryClient()
  // Reactive session state is read from the stores here (not drilled in), so
  // toggling effort/fast/model re-renders this panel in place without forcing
  // the parent to rebuild the menu content (which would close the dropdown).
  const activeSessionId = useStore($activeSessionId)
  const currentFastMode = useStore($currentFastMode)
  const currentModel = useStore($currentModel)
  const currentProvider = useStore($currentProvider)
  const currentReasoningEffort = useStore($currentReasoningEffort)
  const modelPresets = useStore($modelPresets)
  const visibleModels = useStore($visibleModels)

  const modelOptions = useQuery({
    queryKey: ['model-options', activeSessionId || 'global'],
    queryFn: (): Promise<ModelOptionsResponse> => {
      if (gateway && activeSessionId) {
        return gateway.request<ModelOptionsResponse>('model.options', { session_id: activeSessionId })
      }

      return getGlobalModelOptions()
    }
  })

  const { model: optionsModel, provider: optionsProvider } = currentPickerSelection(
    !!activeSessionId,
    { model: currentModel, provider: currentProvider },
    modelOptions.data
  )

  const loading = modelOptions.isPending && !modelOptions.data

  const error = modelOptions.error
    ? modelOptions.error instanceof Error
      ? modelOptions.error.message
      : String(modelOptions.error)
    : null

  const providers = modelOptions.data?.providers

  const effectiveVisibleModels = useMemo(
    () => effectiveVisibleKeys(visibleModels, providers ?? []),
    [visibleModels, providers]
  )

  // The composer picker never persists the profile default. With a session it
  // scopes the switch to that session; with none it's UI state shipped on the
  // next session.create (see selectModel). The default lives in Settings → Model.
  const switchTo = (model: string, provider: string) => onSelectModel({ model, provider })

  // Explicit "Refresh Models": re-fetch the catalog with refresh:true so the
  // backend busts its 1h provider-model disk cache and re-pulls each provider's
  // live list. Fixes live-only models (e.g. OpenCode Zen free tier) vanishing
  // when the cache expires and falls back to the curated static list.
  const refreshModels = async () => {
    if (refreshing) {
      return
    }

    setRefreshing(true)

    try {
      const queryKey = ['model-options', activeSessionId || 'global']

      const next =
        gateway && activeSessionId
          ? await gateway.request<ModelOptionsResponse>('model.options', {
              session_id: activeSessionId,
              refresh: true
            })
          : await getGlobalModelOptions({ refresh: true })

      queryClient.setQueryData<ModelOptionsResponse>(queryKey, next)
    } catch {
      // Network/backend hiccup — fall back to a plain invalidate so the next
      // open re-fetches (still cached, but no worse than before).
      void queryClient.invalidateQueries({ queryKey: ['model-options'] })
    } finally {
      setRefreshing(false)
    }
  }

  // Private AI is the one provider whose row is legitimately model-less: a local
  // runtime that's installed-but-stopped (or never installed) reports that in
  // `status`/`warning` while carrying `models: []`. groupModels only reads
  // `models`, so such a row contributes nothing and the panel falls through to a
  // bare "No models found" — hiding both the reason and the one-click fix.
  // Surface it as its own actionable row instead.
  const privateAi = providers?.find(
    provider => provider.slug === 'private-ai-local' && provider.status && provider.status !== 'connected'
  )

  const startPrivateAiRuntime = async () => {
    if (startingPrivateAi) {
      return
    }

    setStartingPrivateAi(true)
    setPrivateAiError('')

    try {
      const result = await startPrivateAI()

      if (!result.started) {
        setPrivateAiError(result.message || copy.privateAiStartFailed)
        return
      }

      // Poll the shared provision/start job. First launch can take tens of
      // seconds (the backend waits up to 25s for Ollama to answer), so this is
      // bounded rather than open-ended — a stuck job releases the row instead
      // of spinning forever.
      const deadline = Date.now() + 60_000

      await new Promise<void>(resolve => {
        const poll = setInterval(async () => {
          try {
            const status = await getPrivateAIProvisionStatus()

            if (status.done) {
              clearInterval(poll)

              if (status.error) {
                setPrivateAiError(status.error)
              }

              resolve()
              return
            }
          } catch {
            // Transient poll failure — keep trying on the next tick.
          }

          if (Date.now() > deadline) {
            clearInterval(poll)
            resolve()
          }
        }, 800)
      })

      await refreshModels()
    } catch (err) {
      setPrivateAiError(err instanceof Error ? err.message : copy.privateAiStartFailed)
    } finally {
      setStartingPrivateAi(false)
    }
  }

  // Selecting a model row restores that model's remembered preset onto the
  // session (effort/fast), gated by capability. Unset → Hermes defaults.
  const selectFamily = async (family: ModelFamily, provider: ModelOptionProvider) => {
    const caps = provider.capabilities?.[family.id]
    const preset = modelPresets[modelPresetKey(provider.slug, family.id)] ?? {}

    // Variant-fast models (no speed param) express "fast" as a separate `-fast`
    // id, so honor the saved preset by selecting that sibling. Param-fast is
    // applied via applyModelPreset below instead.
    const variantFast = !(caps?.fast ?? false) && !!family.fastId
    const targetId = variantFast && preset.fast === true ? family.fastId! : family.id

    if ((await switchTo(targetId, provider.slug)) === false) {
      return
    }

    await applyModelPreset(
      {
        effort: (caps?.reasoning ?? true) ? (preset.effort ?? 'medium') : undefined,
        fast: (caps?.fast ?? false) ? (preset.fast ?? false) : undefined
      },
      { failMessage: t.shell.modelOptions.updateFailed, request: requestGateway, sessionId: activeSessionId }
    )
  }

  const groups = useMemo(
    () => groupModels(providers ?? [], search, { model: optionsModel, provider: optionsProvider }, effectiveVisibleModels),
    [providers, search, optionsModel, optionsProvider, effectiveVisibleModels]
  )

  // Only "installed but stopped" is actionable from here — it never downloads
  // anything. A full install (not_setup) stays in Settings, which has the
  // progress/error surface a multi-GB fetch needs.
  const canStartPrivateAi = privateAi?.status === 'unreachable_configured'

  const privateAiHint =
    privateAi?.status === 'not_setup'
      ? copy.privateAiSetUpHint
      : privateAi?.status === 'reachable_no_models'
        ? copy.privateAiNoModelsHint
        : ''

  const privateAiRow = privateAi ? (
    <DropdownMenuGroup className="py-0.5">
      <DropdownMenuLabel className={dropdownMenuSectionLabel}>{privateAi.name}</DropdownMenuLabel>
      <DropdownMenuItem
        className={cn(dropdownMenuRow, 'flex-col items-start gap-0.5')}
        disabled={!canStartPrivateAi || startingPrivateAi}
        onSelect={event => {
          // Keep the menu open: the start is async and its result (models
          // appearing, or an error) renders right here in this row.
          event.preventDefault()

          if (canStartPrivateAi) {
            void startPrivateAiRuntime()
          }
        }}
      >
        <span className="flex items-center gap-1.5">
          {canStartPrivateAi ? (
            <Codicon name={startingPrivateAi ? 'loading' : 'play'} size="0.75rem" spinning={startingPrivateAi} />
          ) : null}
          {canStartPrivateAi ? (startingPrivateAi ? copy.privateAiStarting : copy.privateAiStart) : privateAi.name}
        </span>
        {privateAiError || privateAi.warning || privateAiHint ? (
          <span className="text-muted-foreground text-xs">
            {privateAiError || privateAi.warning || privateAiHint}
          </span>
        ) : null}
      </DropdownMenuItem>
    </DropdownMenuGroup>
  ) : null

  return (
    <>
      <DropdownMenuSearch
        aria-label={copy.search}
        onValueChange={setSearch}
        placeholder={copy.search}
        value={search}
      />

      <DropdownMenuSeparator className="mx-0" />

      {loading ? (
        <DropdownMenuGroup className="py-1">
          {Array.from({ length: 4 }, (_, index) => (
            <DropdownMenuItem
              className={dropdownMenuRow}
              disabled
              key={index}
              onSelect={event => event.preventDefault()}
            >
              <Skeleton className="h-4 w-full" />
            </DropdownMenuItem>
          ))}
        </DropdownMenuGroup>
      ) : error ? (
        <DropdownMenuItem className={dropdownMenuRow} disabled>
          {error}
        </DropdownMenuItem>
      ) : groups.length === 0 ? (
        // A Private AI row that needs attention replaces the bare "No models
        // found" dead-end — that empty state is only honest when there's
        // genuinely nothing to say.
        (privateAiRow ?? (
          <DropdownMenuItem className={dropdownMenuRow} disabled>
            {copy.noModels}
          </DropdownMenuItem>
        ))
      ) : (
        <div className="max-h-[max(150px,30dvh)] overflow-y-auto py-0.5">
          {privateAiRow}
          {groups.map(group => (
            <DropdownMenuGroup className="py-0.5" key={group.provider.slug}>
              <DropdownMenuLabel className={dropdownMenuSectionLabel}>{group.provider.name}</DropdownMenuLabel>
              {group.families.map(family => {
                // The active id may be the base or its -fast sibling; either
                // way this one family row represents both.
                const activeId =
                  group.provider.slug === optionsProvider &&
                  (optionsModel === family.id || optionsModel === family.fastId)
                    ? optionsModel
                    : null

                const isCurrent = activeId !== null
                const name = modelDisplayParts(family.id).name
                // Capabilities are looked up against the active/base id; the
                // -fast variant carries the same param support as its base.
                const caps = group.provider.capabilities?.[family.id]

                // Effective settings for this row: live session state when it's
                // the active model, otherwise its remembered preset (Hermes
                // defaults when unset). Row label AND submenu read from these so
                // they never disagree.
                const preset = modelPresets[modelPresetKey(group.provider.slug, family.id)] ?? {}
                const effEffort = isCurrent ? currentReasoningEffort : preset.effort ?? ''
                const effFast = isCurrent ? currentFastMode : preset.fast ?? false

                const fastControl = resolveFastControl(
                  activeId ?? family.id,
                  group.provider.models ?? [],
                  caps?.fast ?? false,
                  effFast
                )

                const meta = [
                  fastControl.kind !== 'none' && fastControl.on ? copy.fast : null,
                  (caps?.reasoning ?? true) ? reasoningEffortLabel(effEffort) || copy.medium : null
                ]
                  .filter(Boolean)
                  .join(' ')

                // Every row is a hover-Edit submenu trigger. Activating it
                // (pointer or keyboard) switches to the family's base model and
                // restores its preset; the Fast toggle inside swaps to the -fast
                // sibling (or flips the speed param). The sub-trigger has no
                // `onSelect`, so wire both click and Enter/Space for keyboard parity.
                // Clicking the row commits the model and closes the picker; the
                // edit submenu (reasoning/fast) is reached by HOVER, so you can
                // still tweak those without the click dismissing everything.
                const activate = () => {
                  if (!isCurrent) {
                    void selectFamily(family, group.provider)
                  }

                  closeMenu()
                }

                return (
                  <DropdownMenuSub key={`${group.provider.slug}:${family.id}`}>
                    <DropdownMenuSubTrigger
                      className={dropdownMenuRow}
                      hideChevron
                      onClick={activate}
                      onKeyDown={event => {
                        if (event.key === 'Enter' || event.key === ' ') {
                          activate()
                        }
                      }}
                    >
                      <span className="min-w-0 flex-1 truncate">
                        {name}
                        {meta ? <span className="text-(--ui-text-tertiary)"> {meta}</span> : null}
                      </span>
                      {isCurrent ? <Codicon className="ml-auto text-foreground" name="check" size="0.75rem" /> : null}
                    </DropdownMenuSubTrigger>
                    <ModelEditSubmenu
                      effort={effEffort}
                      fastControl={fastControl}
                      isActive={isCurrent}
                      model={family.id}
                      onSelectModel={nextModel => switchTo(nextModel, group.provider.slug)}
                      provider={group.provider.slug}
                      reasoning={caps?.reasoning ?? true}
                      requestGateway={requestGateway}
                    />
                  </DropdownMenuSub>
                )
              })}
            </DropdownMenuGroup>
          ))}
        </div>
      )}

      <DropdownMenuSeparator className="mx-0" />

      <DropdownMenuItem
        className={cn(dropdownMenuRow, 'text-(--ui-text-tertiary)')}
        disabled={refreshing}
        onSelect={event => {
          event.preventDefault()
          void refreshModels()
        }}
      >
        <Codicon className={cn(refreshing && 'animate-spin')} name="sync" size="0.75rem" />
        {copy.refreshModels}
      </DropdownMenuItem>

      <DropdownMenuItem
        className={cn(dropdownMenuRow, 'text-(--ui-text-tertiary)')}
        onSelect={() => setModelVisibilityOpen(true)}
      >
        <Codicon name="settings-gear" size="0.75rem" />
        {copy.editModels}
      </DropdownMenuItem>
    </>
  )
}

// Collapsed we show the user's chosen models (or the curated default); typing
// spans every available model so anything is reachable past the cut.
const PER_PROVIDER_SEARCH = 12

function groupModels(
  providers: ModelOptionProvider[],
  search: string,
  current: { model: string; provider: string },
  visible: Set<string> | null
): ProviderGroup[] {
  const q = search.trim().toLowerCase()
  const groups: ProviderGroup[] = []

  for (const provider of providers) {
    const allFamilies = collapseModelFamilies(provider.models ?? [])

    if (allFamilies.length === 0) {
      continue
    }

    const matches = (family: ModelFamily) =>
      `${family.id} ${family.fastId ?? ''} ${provider.name} ${provider.slug} ${displayModelName(family.id)}`
        .toLowerCase()
        .includes(q)

    // Which model ids to show (the active one is always added on top of this).
    let shown: Set<string>

    if (q) {
      // Search spans every family, regardless of visibility.
      shown = new Set(allFamilies.filter(matches).map(family => family.id))
    } else if (visible) {
      // User has customized which models show — honor their selection exactly.
      shown = new Set(
        allFamilies.filter(family => visible.has(modelVisibilityKey(provider.slug, family.id))).map(family => family.id)
      )
    } else {
      // Default: curated top-N families per provider.
      shown = new Set(allFamilies.slice(0, DEFAULT_VISIBLE_PER_PROVIDER).map(family => family.id))
    }

    // Always include the active model — but keep every row in the provider's
    // stable curated order (filter `allFamilies`, never reorder), so selecting
    // a model can't shuffle the list.
    const activeId =
      provider.slug === current.provider && current.model
        ? allFamilies.find(family => family.id === current.model || family.fastId === current.model)?.id
        : undefined

    let families = allFamilies.filter(family => shown.has(family.id) || family.id === activeId)

    if (q) {
      families = families.slice(0, PER_PROVIDER_SEARCH)
    }

    if (families.length > 0) {
      groups.push({ families, provider })
    }
  }

  // Stable, logical group order: alphabetical by provider name. (The backend
  // floats the current provider first, which would reshuffle on every switch.)
  groups.sort((a, b) => a.provider.name.localeCompare(b.provider.name))

  return groups
}
