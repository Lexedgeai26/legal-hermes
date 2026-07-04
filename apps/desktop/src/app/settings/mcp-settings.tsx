import { useStore } from '@nanostores/react'
import { useEffect, useMemo, useState } from 'react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import {
  getActionStatus,
  getHermesConfigRecord,
  getMcpCatalog,
  installMcpCatalogEntry,
  type HermesGateway,
  saveHermesConfig
} from '@/hermes'
import { useI18n } from '@/i18n'
import { ExternalLink, Loader2, Wrench, Zap } from '@/lib/icons'
import { cn } from '@/lib/utils'
import { notify, notifyError } from '@/store/notifications'
import { $activeSessionId } from '@/store/session'
import type { ActionStatusResponse, HermesConfigRecord, McpCatalogEntry } from '@/types/hermes'

import { EmptyState, LoadingState, Pill, SettingsContent } from './primitives'
import { useDeepLinkHighlight } from './use-deep-link-highlight'

interface McpSettingsProps {
  gateway?: HermesGateway | null
  onConfigSaved?: () => void
}

type McpServers = Record<string, Record<string, unknown>>

const N8N_DOCS_URL = 'https://hermes-agent.ai/integrations/n8n'
const N8N_DEFAULT_URL = 'http://127.0.0.1:5678'

const EMPTY_SERVER = {
  command: '',
  args: [],
  env: {}
}

function getServers(config: HermesConfigRecord | null): McpServers {
  const raw = config?.mcp_servers

  return raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as McpServers) : {}
}

const transportLabel = (server: Record<string, unknown>) =>
  typeof server.transport === 'string'
    ? server.transport
    : typeof server.url === 'string'
      ? 'http'
      : typeof server.command === 'string'
        ? 'stdio'
        : 'custom'

