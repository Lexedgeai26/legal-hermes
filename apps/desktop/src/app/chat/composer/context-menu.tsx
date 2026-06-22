import { useEffect, useState } from 'react'

import { composerPanelCard } from '@/components/chat/composer-dock'
import { Button } from '@/components/ui/button'
import { Codicon } from '@/components/ui/codicon'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { Kbd } from '@/components/ui/kbd'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { createMatter, listMatters } from '@/hermes'
import { useI18n } from '@/i18n'
import { selectDesktopPaths } from '@/lib/desktop-fs'
import { Clipboard, FileText, FolderOpen, type IconComponent, ImageIcon, Link, MessageSquareText } from '@/lib/icons'
import { matterPrompt } from '@/lib/matter-prompt'
import { cn } from '@/lib/utils'
import { setComposerMatterAttachment } from '@/store/composer'
import { notify, notifyError } from '@/store/notifications'
import type { MatterCreatePayload, MatterRecord } from '@/types/hermes'

import { GHOST_ICON_BTN } from './controls'
import type { ChatBarState } from './types'

const SNIPPET_KEYS = ['codeReview', 'implementationPlan', 'explainThis']
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

const emptyMatterForm: MatterCreatePayload = {
  client_name: '',
  court_or_authority: '',
  folder_path: '',
  matter_type: 'general',
  name: '',
  notes: '',
  role: 'advocate'
}

export function ContextMenu({
  state,
  onInsertText,
  onOpenUrlDialog,
  onPasteClipboardImage,
  onPickFiles,
  onPickFolders,
  onPickImages
}: ContextMenuProps) {
  const { t } = useI18n()
  const c = t.composer
  // Prompt snippets used to be a Radix submenu. That submenu didn't open
  // reliably when the parent menu was positioned at the bottom of the
  // window (composer "+" anchor), so we promoted it to a real Dialog —
  // easier to grow with search / descriptions, and no positioning math.
  const [snippetsOpen, setSnippetsOpen] = useState(false)
  const [mattersOpen, setMattersOpen] = useState(false)

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            aria-label={state.tools.label}
            className={cn(
              GHOST_ICON_BTN,
              'data-[state=open]:bg-(--chrome-action-hover) data-[state=open]:text-foreground'
            )}
            disabled={!state.tools.enabled}
            size="icon"
            title={state.tools.label}
            type="button"
            variant="ghost"
          >
            <Codicon name="add" size="0.875rem" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className={cn('w-60', composerPanelCard)} side="top" sideOffset={6}>
          <DropdownMenuLabel className="px-2 pb-0.5 pt-0.5 text-[0.625rem] font-semibold uppercase tracking-wider text-(--ui-text-tertiary)">
            {c.attachLabel}
          </DropdownMenuLabel>
          <ContextMenuItem icon={FolderOpen} onSelect={() => setMattersOpen(true)}>
            Matter…
          </ContextMenuItem>
          <DropdownMenuSeparator />
          <ContextMenuItem disabled={!onPickFiles} icon={FileText} onSelect={onPickFiles}>
            {c.files}
          </ContextMenuItem>
          <ContextMenuItem disabled={!onPickFolders} icon={FolderOpen} onSelect={onPickFolders}>
            {c.folder}
          </ContextMenuItem>
          <ContextMenuItem disabled={!onPickImages} icon={ImageIcon} onSelect={onPickImages}>
            {c.images}
          </ContextMenuItem>
          <ContextMenuItem disabled={!onPasteClipboardImage} icon={Clipboard} onSelect={onPasteClipboardImage}>
            {c.pasteImage}
          </ContextMenuItem>
          <ContextMenuItem icon={Link} onSelect={onOpenUrlDialog}>
            {c.url}
          </ContextMenuItem>

          <DropdownMenuSeparator />

          <ContextMenuItem icon={MessageSquareText} onSelect={() => setSnippetsOpen(true)}>
            {c.promptSnippets}
          </ContextMenuItem>

          <DropdownMenuSeparator />

          <div className="px-2 py-1 text-[0.7rem] text-muted-foreground/80">
            {c.tipPre}
            <Kbd size="sm">@</Kbd>
            {c.tipPost}
          </div>
        </DropdownMenuContent>
      </DropdownMenu>

      <MatterDialog onOpenChange={setMattersOpen} open={mattersOpen} />
      <PromptSnippetsDialog onInsertText={onInsertText} onOpenChange={setSnippetsOpen} open={snippetsOpen} />
    </>
  )
}

