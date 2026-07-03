import { useState } from 'react'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import type { ClaudeImportReport } from '@/hermes'
import { importClaudeSkills } from '@/hermes'

// Two-step flow: Preview (dry-run, nothing written) -> Import. Every state
// tells the user what happened and what to do next in plain language, and the
// dialog can always be cancelled.
export function ImportClaudeDialog({
  onImported,
  onOpenChange,
  open
}: {
  onImported: () => void
  onOpenChange: (open: boolean) => void
  open: boolean
}) {
  const [source, setSource] = useState('')
  const [category, setCategory] = useState('')
  const [busy, setBusy] = useState<'import' | 'preview' | null>(null)
  const [report, setReport] = useState<ClaudeImportReport | null>(null)
  const [problem, setProblem] = useState<string | null>(null)

  const reset = () => {
    setReport(null)
    setProblem(null)
    setBusy(null)
  }

  const close = (next: boolean) => {
    if (!next) {
      reset()
      setSource('')
      setCategory('')
    }
    onOpenChange(next)
  }

  const run = async (dryRun: boolean) => {
    setBusy(dryRun ? 'preview' : 'import')
    setProblem(null)
    try {
      const next = await importClaudeSkills({
        source: source.trim(),
        category: category.trim() || undefined,
        dryRun
      })
      setReport(next)
      if (!dryRun) {
        onImported()
      }
    } catch (err) {
      setReport(null)
      setProblem(friendlyProblem(err))
    } finally {
      setBusy(null)
    }
  }

  const canRun = source.trim().length > 0 && busy === null
  const finished = Boolean(report && !report.dry_run)

  return (
    <Dialog onOpenChange={close} open={open}>
      <DialogContent className="max-w-lg gap-4">
        <DialogHeader>
          <DialogTitle>Import Claude skills</DialogTitle>
          <DialogDescription>
            Bring any Claude Code skill, command, or plugin into your assistant. Paste a git link or a folder path —
            we&rsquo;ll convert it for you and check it for safety first.
          </DialogDescription>
        </DialogHeader>

        <form
          className="grid gap-3"
          onSubmit={e => {
            e.preventDefault()
            if (canRun) {
              void run(true)
            }
          }}
        >
          <div className="grid gap-1.5">
            <label className="text-xs font-medium" htmlFor="claude-import-source">
              Where is the skill?
            </label>
            <Input
              autoComplete="off"
              autoCorrect="off"
              disabled={busy !== null}
              id="claude-import-source"
              onChange={e => {
                setSource(e.target.value)
                reset()
              }}
              placeholder="https://github.com/someone/skill.git or /path/to/folder"
              spellCheck={false}
              value={source}
            />
          </div>
          <div className="grid gap-1.5">
            <label className="text-xs font-medium" htmlFor="claude-import-category">
              Category <span className="font-normal text-muted-foreground">(optional — we&rsquo;ll pick one if left blank)</span>
            </label>
            <Input
              autoComplete="off"
              disabled={busy !== null}
              id="claude-import-category"
              onChange={e => setCategory(e.target.value)}
              placeholder="e.g. legal-research"
              spellCheck={false}
              value={category}
            />
          </div>

          {problem && (
            <div className="rounded-[6px] border border-(--ui-stroke-tertiary) bg-(--ui-bg-tertiary)/40 px-3 py-2 text-xs leading-5">
              <p className="font-medium">That didn&rsquo;t work</p>
              <p className="mt-0.5 text-muted-foreground">{problem}</p>
              <p className="mt-1 text-muted-foreground">
                Check the link or folder path and try again — or press Cancel to go back.
              </p>
            </div>
          )}

          {report && <ReportSummary report={report} />}

          <DialogFooter>
            <Button onClick={() => close(false)} type="button" variant="ghost">
              {finished ? 'Close' : 'Cancel'}
            </Button>
            {!finished && (
              <>
                <Button disabled={!canRun} type="submit" variant="secondary">
                  {busy === 'preview' ? 'Checking…' : 'Preview'}
                </Button>
                <Button disabled={!canRun || !report} onClick={() => void run(false)} type="button">
                  {busy === 'import' ? 'Importing…' : 'Import'}
                </Button>
              </>
            )}
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function ReportSummary({ report }: { report: ClaudeImportReport }) {
  const c = report.counts
  const results = report.installed || []
  const ok = results.filter(r => r.installed)
  const blocked = results.filter(r => !r.installed)

  return (
    <div className="grid gap-2 rounded-[6px] border border-(--ui-stroke-tertiary) bg-(--ui-bg-tertiary)/40 px-3 py-2 text-xs leading-5">
      <p>
        <span className="font-medium">{report.plugin}</span> contains {c.total}{' '}
        {c.total === 1 ? 'item' : 'items'}
        {c.total > 0 && (
          <span className="text-muted-foreground">
            {' '}
            ({c.skills} skills, {c.commands} commands, {c.agents} agents)
          </span>
        )}
        .
      </p>
      {report.items.length > 0 && (
        <ul className="grid gap-0.5 text-muted-foreground">
          {report.items.slice(0, 8).map(item => (
            <li key={`${item.kind}:${item.slug}`}>
              • {item.name} <span className="text-(--ui-text-tertiary)">({item.kind})</span>
            </li>
          ))}
          {report.items.length > 8 && <li>…and {report.items.length - 8} more</li>}
        </ul>
      )}
      {report.mcp_servers_needed.length > 0 && (
        <p className="text-muted-foreground">
          Heads up: these need connected services to work fully — {report.mcp_servers_needed.join(', ')}. You can set
          those up later in Settings.
        </p>
      )}
      {report.dry_run ? (
        <p>
          Nothing has been added yet — press <span className="font-medium">Import</span> to continue, or Cancel to go
          back.
        </p>
      ) : (
        <>
          {ok.length > 0 && (
            <p>
              ✓ {ok.length} {ok.length === 1 ? 'item was' : 'items were'} added to optional skills. Turn{' '}
              {ok.length === 1 ? 'it' : 'them'} on from the Skills page before using {ok.length === 1 ? 'it' : 'them'}{' '}
              in chat.
            </p>
          )}
          {blocked.map(r => (
            <p className="text-muted-foreground" key={r.name}>
              ✕ {r.name} wasn&rsquo;t added — {friendlyBlockReason(r.reason)}
            </p>
          ))}
        </>
      )}
    </div>
  )
}

function friendlyBlockReason(reason?: string): string {
  const text = (reason || '').toLowerCase()
  if (text.includes('security audit')) {
    return 'our safety check found something risky inside it, so we kept it out to protect you.'
  }
  return reason || 'something went wrong while adding it.'
}

function friendlyProblem(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err ?? '')
  if (/couldn't read that source/i.test(raw)) {
    return raw.replace(/^.*?We couldn/i, 'We couldn')
  }
  if (/taking too long/i.test(raw)) {
    return 'The import is taking too long — the source may be very large or unreachable right now.'
  }
  return 'We couldn’t reach that link or folder. Please make sure it points to a Claude skill or plugin.'
}
