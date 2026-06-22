import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'

import { requestComposerInsert } from '@/app/chat/composer/focus'
import { NEW_CHAT_ROUTE } from '@/app/routes'
import { Button } from '@/components/ui/button'
import { Codicon } from '@/components/ui/codicon'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { createMatter, deleteMatter, indexMatter, listMatters } from '@/hermes'
import { selectDesktopPaths } from '@/lib/desktop-fs'
import { FileText, FolderOpen, RefreshCw, Trash2 } from '@/lib/icons'
import { matterPrompt } from '@/lib/matter-prompt'
import { cn } from '@/lib/utils'
import { notify, notifyError } from '@/store/notifications'
import type { MatterCreatePayload, MatterRecord } from '@/types/hermes'

const MATTER_TYPES = [
  ['general', 'General'],
  ['gst', 'GST / indirect tax'],
  ['civil', 'Civil litigation'],
  ['criminal', 'Criminal litigation'],
  ['contracts', 'Contracts'],
  ['corporate', 'Corporate / MCA'],
  ['income_tax', 'Income tax'],
  ['labour', 'Labour / employment'],
  ['ipr', 'IPR'],
  ['arbitration', 'Arbitration']
] as const

const ROLE_OPTIONS = [
  ['advocate', 'Advocate'],
  ['petitioner', 'Petitioner side'],
  ['respondent', 'Respondent side'],
  ['applicant', 'Applicant side'],
  ['accused', 'Accused side'],
  ['complainant', 'Complainant side'],
  ['department', 'Department side'],
  ['in_house', 'In-house counsel']
] as const

const emptyForm: MatterCreatePayload = {
  client_name: '',
  court_or_authority: '',
  folder_path: '',
  matter_type: 'general',
  name: '',
  notes: '',
  role: 'advocate'
}

function formatDate(value: number | null | undefined) {
  if (!value) {
    return 'Not indexed'
  }
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(value * 1000)
}

function formatBytes(value: number) {
  if (value < 1024) {
    return `${value} B`
  }
  if (value < 1024 * 1024) {
    return `${Math.round(value / 1024)} KB`
  }
  return `${(value / (1024 * 1024)).toFixed(1)} MB`
}

function fileSummary(matter: MatterRecord) {
  const counts = new Map<string, number>()
  for (const file of matter.files) {
    counts.set(file.extension || 'file', (counts.get(file.extension || 'file') ?? 0) + 1)
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 6)
    .map(([ext, count]) => `${count} ${ext.toUpperCase()}`)
    .join(' · ')
}

