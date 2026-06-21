import type * as React from 'react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import QRCode from 'qrcode'

import { PageLoader } from '@/components/page-loader'
import { StatusDot, type StatusTone } from '@/components/status-dot'
import { Button } from '@/components/ui/button'
import { DisclosureCaret } from '@/components/ui/disclosure-caret'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import {
  connectGmailOAuth,
  cancelWhatsAppPairing,
  disconnectWhatsApp,
  getWhatsAppPairing,
  getMessagingPlatforms,
  startWhatsAppPairing,
  type MessagingEnvVarInfo,
  type MessagingPlatformInfo,
  type WhatsAppPairingResponse,
  updateMessagingPlatform
} from '@/hermes'
import { type Translations, useI18n } from '@/i18n'
import { AlertTriangle, ExternalLink, Save, Trash2 } from '@/lib/icons'
import { cn } from '@/lib/utils'
import { notify, notifyError } from '@/store/notifications'
import { runGatewayRestart } from '@/store/system-actions'

import { useRefreshHotkey } from '../hooks/use-refresh-hotkey'
import { useRouteEnumParam } from '../hooks/use-route-enum-param'
import { PageSearchShell } from '../page-search-shell'
import { CREDENTIAL_CONTROL_CLASS } from '../settings/credential-key-ui'
import { ListRow } from '../settings/primitives'
import type { SetStatusbarItemGroup } from '../shell/statusbar-controls'

import { PlatformAvatar } from './platform-icon'

interface MessagingViewProps extends React.ComponentProps<'section'> {
  setStatusbarItemGroup?: SetStatusbarItemGroup
}

type EditMap = Record<string, Record<string, string>>
type SetupPreset = Record<string, string>
type WhatsAppPairingState = null | WhatsAppPairingResponse

const COMMON_PLATFORM_IDS = new Set(['telegram', 'whatsapp', 'slack', 'email'])
const COMMON_PLATFORM_ORDER = ['whatsapp', 'email', 'telegram', 'slack']

const CLIENT_CHANNEL_LABELS: Record<string, string> = {
  email: 'Email',
  slack: 'Slack',
  telegram: 'Telegram',
  whatsapp: 'WhatsApp'
}

const CLIENT_CHANNEL_DESCRIPTIONS: Record<string, string> = {
  email: 'Connect a mailbox for matter intake, client updates, and draft email replies.',
  slack: 'Connect a Slack workspace for internal firm channels and team review.',
  telegram: 'Connect a Telegram bot for client intake or matter updates.',
  whatsapp: 'Connect WhatsApp for client messages and draft replies with human approval.'
}

const PILL_TONE: Record<StatusTone, string> = {
  good: 'bg-primary/10 text-primary',
  muted: 'bg-muted text-muted-foreground',
  warn: 'bg-amber-500/10 text-amber-600 dark:text-amber-300',
  bad: 'bg-destructive/10 text-destructive'
}

const stateLabel = (state: null | string | undefined, m: Translations['messaging']) =>
  state ? m.states[state] || state.replace(/_/g, ' ') : m.unknown

function stateTone({ enabled, state }: MessagingPlatformInfo): StatusTone {
  if (!enabled) {
    return 'muted'
  }

  if (state === 'connected') {
    return 'good'
  }

  if (state === 'fatal' || state === 'startup_failed') {
    return 'bad'
  }

  return 'warn'
}

const trimEdits = (edits: Record<string, string>): Record<string, string> =>
  Object.fromEntries(
    Object.entries(edits)
      .map(([k, v]) => [k, v.trim()])
      .filter(([, v]) => v)
  )

const FIELD_COPY: Record<string, { advanced?: boolean }> = {
  EMAIL_ALLOW_ALL_USERS: { advanced: true },
  EMAIL_HOME_ADDRESS: { advanced: true },
  EMAIL_HOME_ADDRESS_NAME: { advanced: true },
  EMAIL_HOME_ADDRESS_THREAD_ID: { advanced: true },
  SLACK_ALLOW_ALL_USERS: { advanced: true },
  SLACK_ALLOWED_CHANNELS: { advanced: true },
  SLACK_FREE_RESPONSE_CHANNELS: { advanced: true },
  SLACK_HOME_CHANNEL: { advanced: true },
  SLACK_HOME_CHANNEL_NAME: { advanced: true },
  SLACK_REQUIRE_MENTION: { advanced: true },
  SLACK_STRICT_MENTION: { advanced: true },
  TELEGRAM_ALLOW_ALL_USERS: { advanced: true },
  TELEGRAM_ALLOWED_CHATS: { advanced: true },
  TELEGRAM_FREE_RESPONSE_CHATS: { advanced: true },
  TELEGRAM_GROUP_ALLOWED_CHATS: { advanced: true },
  TELEGRAM_GROUP_ALLOWED_USERS: { advanced: true },
  TELEGRAM_HOME_CHANNEL: { advanced: true },
  TELEGRAM_HOME_CHANNEL_NAME: { advanced: true },
  TELEGRAM_HOME_CHANNEL_THREAD_ID: { advanced: true },
  TELEGRAM_REQUIRE_MENTION: { advanced: true },
  TELEGRAM_PROXY: { advanced: true },
  DISCORD_REPLY_TO_MODE: { advanced: true },
  DISCORD_ALLOW_ALL_USERS: { advanced: true },
  DISCORD_HOME_CHANNEL: { advanced: true },
  DISCORD_HOME_CHANNEL_NAME: { advanced: true },
  BLUEBUBBLES_ALLOW_ALL_USERS: { advanced: true },
  MATTERMOST_ALLOW_ALL_USERS: { advanced: true },
  MATTERMOST_HOME_CHANNEL: { advanced: true },
  QQ_ALLOW_ALL_USERS: { advanced: true },
  QQBOT_HOME_CHANNEL: { advanced: true },
  QQBOT_HOME_CHANNEL_NAME: { advanced: true },
  WHATSAPP_ENABLED: { advanced: true },
  WHATSAPP_MODE: { advanced: true },
  WHATSAPP_ALLOW_ALL_USERS: { advanced: true },
  WHATSAPP_FREE_RESPONSE_CHATS: { advanced: true },
  WHATSAPP_GROUP_ALLOWED_USERS: { advanced: true },
  WHATSAPP_GROUP_POLICY: { advanced: true },
  WHATSAPP_HOME_CHANNEL: { advanced: true },
  WHATSAPP_HOME_CHANNEL_NAME: { advanced: true },
  WHATSAPP_HOME_CHANNEL_THREAD_ID: { advanced: true },
  WHATSAPP_REQUIRE_MENTION: { advanced: true }
}