function MatterDialog({ onOpenChange, open }: MatterDialogProps) {
  const [matters, setMatters] = useState<MatterRecord[]>([])
  const [form, setForm] = useState<MatterCreatePayload>(emptyMatterForm)
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!open) {
      return
    }

    let cancelled = false

    async function refresh() {
      setLoading(true)
      try {
        const result = await listMatters()
        if (!cancelled) {
          setMatters(result.matters)
        }
      } catch (err) {
        notifyError(err, 'Could not load matters.')
      } finally {
        if (!cancelled) {
          setLoading(false)
        }
      }
    }

    void refresh()

    return () => {
      cancelled = true
    }
  }, [open])

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
      if (!path) {
        return
      }
      setField('folder_path', path)
      setForm(current => ({
        ...current,
        folder_path: path,
        name: current.name.trim() || path.split(/[\\/]/).filter(Boolean).pop() || 'New matter'
      }))
    } catch (err) {
      notifyError(err, 'Could not choose folder.')
    }
  }

  function selectMatter(matter: MatterRecord) {
    addMatterAttachment(matter)
    onOpenChange(false)
  }

  async function createAndSelect() {
    if (!form.name.trim() || !form.folder_path.trim()) {
      notify({ kind: 'error', title: 'Matter name and folder are required', message: 'Choose a folder and enter a matter name.' })
      return
    }

    setSaving(true)
    try {
      const result = await createMatter(form)
      setMatters(current => [result.matter, ...current])
      setForm(emptyMatterForm)
      addMatterAttachment(result.matter)
      onOpenChange(false)
      notify({ kind: 'success', title: 'Matter workspace created', message: `${result.matter.file_count} files indexed.` })
    } catch (err) {
      notifyError(err, 'Could not create matter.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent className="max-w-2xl gap-4">
        <DialogHeader>
          <DialogTitle>Select matter workspace</DialogTitle>
          <DialogDescription>
            Attach the correct client matter before chatting so LexEdge stays inside the right folder and documents.
          </DialogDescription>
        </DialogHeader>

        <div className="grid max-h-[65vh] gap-4 overflow-y-auto pr-1">
          <section>
            <div className="mb-2 text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">Existing matters</div>
            {loading ? (
              <div className="rounded-md border border-border px-3 py-3 text-sm text-muted-foreground">Loading matters...</div>
            ) : matters.length === 0 ? (
              <div className="rounded-md border border-border px-3 py-3 text-sm text-muted-foreground">
                No matter workspaces yet. Create one below.
              </div>
            ) : (
              <div className="grid gap-2">
                {matters.slice(0, 8).map(matter => (
                  <button
                    className="flex w-full flex-col rounded-md border border-border bg-background px-3 py-2 text-left transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    key={matter.id}
                    onClick={() => selectMatter(matter)}
                    type="button"
                  >
                    <span className="text-sm font-semibold text-foreground">{matter.name}</span>
                    <span className="mt-0.5 truncate text-xs text-muted-foreground">
                      {matter.client_name || 'No client'} · {matter.file_count} files · {matter.matter_type}
                    </span>
                    <span className="mt-0.5 truncate text-xs text-muted-foreground">{matter.folder_path}</span>
                  </button>
                ))}
              </div>
            )}
          </section>

          <section className="rounded-md border border-border bg-muted/20 p-3">
            <div className="mb-3 text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">Create new matter</div>
            <div className="grid gap-2">
              <div className="grid grid-cols-2 gap-2">
                <Input placeholder="Matter name" value={form.name} onChange={event => setField('name', event.target.value)} />
                <Input
                  placeholder="Client name"
                  value={form.client_name}
                  onChange={event => setField('client_name', event.target.value)}
                />
              </div>
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
                onChange={event => setField('court_or_authority', event.target.value)}
              />
              <div className="flex gap-2">
                <Input
                  className="min-w-0"
                  placeholder="Matter folder path"
                  value={form.folder_path}
                  onChange={event => setField('folder_path', event.target.value)}
                />
                <Button onClick={chooseFolder} size="icon" type="button" variant="secondary">
                  <FolderOpen className="size-4" />
                </Button>
              </div>
              <Textarea
                className="min-h-16"
                placeholder="Internal notes, deadlines, or special instructions"
                value={form.notes}
                onChange={event => setField('notes', event.target.value)}
              />
              <Button disabled={saving} onClick={createAndSelect} type="button">
                {saving ? 'Creating...' : 'Create and use in chat'}
              </Button>
            </div>
          </section>
        </div>
      </DialogContent>
    </Dialog>
  )
}

function addMatterAttachment(matter: MatterRecord) {
  setComposerMatterAttachment({
    id: `matter:${matter.id}`,
    kind: 'folder',
    label: `Matter: ${matter.name}`,
    detail: `${matter.file_count} files · ${matter.folder_path}`,
    contextText: matterPrompt(matter, 'Use this matter for my next instruction. Wait for my specific task.'),
    persistent: true
  })
}

function PromptSnippetsDialog({ onInsertText, onOpenChange, open }: PromptSnippetsDialogProps) {
  const { t } = useI18n()
  const c = t.composer

  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent className="max-w-md gap-3">
        <DialogHeader>
          <DialogTitle>{c.snippetsTitle}</DialogTitle>
          <DialogDescription>{c.snippetsDesc}</DialogDescription>
        </DialogHeader>
        <ul className="grid gap-1">
          {SNIPPET_KEYS.map(key => {
            const snippet = c.snippets[key]

            return (
              <li key={key}>
                <button
                  className="group/snippet flex w-full cursor-pointer items-start gap-2.5 rounded-md border border-transparent px-2.5 py-2 text-left transition-colors hover:border-(--ui-stroke-tertiary) hover:bg-(--ui-control-hover-background) focus-visible:border-(--ui-stroke-tertiary) focus-visible:bg-(--ui-control-hover-background) focus-visible:outline-none"
                  onClick={() => {
                    onInsertText(snippet.text)
                    onOpenChange(false)
                  }}
                  type="button"
                >
                  <MessageSquareText className="mt-0.5 size-3.5 shrink-0 text-(--ui-text-tertiary) group-hover/snippet:text-foreground" />
                  <span className="grid min-w-0 gap-0.5">
                    <span className="text-sm font-medium text-foreground">{snippet.label}</span>
                    <span className="text-[length:var(--conversation-caption-font-size)] text-(--ui-text-tertiary)">
                      {snippet.description}
                    </span>
                  </span>
                </button>
              </li>
            )
          })}
        </ul>
      </DialogContent>
    </Dialog>
  )
}

export function ContextMenuItem({ children, disabled, icon: Icon, onSelect }: ContextMenuItemProps) {
  return (
    // Override font size + highlight to match the / · @ completion rows exactly.
    <DropdownMenuItem
      className="text-[length:var(--conversation-tool-font-size)] focus:bg-(--ui-bg-tertiary)"
      disabled={disabled}
      onSelect={onSelect}
    >
      <Icon />
      <span>{children}</span>
    </DropdownMenuItem>
  )
}

interface ContextMenuItemProps {
  children: string
  disabled?: boolean
  icon: IconComponent
  onSelect?: () => void
}

interface ContextMenuProps {
  onInsertText: (text: string) => void
  onOpenUrlDialog: () => void
  onPasteClipboardImage?: () => void
  onPickFiles?: () => void
  onPickFolders?: () => void
  onPickImages?: () => void
  state: ChatBarState
}

interface PromptSnippetsDialogProps {
  onInsertText: (text: string) => void
  onOpenChange: (open: boolean) => void
  open: boolean
}

interface MatterDialogProps {
  onOpenChange: (open: boolean) => void
  open: boolean
}