export function MattersView() {
  const navigate = useNavigate()
  const [matters, setMatters] = useState<MatterRecord[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [form, setForm] = useState<MatterCreatePayload>(emptyForm)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [indexingId, setIndexingId] = useState<string | null>(null)

  const selected = useMemo(() => matters.find(matter => matter.id === selectedId) ?? matters[0] ?? null, [matters, selectedId])

  async function refresh() {
    setLoading(true)
    try {
      const result = await listMatters()
      setMatters(result.matters)
      setSelectedId(current => current && result.matters.some(matter => matter.id === current) ? current : result.matters[0]?.id ?? null)
    } catch (err) {
      notifyError(err, 'Could not load matters.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void refresh()
  }, [])

  function setField<K extends keyof MatterCreatePayload>(key: K, value: MatterCreatePayload[K]) {
    setForm(current => ({ ...current, [key]: value }))
  }

  async function chooseFolder() {
    try {
      const [path] = await selectDesktopPaths({
        directories: true,
        multiple: false,
        title: 'Choose matter folder'
      })
      if (path) {
        setField('folder_path', path)
        if (!form.name.trim()) {
          setField('name', path.split(/[\\/]/).filter(Boolean).pop() || 'New matter')
        }
      }
    } catch (err) {
      notifyError(err, 'Could not choose folder.')
    }
  }

  async function create() {
    if (!form.name.trim() || !form.folder_path.trim()) {
      notify({ kind: 'error', title: 'Matter name and folder are required', message: 'Choose a folder and enter a matter name.' })
      return
    }
    setSaving(true)
    try {
      const result = await createMatter(form)
      setMatters(current => [result.matter, ...current])
      setSelectedId(result.matter.id)
      setForm(emptyForm)
      notify({ kind: 'success', title: 'Matter workspace created', message: `${result.matter.file_count} files indexed.` })
    } catch (err) {
      notifyError(err, 'Could not create matter.')
    } finally {
      setSaving(false)
    }
  }

  async function reindex(matter: MatterRecord) {
    setIndexingId(matter.id)
    try {
      const result = await indexMatter(matter.id)
      setMatters(current => current.map(item => (item.id === matter.id ? result.matter : item)))
      notify({ kind: 'success', title: 'Matter re-indexed', message: `${result.matter.file_count} files available.` })
    } catch (err) {
      notifyError(err, 'Could not index matter folder.')
    } finally {
      setIndexingId(null)
    }
  }

  async function remove(matter: MatterRecord) {
    if (!window.confirm(`Remove matter "${matter.name}"? This does not delete files from the folder.`)) {
      return
    }
    try {
      await deleteMatter(matter.id)
      setMatters(current => current.filter(item => item.id !== matter.id))
      setSelectedId(current => (current === matter.id ? null : current))
      notify({ kind: 'success', title: 'Matter removed', message: 'The source folder was not changed.' })
    } catch (err) {
      notifyError(err, 'Could not remove matter.')
    }
  }

  function workInChat(matter: MatterRecord) {
    navigate(NEW_CHAT_ROUTE)
    requestComposerInsert(matterPrompt(matter), { mode: 'block', target: 'main' })
  }

  return (
    <section className="flex h-full min-h-0 flex-col bg-background text-foreground">
      <header className="shrink-0 border-b border-border/70 px-6 py-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-xl font-semibold tracking-tight">Matter Workspaces</h1>
            <p className="mt-1 max-w-3xl text-sm leading-6 text-muted-foreground">
              Create a local matter workspace, attach a folder, and let LexEdge work only with that folder when you ask.
            </p>
          </div>
          <Button onClick={() => selected && workInChat(selected)} disabled={!selected}>
            Open in chat
          </Button>
        </div>
      </header>

      <div className="grid min-h-0 flex-1 grid-cols-[minmax(20rem,25rem)_minmax(0,1fr)] overflow-hidden">
        <aside className="min-h-0 border-r border-border/70 bg-muted/20">
          <div className="border-b border-border/70 p-4">
            <div className="mb-3 text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">New matter</div>
            <div className="grid gap-2">
              <Input placeholder="Matter name" value={form.name} onChange={e => setField('name', e.target.value)} />
              <Input placeholder="Client name" value={form.client_name} onChange={e => setField('client_name', e.target.value)} />
              <div className="grid grid-cols-2 gap-2">
                <Select value={form.matter_type || 'general'} onValueChange={value => setField('matter_type', value)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {MATTER_TYPES.map(([value, label]) => (
                      <SelectItem key={value} value={value}>
                        {label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Select value={form.role || 'advocate'} onValueChange={value => setField('role', value)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {ROLE_OPTIONS.map(([value, label]) => (
                      <SelectItem key={value} value={value}>
                        {label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <Input
                placeholder="Court, tribunal, authority"
                value={form.court_or_authority}
                onChange={e => setField('court_or_authority', e.target.value)}
              />
              <div className="flex gap-2">
                <Input
                  className="min-w-0"
                  placeholder="Matter folder path"
                  value={form.folder_path}
                  onChange={e => setField('folder_path', e.target.value)}
                />
                <Button onClick={chooseFolder} size="icon" type="button" variant="secondary">
                  <FolderOpen className="size-4" />
                </Button>
              </div>
              <Textarea
                className="min-h-20"
                placeholder="Internal notes, deadlines, or special instructions"
                value={form.notes}
                onChange={e => setField('notes', e.target.value)}
              />
              <Button disabled={saving} onClick={create}>
                {saving ? 'Creating...' : 'Create and index'}
              </Button>
            </div>
          </div>

          <div className="min-h-0 overflow-y-auto p-2">
            {loading ? (
              <div className="px-2 py-4 text-sm text-muted-foreground">Loading matters...</div>
            ) : matters.length === 0 ? (
              <div className="px-2 py-4 text-sm text-muted-foreground">No matter workspaces yet.</div>
            ) : (
              matters.map(matter => (
                <button
                  className={cn(
                    'mb-1 flex w-full flex-col rounded-md border border-transparent px-3 py-2 text-left hover:bg-muted',
                    selected?.id === matter.id && 'border-border bg-background shadow-sm'
                  )}
                  key={matter.id}
                  onClick={() => setSelectedId(matter.id)}
                  type="button"
                >
                  <span className="text-sm font-medium">{matter.name}</span>
                  <span className="mt-0.5 truncate text-xs text-muted-foreground">{matter.client_name || matter.folder_path}</span>
                  <span className="mt-1 text-xs text-muted-foreground">
                    {matter.file_count} files · {matter.matter_type}
                  </span>
                </button>
              ))
            )}
          </div>
        </aside>

        <main className="min-h-0 overflow-y-auto p-6">
          {!selected ? (
            <div className="grid h-full place-items-center text-center">
              <div>
                <FolderOpen className="mx-auto size-9 text-muted-foreground" />
                <div className="mt-3 text-sm font-medium">Create a matter to begin</div>
                <div className="mt-1 text-xs text-muted-foreground">Files stay in the selected folder on this machine.</div>
              </div>
            </div>
          ) : (
            <div className="mx-auto flex max-w-5xl flex-col gap-6">
              <section className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <h2 className="text-lg font-semibold">{selected.name}</h2>
                  <p className="mt-1 text-sm text-muted-foreground">{selected.folder_path}</p>
                </div>
                <div className="flex gap-2">
                  <Button disabled={indexingId === selected.id} onClick={() => reindex(selected)} variant="secondary">
                    <RefreshCw className="mr-2 size-4" />
                    {indexingId === selected.id ? 'Indexing...' : 'Re-index'}
                  </Button>
                  <Button onClick={() => workInChat(selected)}>Work in chat</Button>
                  <Button onClick={() => remove(selected)} size="icon" variant="ghost">
                    <Trash2 className="size-4" />
                  </Button>
                </div>
              </section>

              <section className="grid grid-cols-4 gap-3">
                <MatterMetric label="Client" value={selected.client_name || 'Not set'} />
                <MatterMetric label="Type" value={selected.matter_type} />
                <MatterMetric label="Files" value={String(selected.file_count)} />
                <MatterMetric label="Indexed" value={formatDate(selected.indexed_at)} />
              </section>

              <section>
                <div className="mb-2 text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                  Workspace rules
                </div>
                <div className="rounded-md border border-border bg-background p-4 text-sm leading-6">
                  LexEdge will use this folder as the matter boundary. Indexing records file metadata only. When working
                  in chat, it should read relevant PDFs, DOCX, spreadsheets, presentations, text, and images from this
                  folder, ask before using unrelated locations, and keep legal output as draft for human review.
                </div>
              </section>

              <section>
                <div className="mb-2 flex items-center justify-between gap-3">
                  <div>
                    <div className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">Documents</div>
                    <div className="mt-1 text-xs text-muted-foreground">
                      {fileSummary(selected) || 'No supported documents indexed'} · {selected.skipped_count} skipped
                    </div>
                  </div>
                </div>
                <div className="overflow-hidden rounded-md border border-border">
                  {selected.files.length === 0 ? (
                    <div className="px-4 py-8 text-center text-sm text-muted-foreground">No supported files found.</div>
                  ) : (
                    <div className="divide-y divide-border/70">
                      {selected.files.slice(0, 120).map(file => (
                        <div className="grid grid-cols-[1fr_5rem_8rem] items-center gap-3 px-4 py-2 text-sm" key={file.path}>
                          <div className="flex min-w-0 items-center gap-2">
                            <FileText className="size-4 shrink-0 text-muted-foreground" />
                            <div className="min-w-0">
                              <div className="truncate font-medium">{file.name}</div>
                              <div className="truncate text-xs text-muted-foreground">{file.path}</div>
                            </div>
                          </div>
                          <div className="text-xs uppercase text-muted-foreground">{file.extension || 'file'}</div>
                          <div className="text-right text-xs text-muted-foreground">{formatBytes(file.size)}</div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
                {selected.files.length > 120 && (
                  <div className="mt-2 text-xs text-muted-foreground">
                    Showing first 120 files. The full indexed list is available to the chat prompt.
                  </div>
                )}
              </section>
            </div>
          )}
        </main>
      </div>
    </section>
  )
}

function MatterMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-border bg-background p-3">
      <div className="text-xs font-medium uppercase tracking-[0.14em] text-muted-foreground">{label}</div>
      <div className="mt-1 truncate text-sm font-medium">{value}</div>
    </div>
  )
}

export default MattersView