const byCommonOrder = (a: MessagingPlatformInfo, b: MessagingPlatformInfo) => {
  const left = COMMON_PLATFORM_ORDER.indexOf(a.id)
  const right = COMMON_PLATFORM_ORDER.indexOf(b.id)

  if (left >= 0 || right >= 0) {
    return (left >= 0 ? left : 999) - (right >= 0 ? right : 999)
  }

  return a.name.localeCompare(b.name)
}

const channelName = (platform: MessagingPlatformInfo) => CLIENT_CHANNEL_LABELS[platform.id] || platform.name

const channelDescription = (platform: MessagingPlatformInfo) =>
  CLIENT_CHANNEL_DESCRIPTIONS[platform.id] || platform.description

const canConfigureInApp = (platform: MessagingPlatformInfo) => COMMON_PLATFORM_IDS.has(platform.id)

const buildSetupPreset = (platform: MessagingPlatformInfo, preset: string): SetupPreset => {
  if (platform.id === 'whatsapp') {
    if (preset === 'phone') {
      return {
        WHATSAPP_ENABLED: 'true',
        WHATSAPP_MODE: 'self-chat'
      }
    }
  }

  if (platform.id === 'email') {
    if (preset === 'gmail') {
      return {
        EMAIL_IMAP_HOST: 'imap.gmail.com',
        EMAIL_SMTP_HOST: 'smtp.gmail.com'
      }
    }

    if (preset === 'microsoft') {
      return {
        EMAIL_IMAP_HOST: 'outlook.office365.com',
        EMAIL_SMTP_HOST: 'smtp.office365.com'
      }
    }
  }

  return {}
}

function fieldCopy(field: MessagingEnvVarInfo, m: Translations['messaging']) {
  const copy = FIELD_COPY[field.key] || {}
  const localized = m.fieldCopy[field.key] || {}

  return {
    label: localized.label || field.prompt || field.key,
    help: localized.help || field.description,
    placeholder: localized.placeholder || field.prompt,
    advanced: Boolean(copy.advanced || field.advanced)
  }
}