function N8nSetupCard({
  installed,
  onInstalled
}: {
  installed: boolean
  onInstalled: () => void
}) {
  const [entry, setEntry] = useState<McpCatalogEntry | null>(null)
  const [baseUrl, setBaseUrl] = useState(N8N_DEFAULT_URL)
  const [apiKey, setApiKey] = useState('')
  const [loading, setLoading] = useState(true)
  const [installing, setInstalling] = useState(false)
  const [status, setStatus] = useState<ActionStatusResponse | null>(null)

  useEffect(() => {
    let cancelled = false

    getMcpCatalog()
      .then(catalog => {
        if (cancelled) {
          return
        }
        setEntry(catalog.entries.find(item => item.name === 'n8n') ?? null)
      })
      .catch(err => notifyError(err, 'Could not load the MCP catalog.'))
      .finally(() => {
        if (!cancelled) {
          setLoading(false)
        }
      })

    return () => void (cancelled = true)
  }, [])

  useEffect(() => {
    if (!installing) {
      return
    }

    let cancelled = false
    const poll = async () => {
      try {
        const next = await getActionStatus('mcp-install', 80)
        if (cancelled) {
          return
        }
        setStatus(next)
        if (!next.running) {
          setInstalling(false)
          if (next.exit_code === 0) {
            notify({
              kind: 'success',
              title: 'n8n automation connected',
              message: 'Reload MCP or start a new chat session to use the n8n tools.'
            })
            onInstalled()
          } else if (next.exit_code !== null) {
            notify({
              kind: 'error',
              title: 'n8n setup failed',
              message: 'Open the installer output for details.'
            })
          }
        }
      } catch (err) {
        if (!cancelled) {
          notifyError(err, 'Could not read the n8n install status.')
        }
      }
    }

    void poll()
    const id = window.setInterval(() => void poll(), 2000)

    return () => {
      cancelled = true
      window.clearInterval(id)
    }
  }, [installing, onInstalled])

  const install = async () => {
    const url = baseUrl.trim()
    const key = apiKey.trim()

    if (!url) {
      notify({ kind: 'error', title: 'n8n URL required', message: 'Enter your n8n instance URL.' })
      return
    }
    if (!key) {
      notify({ kind: 'error', title: 'n8n API key required', message: 'Generate an API key in n8n Settings -> API.' })
      return
    }

    setInstalling(true)
    setStatus(null)

    try {
      const result = await installMcpCatalogEntry({
        name: 'n8n',
        enable: true,
        env: {
          N8N_BASE_URL: url,
          N8N_API_KEY: key
        }
      })

      if (!result.background) {
        setInstalling(false)
        notify({
          kind: 'success',
          title: 'n8n automation connected',
          message: 'Reload MCP or start a new chat session to use the n8n tools.'
        })
        onInstalled()
      }
    } catch (err) {
      setInstalling(false)
      notifyError(err, 'Could not install the n8n MCP integration.')
    }
  }

  const recentLines = status?.lines.slice(-8) ?? []

  return (
    <div className="mb-6 rounded-lg border bg-(--ui-bg-secondary) p-4">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-sm font-semibold">
            <Zap className="size-4 text-primary" />
            n8n Automation
            {installed && <Pill>installed</Pill>}
          </div>
          <p className="mt-1 max-w-2xl text-sm leading-6 text-muted-foreground">
            Connect LexEdge/Hermes to an existing n8n instance. n8n runs separately; this only installs the Hermes MCP bridge and stores your n8n URL/API key locally.
          </p>
        </div>
        <Button
          onClick={() => window.hermesDesktop?.openExternal?.(N8N_DOCS_URL)}
          size="xs"
          type="button"
          variant="text"
        >
          <ExternalLink className="size-3.5" />
          Guide
        </Button>
      </div>

      {loading ? (
        <div className="mt-4 flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" />
          Checking n8n catalog entry...
        </div>
      ) : !entry ? (
        <div className="mt-4 rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
          n8n is not available in this Hermes MCP catalog.
        </div>
      ) : (
        <>
          <div className="mt-4 grid gap-3 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]">
            <label className="grid gap-1.5">
              <span className="text-xs text-muted-foreground">n8n URL</span>
              <Input
                disabled={installing}
                onChange={event => setBaseUrl(event.currentTarget.value)}
                placeholder={N8N_DEFAULT_URL}
                value={baseUrl}
              />
            </label>
            <label className="grid gap-1.5">
              <span className="text-xs text-muted-foreground">n8n API key</span>
              <Input
                autoComplete="off"
                disabled={installing}
                onChange={event => setApiKey(event.currentTarget.value)}
                placeholder="Generate in n8n Settings -> API"
                type="password"
                value={apiKey}
              />
            </label>
            <div className="flex items-end">
              <Button disabled={installing} onClick={() => void install()} size="sm" type="button">
                {installing ? <Loader2 className="size-4 animate-spin" /> : null}
                {installed ? 'Update n8n' : 'Connect n8n'}
              </Button>
            </div>
          </div>
          <p className="mt-2 text-xs leading-5 text-muted-foreground">
            Default tools are read-mostly: health, workflow lookup, executions, recent failures, and workflow export.
          </p>
          {recentLines.length > 0 && (
            <div className="mt-4 rounded-md border bg-background/70 p-3">
              <div className="mb-2 text-xs font-medium uppercase tracking-[0.14em] text-muted-foreground">
                Install output
              </div>
              <div className="space-y-1 font-mono text-[11px] leading-5 text-muted-foreground">
                {recentLines.map((line, index) => (
                  <div className="truncate" key={`${index}-${line}`}>
                    {line}
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}

export function McpSettings({ gateway, onConfigSaved }: McpSettingsProps) {
  const { t } = useI18n()
  const m = t.settings.mcp
  const activeSessionId = useStore($activeSessionId)
  const [config, setConfig] = useState<HermesConfigRecord | null>(null)
  const [selected, setSelected] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [body, setBody] = useState('')
  const [saving, setSaving] = useState(false)
  const [reloading, setReloading] = useState(false)

  useEffect(() => {
    let cancelled = false

    getHermesConfigRecord()
      .then(next => {
        if (cancelled) {
          return
        }

        setConfig(next)
        const first = Object.keys(getServers(next)).sort()[0] ?? null
        setSelected(first)
      })
      .catch(err => notifyError(err, m.failedLoad))

    return () => void (cancelled = true)
  }, [])

  const servers = useMemo(() => getServers(config), [config])
  const names = useMemo(() => Object.keys(servers).sort(), [servers])
  const n8nInstalled = Boolean(servers.n8n)

  useDeepLinkHighlight({
    block: 'nearest',
    elementId: serverName => `mcp-server-${serverName}`,
    onResolve: setSelected,
    param: 'server',
    ready: serverName => Boolean(config) && serverName in servers
  })

  useEffect(() => {
    const server = selected ? servers[selected] : null

    setName(selected ?? '')
    setBody(JSON.stringify(server ?? EMPTY_SERVER, null, 2))
  }, [selected, servers])

  if (!config) {
    return <LoadingState label={m.loading} />
  }

  const saveServer = async () => {
    const nextName = name.trim()

    if (!nextName) {
      notify({ kind: 'error', title: m.nameRequiredTitle, message: m.nameRequiredMessage })

      return
    }

    let parsed: Record<string, unknown>

    try {
      const raw = JSON.parse(body)

      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
        throw new Error(m.objectRequired)
      }

      parsed = raw as Record<string, unknown>
    } catch (err) {
      notifyError(err, m.invalidJson)

      return
    }

    setSaving(true)

    try {
      const nextServers = { ...servers }

      if (selected && selected !== nextName) {
        delete nextServers[selected]
      }

      nextServers[nextName] = parsed

      const nextConfig = { ...config, mcp_servers: nextServers }
      await saveHermesConfig(nextConfig)
      setConfig(nextConfig)
      setSelected(nextName)
      onConfigSaved?.()
      notify({ kind: 'success', title: m.savedTitle, message: m.savedMessage(nextName) })
    } catch (err) {
      notifyError(err, m.saveFailed)
    } finally {
      setSaving(false)
    }
  }

  const removeServer = async (serverName: string) => {
    setSaving(true)

    try {
      const nextServers = { ...servers }
      delete nextServers[serverName]

      const nextConfig = { ...config, mcp_servers: nextServers }
      await saveHermesConfig(nextConfig)
      setConfig(nextConfig)
      setSelected(Object.keys(nextServers).sort()[0] ?? null)
      onConfigSaved?.()
    } catch (err) {
      notifyError(err, m.removeFailed)
    } finally {
      setSaving(false)
    }
  }

  const reloadMcp = async () => {
    if (!gateway) {
      notify({ kind: 'warning', title: m.gatewayUnavailableTitle, message: m.gatewayUnavailableMessage })

      return
    }

    setReloading(true)

    try {
      await gateway.request('reload.mcp', {
        confirm: true,
        session_id: activeSessionId ?? undefined
      })
      notify({ kind: 'success', title: m.reloadedTitle, message: m.reloadedMessage })
    } catch (err) {
      notifyError(err, m.reloadFailed)
    } finally {
      setReloading(false)
    }
  }

  return (
    <SettingsContent>
      <N8nSetupCard
        installed={n8nInstalled}
        onInstalled={() => {
          void getHermesConfigRecord()
            .then(next => {
              setConfig(next)
              setSelected('n8n')
              onConfigSaved?.()
            })
            .catch(err => notifyError(err, m.failedLoad))
        }}
      />

      <div className="mb-4 flex items-center justify-end gap-4">
        <Button onClick={() => setSelected(null)} size="xs" variant="text">
          {m.newServer}
        </Button>
        <Button disabled={reloading} onClick={() => void reloadMcp()} size="xs" variant="text">
          {reloading ? m.reloading : m.reload}
        </Button>
      </div>

      <div className="grid min-h-0 gap-6 lg:grid-cols-[16rem_minmax(0,1fr)]">
        <div className="min-h-64">
          {names.length === 0 ? (
            <EmptyState description={m.emptyDesc} title={m.emptyTitle} />
          ) : (
            <div className="grid gap-0.5">
              {names.map(serverName => {
                const server = servers[serverName]
                const active = selected === serverName

                return (
                  <button
                    className={cn(
                      'scroll-mt-2 rounded-md px-2 py-2 text-left transition-colors hover:bg-(--chrome-action-hover)',
                      active ? 'bg-(--ui-bg-tertiary) text-foreground' : 'text-muted-foreground'
                    )}
                    id={`mcp-server-${serverName}`}
                    key={serverName}
                    onClick={() => setSelected(serverName)}
                    type="button"
                  >
                    <div className="truncate text-sm font-medium">{serverName}</div>
                    <div className="mt-1 flex items-center gap-1.5">
                      <Pill>{transportLabel(server)}</Pill>
                      {server.disabled === true && <Pill>{m.disabled}</Pill>}
                    </div>
                  </button>
                )
              })}
            </div>
          )}
        </div>

        <div className="grid content-start gap-3">
          <div className="flex items-center gap-2 text-sm font-medium">
            <Wrench className="size-4 text-muted-foreground" />
            {selected ? m.editServer : m.newServer}
          </div>
          <label className="grid gap-1.5">
            <span className="text-xs text-muted-foreground">{m.name}</span>
            <Input onChange={event => setName(event.currentTarget.value)} placeholder="filesystem" value={name} />
          </label>
          <label className="grid gap-1.5">
            <span className="text-xs text-muted-foreground">{m.serverJson}</span>
            <Textarea
              className="min-h-80 font-mono text-xs"
              onChange={event => setBody(event.currentTarget.value)}
              spellCheck={false}
              value={body}
            />
          </label>
          <div className="flex items-center justify-between">
            {selected ? (
              <Button
                className="text-destructive hover:text-destructive"
                disabled={saving}
                onClick={() => void removeServer(selected)}
                size="xs"
                variant="text"
              >
                {m.remove}
              </Button>
            ) : (
              <span />
            )}
            <Button disabled={saving} onClick={() => void saveServer()} size="sm">
              {saving ? t.common.saving : m.saveServer}
            </Button>
          </div>
        </div>
      </div>
    </SettingsContent>
  )
}