export function MessagingView({ setStatusbarItemGroup: _setStatusbarItemGroup, ...props }: MessagingViewProps) {
  const { t } = useI18n()
  const m = t.messaging
  // Both save/toggle toasts offer the same one-click restart.
  const restartGatewayAction = useMemo(
    () => ({ label: t.commandCenter.restartGateway, onClick: () => void runGatewayRestart() }),
    [t.commandCenter.restartGateway]
  )
  const [platforms, setPlatforms] = useState<MessagingPlatformInfo[] | null>(null)
  const [edits, setEdits] = useState<EditMap>({})
  const [query, setQuery] = useState('')
  const [refreshing, setRefreshing] = useState(false)
  const [saving, setSaving] = useState<string | null>(null)
  const [whatsappPairing, setWhatsAppPairing] = useState<WhatsAppPairingState>(null)
  const [moreOpen, setMoreOpen] = useState(false)
  const platformIds = useMemo(() => platforms?.map(p => p.id) ?? [], [platforms])
  const [selectedId, setSelectedId] = useRouteEnumParam('platform', platformIds, platformIds[0] ?? '')

  const refreshPlatforms = useCallback(async (silent = false) => {
    if (!silent) {
      setRefreshing(true)
    }

    try {
      const result = await getMessagingPlatforms()
      setPlatforms(result.platforms)
    } catch (err) {
      if (!silent) {
        notifyError(err, m.loadFailed)
      }
    } finally {
      if (!silent) {
        setRefreshing(false)
      }
    }
  }, [m])

  useRefreshHotkey(() => void refreshPlatforms())

  useEffect(() => {
    void refreshPlatforms()
  }, [refreshPlatforms])

  // Auto-poll while the user is on the messaging page so connection status
  // updates without a manual "check" click. Pause when the tab is hidden.
  useEffect(() => {
    let cancelled = false

    function tick() {
      if (cancelled || document.hidden) {
        return
      }

      void refreshPlatforms(true)
    }

    const id = window.setInterval(tick, 6000)

    return () => {
      cancelled = true
      window.clearInterval(id)
    }
  }, [refreshPlatforms])

  useEffect(() => {
    const pairingId = whatsappPairing?.pairing_id
    if (!pairingId || whatsappPairing.paired || whatsappPairing.status === 'error') {
      return
    }

    let cancelled = false
    const id = window.setInterval(() => {
      void getWhatsAppPairing(pairingId)
        .then(result => {
          if (cancelled) {
            return
          }
          setWhatsAppPairing(result)
          if (result.paired) {
            void refreshPlatforms(true)
            notify({
              kind: 'success',
              title: 'WhatsApp connected',
              message: 'Restart messaging to start receiving WhatsApp messages.',
              action: restartGatewayAction
            })
          }
        })
        .catch(err => {
          if (!cancelled) {
            notifyError(err, 'Failed to check WhatsApp pairing')
          }
        })
    }, 2500)

    return () => {
      cancelled = true
      window.clearInterval(id)
    }
  }, [refreshPlatforms, restartGatewayAction, whatsappPairing])

  const selected = useMemo(() => {
    if (!platforms) {
      return null
    }

    return platforms.find(platform => platform.id === selectedId) || platforms[0] || null
  }, [platforms, selectedId])

  const visiblePlatforms = useMemo(() => {
    if (!platforms) {
      return []
    }

    const q = query.trim().toLowerCase()

    if (!q) {
      return platforms
    }

    return platforms.filter(platform =>
      [platform.id, platform.name, platform.description, platform.state]
        .filter(Boolean)
        .some(value => String(value).toLowerCase().includes(q))
    )
  }, [platforms, query])

  const commonPlatforms = useMemo(
    () => visiblePlatforms.filter(platform => COMMON_PLATFORM_IDS.has(platform.id)).sort(byCommonOrder),
    [visiblePlatforms]
  )

  const morePlatforms = useMemo(
    () => visiblePlatforms.filter(platform => !COMMON_PLATFORM_IDS.has(platform.id)).sort((a, b) => a.name.localeCompare(b.name)),
    [visiblePlatforms]
  )

  useEffect(() => {
    if (selected && !COMMON_PLATFORM_IDS.has(selected.id)) {
      setMoreOpen(true)
    }
  }, [selected])

  async function handleToggle(platform: MessagingPlatformInfo, enabled: boolean) {
    setSaving(`enabled:${platform.id}`)

    try {
      await updateMessagingPlatform(platform.id, { enabled })
      setPlatforms(
        current =>
          current?.map(row =>
            row.id === platform.id
              ? {
                  ...row,
                  enabled,
                  state: enabled ? (row.configured ? 'pending_restart' : 'not_configured') : 'disabled'
                }
              : row
          ) ?? current
      )
      notify({
        kind: 'success',
        title: enabled ? m.platformEnabled(platform.name) : m.platformDisabled(platform.name),
        message: m.restartToApply,
        action: restartGatewayAction
      })
    } catch (err) {
      notifyError(err, m.failedUpdate(platform.name))
    } finally {
      setSaving(null)
    }
  }

  async function handleSave(platform: MessagingPlatformInfo) {
    const env = trimEdits(edits[platform.id] || {})

    if (Object.keys(env).length === 0) {
      return
    }

    setSaving(`env:${platform.id}`)

    try {
      await updateMessagingPlatform(platform.id, { env })
      setEdits(current => ({ ...current, [platform.id]: {} }))
      await refreshPlatforms()
      notify({
        kind: 'success',
        title: m.setupSaved(platform.name),
        message: m.restartToReconnect,
        action: restartGatewayAction
      })
    } catch (err) {
      notifyError(err, m.failedSave(platform.name))
    } finally {
      setSaving(null)
    }
  }

  async function handleConnectGmail(platform: MessagingPlatformInfo) {
    setSaving(`gmail:${platform.id}`)

    try {
      const result = await connectGmailOAuth()
      setEdits(current => ({ ...current, [platform.id]: {} }))
      await refreshPlatforms()
      notify({
        kind: 'success',
        title: m.setupSaved(channelName(platform)),
        message: `${result.email} is connected. Restart messaging to use Gmail OAuth.`,
        action: restartGatewayAction
      })
    } catch (err) {
      notifyError(err, m.failedSave(channelName(platform)))
    } finally {
      setSaving(null)
    }
  }

  async function handleStartWhatsAppPairing(platform: MessagingPlatformInfo) {
    setSaving(`whatsapp:${platform.id}`)

    try {
      const result = await startWhatsAppPairing({ mode: 'self-chat' })
      setWhatsAppPairing(result)
      await refreshPlatforms(true)
      if (result.paired) {
        notify({
          kind: 'success',
          title: 'WhatsApp connected',
          message: 'Restart messaging to start receiving WhatsApp messages.',
          action: restartGatewayAction
        })
      }
    } catch (err) {
      notifyError(err, 'Failed to start WhatsApp pairing')
    } finally {
      setSaving(null)
    }
  }

  async function handleRefreshWhatsAppPairing(platform: MessagingPlatformInfo) {
    const pairingId = whatsappPairing?.pairing_id
    setSaving(`whatsapp:${platform.id}`)

    try {
      if (pairingId) {
        await cancelWhatsAppPairing(pairingId).catch(() => undefined)
      }
      const result = await startWhatsAppPairing({ mode: 'self-chat', reset: true })
      setWhatsAppPairing(result)
      await refreshPlatforms(true)
    } catch (err) {
      notifyError(err, 'Failed to refresh WhatsApp QR')
    } finally {
      setSaving(null)
    }
  }

  async function handleDisconnectWhatsApp(platform: MessagingPlatformInfo) {
    setSaving(`whatsapp-disconnect:${platform.id}`)

    try {
      await disconnectWhatsApp({ delete_session: true })
      setWhatsAppPairing(null)
      await refreshPlatforms()
      notify({
        kind: 'success',
        title: 'WhatsApp disconnected',
        message: 'The local WhatsApp session was removed.'
      })
    } catch (err) {
      notifyError(err, 'Failed to disconnect WhatsApp')
    } finally {
      setSaving(null)
    }
  }

  async function handleCancelWhatsAppPairing() {
    const pairingId = whatsappPairing?.pairing_id
    setWhatsAppPairing(null)
    if (!pairingId) {
      return
    }
    try {
      await cancelWhatsAppPairing(pairingId)
    } catch {
      // The pairing process is best-effort; hiding the QR is enough for the UI.
    }
  }

  function handleApplyPreset(platform: MessagingPlatformInfo, preset: string) {
    const next = buildSetupPreset(platform, preset)

    if (Object.keys(next).length === 0) {
      return
    }

    setEdits(current => ({
      ...current,
      [platform.id]: {
        ...(current[platform.id] || {}),
        ...next
      }
    }))
  }

  async function handleClear(platform: MessagingPlatformInfo, key: string) {
    setSaving(`clear:${key}`)

    try {
      await updateMessagingPlatform(platform.id, { clear_env: [key] })
      setEdits(current => ({
        ...current,
        [platform.id]: {
          ...(current[platform.id] || {}),
          [key]: ''
        }
      }))
      await refreshPlatforms()
      notify({ kind: 'success', title: m.keyCleared(key), message: m.setupUpdated(platform.name) })
    } catch (err) {
      notifyError(err, m.failedClear(key))
    } finally {
      setSaving(null)
    }
  }

  return (
    <PageSearchShell
      {...props}
      onSearchChange={setQuery}
      searchHidden={(platforms?.length ?? 0) === 0}
      searchPlaceholder={m.search}
      searchValue={query}
    >
      {!platforms ? (
        <PageLoader label={m.loading} />
      ) : (
        <div className="grid h-full min-h-0 grid-cols-1 lg:grid-cols-[14rem_minmax(0,1fr)]">
          <aside className="min-h-0 overflow-y-auto p-2">
            <div className="mb-3 px-2">
              <h2 className="text-sm font-semibold tracking-tight">{m.pageTitle}</h2>
              <p className="mt-1 text-xs leading-5 text-muted-foreground">{m.pageIntro}</p>
            </div>
            <PlatformList
              commonPlatforms={commonPlatforms}
              moreOpen={moreOpen || Boolean(query.trim())}
              morePlatforms={morePlatforms}
              onSelect={setSelectedId}
              onToggleMore={() => setMoreOpen(open => !open)}
              selectedId={selected?.id || null}
            />
          </aside>

          <main className="min-h-0 overflow-hidden">
            {selected && (
              <PlatformDetail
                edits={edits[selected.id] || {}}
                onClear={key => void handleClear(selected, key)}
                onEdit={(key, value) =>
                  setEdits(current => ({
                    ...current,
                    [selected.id]: {
                      ...(current[selected.id] || {}),
                      [key]: value
                    }
                  }))
                }
                onSave={() => void handleSave(selected)}
                onApplyPreset={preset => handleApplyPreset(selected, preset)}
                onCancelWhatsAppPairing={() => void handleCancelWhatsAppPairing()}
                onConnectGmail={() => void handleConnectGmail(selected)}
                onDisconnectWhatsApp={() => void handleDisconnectWhatsApp(selected)}
                onRefreshWhatsAppPairing={() => void handleRefreshWhatsAppPairing(selected)}
                onStartWhatsAppPairing={() => void handleStartWhatsAppPairing(selected)}
                onToggle={enabled => void handleToggle(selected, enabled)}
                platform={selected}
                saving={saving}
                whatsappPairing={whatsappPairing}
              />
            )}
          </main>
        </div>
      )}
    </PageSearchShell>
  )
}

function PlatformList({
  commonPlatforms,
  moreOpen,
  morePlatforms,
  onSelect,
  onToggleMore,
  selectedId
}: {
  commonPlatforms: MessagingPlatformInfo[]
  moreOpen: boolean
  morePlatforms: MessagingPlatformInfo[]
  onSelect: (platformId: string) => void
  onToggleMore: () => void
  selectedId: string | null
}) {
  const { t } = useI18n()
  const m = t.messaging

  return (
    <div className="space-y-3">
      {commonPlatforms.length > 0 && (
        <PlatformSection title={m.commonChannels}>
          {commonPlatforms.map(platform => (
            <li key={platform.id}>
              <PlatformRow
                active={selectedId === platform.id}
                onSelect={() => onSelect(platform.id)}
                platform={platform}
              />
            </li>
          ))}
        </PlatformSection>
      )}

      {morePlatforms.length > 0 && (
        <section>
          <button
            className="flex w-full items-center justify-between gap-2 rounded-md px-2 py-1 text-left text-[0.68rem] font-semibold uppercase tracking-[0.14em] text-muted-foreground transition-colors hover:bg-(--ui-row-hover-background) hover:text-foreground"
            onClick={onToggleMore}
            type="button"
          >
            <span>{m.moreChannels(morePlatforms.length)}</span>
            <DisclosureCaret open={moreOpen} size="0.875rem" />
          </button>
          {moreOpen && (
            <ul className="mt-1 space-y-1">
              {morePlatforms.map(platform => (
                <li key={platform.id}>
                  <PlatformRow
                    active={selectedId === platform.id}
                    onSelect={() => onSelect(platform.id)}
                    platform={platform}
                  />
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
    </div>
  )
}

function PlatformSection({ children, title }: { children: React.ReactNode; title: string }) {
  return (
    <section>
      <div className="px-2 pb-1 text-[0.68rem] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
        {title}
      </div>
      <ul className="space-y-1">{children}</ul>
    </section>
  )
}

function PlatformRow({
  active,
  onSelect,
  platform
}: {
  active: boolean
  onSelect: () => void
  platform: MessagingPlatformInfo
}) {
  return (
    <button
      className={cn(
        'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left transition-colors',
        active
          ? 'bg-(--ui-row-active-background) text-foreground'
          : 'text-(--ui-text-secondary) hover:bg-(--ui-row-hover-background) hover:text-foreground'
      )}
      onClick={onSelect}
      type="button"
    >
      <PlatformAvatar platformId={platform.id} platformName={channelName(platform)} />
      <span className="flex min-w-0 flex-1 items-center justify-between gap-2">
        <span className="truncate text-[length:var(--conversation-text-font-size)] font-normal">
          {channelName(platform)}
        </span>
        <StatusDot tone={stateTone(platform)} />
      </span>
    </button>
  )
}

function PlatformDetail({
  edits,
  onApplyPreset,
  onCancelWhatsAppPairing,
  onConnectGmail,
  onDisconnectWhatsApp,
  onClear,
  onEdit,
  onRefreshWhatsAppPairing,
  onSave,
  onStartWhatsAppPairing,
  onToggle,
  platform,
  saving,
  whatsappPairing
}: {
  edits: Record<string, string>
  onApplyPreset: (preset: string) => void
  onCancelWhatsAppPairing: () => void
  onConnectGmail: () => void
  onDisconnectWhatsApp: () => void
  onClear: (key: string) => void
  onEdit: (key: string, value: string) => void
  onRefreshWhatsAppPairing: () => void
  onSave: () => void
  onStartWhatsAppPairing: () => void
  onToggle: (enabled: boolean) => void
  platform: MessagingPlatformInfo
  saving: string | null
  whatsappPairing: WhatsAppPairingState
}) {
  const { t } = useI18n()
  const m = t.messaging
  const [showAdvanced, setShowAdvanced] = useState(false)

  const hasEdits = Object.keys(trimEdits(edits)).length > 0
  const requiredFields = platform.env_vars.filter(field => field.required)
  const optionalFields = platform.env_vars.filter(field => !field.required && !fieldCopy(field, m).advanced)
  const advancedFields = platform.env_vars.filter(field => !field.required && fieldCopy(field, m).advanced)
  const hiddenCount = advancedFields.length
  const isSavingEnv = saving === `env:${platform.id}`

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-2xl space-y-5 px-5 py-4">
          <header className="flex items-start gap-3">
            <PlatformAvatar platformId={platform.id} platformName={channelName(platform)} />
            <div className="min-w-0 flex-1">
              <h3 className="text-[0.9375rem] font-semibold tracking-tight">{channelName(platform)}</h3>
              <p className="mt-1 text-[length:var(--conversation-caption-font-size)] leading-(--conversation-caption-line-height) text-(--ui-text-tertiary)">
                {channelDescription(platform)}
              </p>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <StatePill tone={stateTone(platform)}>{stateLabel(platform.state, m)}</StatePill>
                <SetupPill active={platform.configured}>
                  {platform.configured ? m.credentialsSet : m.needsSetup}
                </SetupPill>
                {!platform.gateway_running && <SetupPill active={false}>{m.gatewayStopped}</SetupPill>}
              </div>
              <PlatformHint platform={platform} />
            </div>
          </header>

          <ClientSafetyCard />

          <LawyerWorkflowCard />

          <SimpleChannelSetup
            gmailBusy={saving === `gmail:${platform.id}`}
            onApplyPreset={onApplyPreset}
            onCancelWhatsAppPairing={onCancelWhatsAppPairing}
            onConnectGmail={onConnectGmail}
            onDisconnectWhatsApp={onDisconnectWhatsApp}
            onRefreshWhatsAppPairing={onRefreshWhatsAppPairing}
            onStartWhatsAppPairing={onStartWhatsAppPairing}
            platform={platform}
            whatsappBusy={saving === `whatsapp:${platform.id}`}
            whatsappPairing={whatsappPairing}
          />

          {platform.id === 'whatsapp' && <WhatsAppGuideCard />}

          {platform.error_message && (
            <div className="flex items-start gap-2 rounded-xl border border-destructive/30 bg-destructive/10 px-3 py-2 text-[length:var(--conversation-caption-font-size)] leading-(--conversation-caption-line-height) text-destructive">
              <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
              <span>{platform.error_message}</span>
            </div>
          )}

          <section>
            <SectionTitle>{m.getCredentials}</SectionTitle>
            <p className="mt-1 text-[length:var(--conversation-caption-font-size)] leading-(--conversation-caption-line-height) text-(--ui-text-tertiary)">
              {introCopy(platform, m)}
            </p>
            {!canConfigureInApp(platform) && (
              <div className="mt-3">
                <Button asChild size="sm" variant="textStrong">
                  <a href={platform.docs_url} rel="noreferrer" target="_blank">
                    {m.openSetupGuide}
                    <ExternalLink className="size-3.5" />
                  </a>
                </Button>
              </div>
            )}
          </section>

          <section>
            <SectionTitle>{m.required}</SectionTitle>
            <div className="mt-3 grid gap-1">
              {requiredFields.length > 0 ? (
                requiredFields.map(field => (
                  <MessagingField
                    edits={edits}
                    field={field}
                    key={field.key}
                    onClear={onClear}
                    onEdit={onEdit}
                    saving={saving}
                  />
                ))
              ) : (
                <p className="text-[length:var(--conversation-caption-font-size)] leading-(--conversation-caption-line-height) text-(--ui-text-tertiary)">
                  {m.noTokenNeeded}
                </p>
              )}
            </div>
          </section>

          {optionalFields.length > 0 && (
            <section>
              <SectionTitle>{m.recommended}</SectionTitle>
              <div className="mt-3 grid gap-1">
                {optionalFields.map(field => (
                  <MessagingField
                    edits={edits}
                    field={field}
                    key={field.key}
                    onClear={onClear}
                    onEdit={onEdit}
                    saving={saving}
                  />
                ))}
              </div>
            </section>
          )}

          {hiddenCount > 0 && (
            <section>
              <button
                className="flex w-full items-center justify-between gap-2 py-0.5 text-left text-[0.7rem] font-semibold uppercase tracking-[0.14em] text-muted-foreground transition-colors hover:text-foreground"
                onClick={() => setShowAdvanced(value => !value)}
                type="button"
              >
                <span>{m.advanced(hiddenCount)}</span>
                <DisclosureCaret open={showAdvanced} size="0.875rem" />
              </button>
              {showAdvanced && (
                <div className="mt-3 grid gap-1">
                  {advancedFields.map(field => (
                    <MessagingField
                      edits={edits}
                      field={field}
                      key={field.key}
                      onClear={onClear}
                      onEdit={onEdit}
                      saving={saving}
                    />
                  ))}
                </div>
              )}
            </section>
          )}
        </div>
      </div>

      <footer className="bg-(--ui-chat-surface-background) px-5 py-2.5">
        <div className="mx-auto flex max-w-2xl flex-wrap items-center gap-2">
          <div className="min-w-0">
            <p className="text-xs font-medium text-foreground">{platform.enabled ? m.channelOn : m.channelOff}</p>
            <p className="text-[0.68rem] leading-4 text-muted-foreground">{m.sendApprovalDefault}</p>
          </div>
          <Switch
            aria-label={platform.enabled ? m.disableAria(platform.name) : m.enableAria(platform.name)}
            checked={platform.enabled}
            disabled={saving === `enabled:${platform.id}`}
            onCheckedChange={onToggle}
            size="xs"
          />

          <div className="ml-auto flex items-center gap-2">
            {hasEdits && <span className="text-xs text-muted-foreground">{m.unsavedChanges}</span>}
            <Button disabled={!hasEdits || isSavingEnv} onClick={onSave} size="sm">
              <Save />
              {isSavingEnv ? m.saving : m.saveChanges}
            </Button>
          </div>
        </div>
      </footer>
    </div>
  )
}

function LawyerWorkflowCard() {
  const examples = [
    'Summarise this notice in 10 points and list urgent deadlines.',
    'Draft a WhatsApp reply to the client asking for missing documents.',
    'Prepare a client update in simple language from this order.',
    'Extract dates, limitation risk, forum, parties, and next action.',
    'Review this agreement and list Indian law risk points.',
    'Make a filing checklist for this matter.'
  ]
  const boundaries = [
    'Use chat for intake, summaries, quick review, and approval loops.',
    'Use the desktop editor for final drafts, formatting, Word export, and PDF export.',
    'LexEdge should not file, serve, or send client-facing work without lawyer approval.'
  ]

  return (
    <section className="rounded-lg border border-border/60 bg-background px-3 py-3">
      <SectionTitle>Legal messaging workflows</SectionTitle>
      <p className="mt-2 text-[length:var(--conversation-caption-font-size)] leading-5 text-(--ui-text-tertiary)">
        Messaging is best for short legal tasks from phone. Keep final drafting, formatting, and export inside the
        desktop app where review is more reliable.
      </p>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <div>
          <div className="text-xs font-medium text-foreground">Good WhatsApp instructions</div>
          <div className="mt-2 grid gap-1 text-[length:var(--conversation-caption-font-size)] leading-5 text-(--ui-text-tertiary)">
            {examples.map(example => (
              <p key={example}>{example}</p>
            ))}
          </div>
        </div>
        <div>
          <div className="text-xs font-medium text-foreground">Safe working rules</div>
          <div className="mt-2 grid gap-1 text-[length:var(--conversation-caption-font-size)] leading-5 text-(--ui-text-tertiary)">
            {boundaries.map(item => (
              <p className="flex gap-2" key={item}>
                <span className="mt-2 size-1 shrink-0 rounded-full bg-primary/70" />
                <span>{item}</span>
              </p>
            ))}
          </div>
        </div>
      </div>
    </section>
  )
}

function WhatsAppGuideCard() {
  const setupSteps = [
    'Click Existing WhatsApp phone, then scan the QR code from WhatsApp > Linked Devices.',
    'Keep WhatsApp open on your phone until the app shows WhatsApp is linked.',
    'Restart messaging if the page asks for it, then send "hi" to the linked chat.',
    'If LexEdge asks to set a home channel, reply /sethome in that same chat.',
    'Use Refresh QR when the phone says it cannot connect or the QR has expired.'
  ]
  const testSteps = [
    'Send: hi',
    'Send: Summarise this notice and list urgent deadlines.',
    'Attach or forward a document/photo only when you are comfortable sharing it with the configured AI provider.',
    'Check that the response is labelled as draft or review-only before using it externally.'
  ]
  const lawyerExamples = [
    'Draft a polite client update: hearing adjourned, next date 12 July, documents still pending.',
    'From this GST notice, identify demand amount, section, limitation issue, and reply due date.',
    'Make a checklist for filing reply to anticipatory bail application.',
    'Turn this voice note into a structured matter note with facts, issues, documents, and next steps.',
    'Prepare questions to ask the client before drafting a Section 138 notice.'
  ]
  const limits = [
    'WhatsApp is not the best place for long formatted pleadings.',
    'Use the desktop editor before final filing, service, signing, or client delivery.',
    'Do not rely on AI output as legal advice without advocate review.',
    'Avoid sending confidential third-party data unless your firm has approved the AI provider and privacy settings.'
  ]

  return (
    <section className="rounded-lg border border-primary/20 bg-primary/5 px-3 py-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <SectionTitle>WhatsApp guide for legal practice</SectionTitle>
          <p className="mt-2 max-w-xl text-[length:var(--conversation-caption-font-size)] leading-5 text-(--ui-text-tertiary)">
            Use WhatsApp as a quick assistant for intake, reminders, client updates, and rough drafts. Keep final
            document work inside LexEdge on desktop.
          </p>
        </div>
        <Button asChild size="sm" variant="secondary">
          <a href="https://www.lexedge.ai/" rel="noreferrer" target="_blank">
            LexEdge website
            <ExternalLink className="size-3.5" />
          </a>
        </Button>
      </div>

      <div className="mt-4 grid gap-3 lg:grid-cols-2">
        <GuideBlock items={setupSteps} title="Connect and verify" />
        <GuideBlock items={testSteps} title="First test" />
        <GuideBlock items={lawyerExamples} title="Useful lawyer prompts" />
        <GuideBlock items={limits} title="Important limits" />
      </div>
    </section>
  )
}

function GuideBlock({ items, title }: { items: string[]; title: string }) {
  return (
    <div className="rounded-md border border-border/60 bg-background/80 px-3 py-2.5">
      <div className="text-xs font-medium text-foreground">{title}</div>
      <div className="mt-2 grid gap-1.5 text-[length:var(--conversation-caption-font-size)] leading-5 text-(--ui-text-tertiary)">
        {items.map(item => (
          <p className="flex gap-2" key={item}>
            <span className="mt-2 size-1 shrink-0 rounded-full bg-primary/70" />
            <span>{item}</span>
          </p>
        ))}
      </div>
    </div>
  )
}

function ClientSafetyCard() {
  const { t } = useI18n()
  const m = t.messaging

  return (
    <section className="rounded-lg border border-border/60 bg-muted/20 px-3 py-3">
      <SectionTitle>{m.legalSafetyTitle}</SectionTitle>
      <div className="mt-2 grid gap-1.5 text-[length:var(--conversation-caption-font-size)] leading-5 text-(--ui-text-tertiary)">
        {m.legalSafetyItems.map(item => (
          <p className="flex gap-2" key={item}>
            <span className="mt-2 size-1 shrink-0 rounded-full bg-primary/70" />
            <span>{item}</span>
          </p>
        ))}
      </div>
    </section>
  )
}

function SimpleChannelSetup({
  gmailBusy,
  onCancelWhatsAppPairing,
  onApplyPreset,
  onConnectGmail,
  onDisconnectWhatsApp,
  onRefreshWhatsAppPairing,
  onStartWhatsAppPairing,
  platform,
  whatsappBusy,
  whatsappPairing
}: {
  gmailBusy: boolean
  onCancelWhatsAppPairing: () => void
  onApplyPreset: (preset: string) => void
  onConnectGmail: () => void
  onDisconnectWhatsApp: () => void
  onRefreshWhatsAppPairing: () => void
  onStartWhatsAppPairing: () => void
  platform: MessagingPlatformInfo
  whatsappBusy: boolean
  whatsappPairing: WhatsAppPairingState
}) {
  const { t } = useI18n()
  const m = t.messaging

  if (platform.id === 'whatsapp') {
    return (
      <section>
        <SectionTitle>{m.simpleSetup}</SectionTitle>
        {platform.configured && (
          <div className="mb-3 rounded-lg border border-primary/25 bg-primary/5 px-3 py-3">
            <p className="text-sm font-medium text-foreground">WhatsApp is linked</p>
            <p className="mt-1 text-[length:var(--conversation-caption-font-size)] leading-5 text-(--ui-text-tertiary)">
              This device has a saved WhatsApp session. Disconnect removes the local session; reconnect creates a fresh QR.
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              <Button onClick={onRefreshWhatsAppPairing} size="sm" variant="secondary">
                Reconnect
              </Button>
              <Button onClick={onDisconnectWhatsApp} size="sm" variant="text">
                Disconnect
              </Button>
            </div>
          </div>
        )}
        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          <SetupOption
            badge={whatsappBusy ? m.connectingBadge : m.connectBadge}
            body={m.whatsappPersonalBody}
            disabled={whatsappBusy}
            onSelect={onStartWhatsAppPairing}
            title={m.whatsappPersonalTitle}
          />
          <SetupOption
            badge={m.firmSetupBadge}
            body={m.whatsappBusinessBody}
            title={m.whatsappBusinessTitle}
          />
        </div>
        {whatsappPairing?.qr && !whatsappPairing.paired && (
          <WhatsAppQrPanel
            onCancel={onCancelWhatsAppPairing}
            onRefresh={onRefreshWhatsAppPairing}
            pairing={whatsappPairing}
            refreshing={whatsappBusy}
          />
        )}
      </section>
    )
  }

  if (platform.id === 'email') {
    return (
      <section>
        <SectionTitle>{m.simpleSetup}</SectionTitle>
        <div className="mt-3 grid gap-2 sm:grid-cols-3">
          <SetupOption
            badge={gmailBusy ? m.connectingBadge : m.connectBadge}
            body={m.emailGmailBody}
            disabled={gmailBusy}
            onSelect={onConnectGmail}
            title={m.emailGmailTitle}
          />
          <SetupOption
            badge={m.recommendedBadge}
            body={m.emailMicrosoftBody}
            onSelect={() => onApplyPreset('microsoft')}
            title={m.emailMicrosoftTitle}
          />
          <SetupOption badge={m.advancedBadge} body={m.emailOtherBody} title={m.emailOtherTitle} />
        </div>
      </section>
    )
  }

  if (COMMON_PLATFORM_IDS.has(platform.id)) {
    return (
      <section className="rounded-lg border border-border/60 bg-muted/20 px-3 py-3">
        <SectionTitle>{m.simpleSetup}</SectionTitle>
        <p className="mt-2 text-[length:var(--conversation-caption-font-size)] leading-5 text-(--ui-text-tertiary)">
          {m.commonSetupBody(channelName(platform))}
        </p>
      </section>
    )
  }

  return null
}

function WhatsAppQrPanel({
  onCancel,
  onRefresh,
  pairing,
  refreshing
}: {
  onCancel: () => void
  onRefresh: () => void
  pairing: WhatsAppPairingResponse
  refreshing: boolean
}) {
  const [qrDataUrl, setQrDataUrl] = useState('')

  useEffect(() => {
    let cancelled = false

    if (!pairing.qr) {
      setQrDataUrl('')
      return
    }

    void QRCode.toDataURL(pairing.qr, {
      color: {
        dark: '#111827',
        light: '#ffffff'
      },
      margin: 2,
      width: 240
    }).then(dataUrl => {
      if (!cancelled) {
        setQrDataUrl(dataUrl)
      }
    })

    return () => {
      cancelled = true
    }
  }, [pairing.qr])

  return (
    <div className="mt-3 rounded-lg border border-border/70 bg-background px-3 py-3">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="flex size-[260px] shrink-0 items-center justify-center rounded-md border border-border/60 bg-white p-2">
          {qrDataUrl ? (
            <img alt="WhatsApp pairing QR code" className="size-60" src={qrDataUrl} />
          ) : (
            <span className="text-xs text-muted-foreground">Preparing QR...</span>
          )}
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-foreground">Scan with WhatsApp</p>
          <p className="mt-1 text-[length:var(--conversation-caption-font-size)] leading-5 text-(--ui-text-tertiary)">
            Open WhatsApp on your phone, go to Linked Devices, then scan this QR code.
          </p>
          <p className="mt-2 text-[length:var(--conversation-caption-font-size)] text-muted-foreground">
            Status: {pairing.status.replace(/_/g, ' ')}
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button disabled={refreshing} onClick={onRefresh} size="sm" variant="secondary">
              {refreshing ? 'Refreshing...' : 'Refresh QR'}
            </Button>
            <Button onClick={onCancel} size="sm" variant="text">
              Cancel
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}

function SetupOption({
  badge,
  body,
  disabled = false,
  onSelect,
  title
}: {
  badge: string
  body: string
  disabled?: boolean
  onSelect?: () => void
  title: string
}) {
  const content = (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-sm font-medium text-foreground">{title}</p>
        <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[0.62rem] font-medium text-primary">
          {badge}
        </span>
      </div>
      <p className="mt-1 text-[length:var(--conversation-caption-font-size)] leading-5 text-(--ui-text-tertiary)">
        {body}
      </p>
    </>
  )

  if (!onSelect) {
    return <div className="rounded-lg border border-border/60 bg-muted/20 px-3 py-2.5">{content}</div>
  }

  return (
    <button
      className="rounded-lg border border-border/60 bg-muted/20 px-3 py-2.5 text-left transition-colors hover:border-primary/50 hover:bg-primary/5 disabled:cursor-not-allowed disabled:opacity-60"
      disabled={disabled}
      onClick={onSelect}
      type="button"
    >
      {content}
    </button>
  )
}

const PLATFORM_INTRO: Record<string, string> = {
  telegram:
    'In Telegram, talk to @BotFather, run /newbot, and copy the token it gives you. Then grab your numeric user ID from @userinfobot.',
  discord:
    'Open the Discord Developer Portal, create an application, add a Bot, then copy its token. Invite the bot to your server with the right scopes.',
  slack:
    'Create a Slack app, enable Socket Mode, install it to your workspace, then copy the bot token and app-level token.',
  mattermost:
    'On your Mattermost server, create a bot account or personal access token, then paste the server URL and token here.',
  matrix: 'Sign in to your homeserver with the bot account, then copy the access token, user ID, and homeserver URL.',
  signal:
    'Run a signal-cli REST bridge somewhere reachable, then point Hermes at the URL and the registered phone number.',
  whatsapp:
    'Start the WhatsApp bridge that ships with Hermes, scan the QR code on first run, then enable the platform.',
  bluebubbles:
    'Run BlueBubbles Server on a Mac with iMessage, expose its API, then point Hermes at the URL with the server password.',
  homeassistant:
    'In Home Assistant, open your profile and create a long-lived access token. Paste it here along with your HA URL.',
  email:
    'Use a dedicated mailbox. For Gmail/Workspace, create an app password and use imap.gmail.com / smtp.gmail.com.',
  sms: 'Get your Twilio Account SID and Auth Token from the Twilio console, plus a phone number that can send SMS.',
  dingtalk: 'Create a DingTalk app in the developer console, then copy the Client ID (App key) and Client Secret here.',
  feishu:
    'Create a Feishu / Lark app, configure the bot capability, and copy the App ID, App secret, and event encryption keys.',
  wecom:
    'Add a group robot in WeCom and copy its webhook key as WECOM_BOT_ID. Send-only — use the WeCom (app) option for two-way.',
  wecom_callback:
    'Set up a WeCom self-built app, expose its callback URL, and provide the corp ID, secret, agent ID, and AES key.',
  weixin:
    'Run `hermes gateway setup`, select Weixin, then scan and confirm the QR code with a personal WeChat account. Hermes connects through Tencent\'s iLink Bot API and saves the credentials.',
  qqbot: 'Register an app on the QQ Open Platform (q.qq.com) and copy the App ID and Client Secret.',
  api_server:
    'Expose Hermes as an OpenAI-compatible API. Set an auth key, then point Open WebUI / LobeChat / etc. at the host:port.',
  webhook:
    'Run an HTTP server that other tools (GitHub, GitLab, custom apps) can POST to. Use the secret to verify signatures.'
}

const introCopy = (platform: MessagingPlatformInfo, m: Translations['messaging']) =>
  m.platformIntro[platform.id] || PLATFORM_INTRO[platform.id] || platform.description

function MessagingField({
  edits,
  field,
  onClear,
  onEdit,
  saving
}: {
  edits: Record<string, string>
  field: MessagingEnvVarInfo
  onClear: (key: string) => void
  onEdit: (key: string, value: string) => void
  saving: string | null
}) {
  const { t } = useI18n()
  const m = t.messaging
  const copy = fieldCopy(field, m)
  const fieldId = `messaging-field-${field.key}`

  return (
    <ListRow
      action={
        <div className="flex items-center gap-2">
          <Input
            className={CREDENTIAL_CONTROL_CLASS}
            id={fieldId}
            onChange={event => onEdit(field.key, event.target.value)}
            placeholder={field.is_set ? field.redacted_value || m.replaceValue : copy.placeholder}
            type={field.is_password ? 'password' : 'text'}
            value={edits[field.key] || ''}
          />
          {field.url && (
            <Button asChild className="size-8 shrink-0" title={m.openDocs} variant="ghost">
              <a href={field.url} rel="noreferrer" target="_blank">
                <ExternalLink className="size-3.5" />
              </a>
            </Button>
          )}
          {field.is_set && (
            <Button
              className="size-8 shrink-0"
              disabled={saving === `clear:${field.key}`}
              onClick={() => onClear(field.key)}
              title={m.clearField(field.key)}
              variant="ghost"
            >
              <Trash2 className="size-3.5" />
            </Button>
          )}
        </div>
      }
      description={copy.help}
      title={
        <span className="flex flex-wrap items-center gap-2">
          <label htmlFor={fieldId}>{copy.label}</label>
          {field.is_set && <span className="text-[0.66rem] font-medium text-primary">{m.saved}</span>}
        </span>
      }
    />
  )
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <h4 className="text-[0.7rem] font-semibold uppercase tracking-[0.14em] text-muted-foreground">{children}</h4>
}

function PlatformHint({ platform }: { platform: MessagingPlatformInfo }) {
  const { t } = useI18n()

  if (!platform.enabled || platform.state === 'connected') {
    return null
  }

  const hint =
    platform.state === 'pending_restart'
      ? t.messaging.hintPendingRestart
      : platform.gateway_running
        ? null
        : t.messaging.hintGatewayStopped

  return hint ? <p className="mt-2 text-xs leading-5 text-muted-foreground">{hint}</p> : null
}

function StatePill({ children, tone }: { children: string; tone: StatusTone }) {
  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center gap-1.5 rounded-full px-2 py-0.5 text-[0.66rem] font-medium',
        PILL_TONE[tone]
      )}
    >
      <StatusDot tone={tone} />
      {children}
    </span>
  )
}

function SetupPill({ active, children }: { active: boolean; children: string }) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full px-2 py-0.5 text-[0.66rem] font-medium',
        PILL_TONE[active ? 'good' : 'muted']
      )}
    >
      {children}
    </span>
  )
}
