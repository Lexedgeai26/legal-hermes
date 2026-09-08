import { useStore } from '@nanostores/react'
import { Button } from '../components/button'
import {
  $provision,
  cancelProvisioning,
  continueToSuccess,
  retryProvisioning,
  skipPrivateAi,
  type ProvisionStage,
  type ValidationReport
} from '../store'
import {
  AlertTriangle,
  Check,
  ChevronRight,
  Loader2,
  Minus,
  RefreshCw,
  X
} from 'lucide-react'

/*
 * Private AI provisioning.
 *
 * Nine stages, each idempotent on the Rust side, so Retry resumes rather
 * than restarts. A failure here never touches the base install, which has
 * already completed — "Skip for now" always leads to a working product.
 *
 * The validation report is shown in full on completion. If the model works
 * but is slow, the warning and the smaller-model suggestion are surfaced,
 * and the user's choice is left exactly as they made it.
 */

function StageRow({
  stage,
  current,
  progress
}: {
  stage: ProvisionStage
  current: boolean
  progress?: { fraction: number; detail: string }
}) {
  const icon =
    stage.state === 'succeeded' ? (
      <Check size={14} className="text-primary" />
    ) : stage.state === 'skipped' ? (
      <Minus size={14} className="text-muted-foreground" />
    ) : stage.state === 'failed' ? (
      <X size={14} className="text-destructive" />
    ) : stage.state === 'running' ? (
      <Loader2 size={14} className="animate-spin text-primary" />
    ) : (
      <ChevronRight size={14} className="text-muted-foreground/40" />
    )

  return (
    <li className="flex flex-col gap-1 py-1.5">
      <div className="flex items-center gap-2.5">
        <span className="flex w-4 shrink-0 justify-center">{icon}</span>
        <span
          className={
            stage.state === null
              ? 'text-sm text-muted-foreground/60'
              : stage.state === 'failed'
                ? 'text-sm text-destructive'
                : 'text-sm text-foreground'
          }
        >
          {stage.title}
        </span>
        {stage.detail && stage.state !== 'running' && (
          <span className="truncate text-xs text-muted-foreground">— {stage.detail}</span>
        )}
      </div>
      {current && stage.state === 'running' && progress && (
        <div className="ml-6.5 pl-0.5">
          <div className="h-1 w-full overflow-hidden rounded-full bg-muted">
            <div
              className="h-full rounded-full bg-primary transition-[width] duration-300"
              style={{ width: `${Math.round(progress.fraction * 100)}%` }}
            />
          </div>
          <div className="mt-1 text-xs text-muted-foreground">{progress.detail}</div>
        </div>
      )}
      {stage.error && (
        <p className="m-0 ml-6.5 text-xs leading-relaxed text-destructive">{stage.error}</p>
      )}
    </li>
  )
}

function Report({ report }: { report: ValidationReport }) {
  const m = report.metrics
  return (
    <div className="rounded-lg border border-border bg-muted/30 px-4 py-3">
      <div className="mb-2 text-sm font-medium text-foreground">
        Local AI is working
      </div>
      <dl className="grid grid-cols-2 gap-x-6 gap-y-1 text-xs text-muted-foreground sm:grid-cols-3">
        <div>
          <dt className="sr-only">Model</dt>
          <dd className="truncate">{report.selectedGenerationModel}</dd>
        </div>
        <div>
          <dt className="sr-only">Execution</dt>
          <dd>{m.executionMode ? `Running on ${m.executionMode}` : 'Execution mode unknown'}</dd>
        </div>
        <div>
          <dt className="sr-only">Speed</dt>
          <dd>{m.tokensPerSecond ? `~${Math.round(m.tokensPerSecond)} words/sec` : 'Speed not measured'}</dd>
        </div>
        <div>
          <dt className="sr-only">First response</dt>
          <dd>{m.timeToFirstTokenMs != null ? `First reply in ${(m.timeToFirstTokenMs / 1000).toFixed(1)}s` : ''}</dd>
        </div>
        <div>
          <dt className="sr-only">Embedding</dt>
          <dd className="truncate">{report.selectedEmbeddingModel}</dd>
        </div>
        <div>
          <dt className="sr-only">Checks</dt>
          <dd>{report.checks.filter((c) => c.status === 'passed').length} of {report.checks.length} checks passed</dd>
        </div>
      </dl>
      {report.warnings.map((w) => (
        <p
          key={w}
          className="m-0 mt-2 flex items-start gap-1.5 text-xs leading-relaxed text-amber-600 dark:text-amber-500"
        >
          <AlertTriangle size={12} className="mt-0.5 shrink-0" />
          {w}
        </p>
      ))}
    </div>
  )
}

export default function Provision() {
  const p = useStore($provision)
  const running = p.status === 'running'
  const done = p.status === 'completed'
  const stopped = p.status === 'failed' || p.status === 'cancelled'
  const doneCount = p.stageOrder.filter((n) => {
    const s = p.stages[n]?.state
    return s === 'succeeded' || s === 'skipped'
  }).length

  return (
    <div className="hermes-fade-in flex h-full min-h-0 flex-col gap-4 px-10 py-8">
      <div className="shrink-0">
        <h1 className="m-0 text-xl font-semibold tracking-tight text-foreground">
          {done ? 'Private AI is ready' : stopped ? 'Private AI setup stopped' : 'Setting up Private AI'}
        </h1>
        <p className="m-0 mt-1.5 text-xs text-muted-foreground">
          {running && p.stageOrder.length > 0
            ? `${doneCount} of ${p.stageOrder.length} steps · you can close the lid; this resumes where it left off`
            : done
              ? 'Everything runs on this computer. Documents never leave it.'
              : 'Your LexEdge Hermes Agent install is complete and unaffected.'}
        </p>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto pr-1">
        {p.stageOrder.length === 0 && running ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 size={14} className="animate-spin" /> Preparing…
          </div>
        ) : (
          <ul className="m-0 list-none p-0">
            {p.stageOrder.map((name) => (
              <StageRow
                key={name}
                stage={p.stages[name]}
                current={p.currentStage === name}
                progress={p.progress[name]}
              />
            ))}
          </ul>
        )}

        {done && p.report && (
          <div className="mt-4">
            <Report report={p.report} />
          </div>
        )}

        {stopped && p.error && (
          <p className="m-0 mt-3 text-sm leading-relaxed text-destructive">{p.error}</p>
        )}
      </div>

      <div className="flex shrink-0 items-center gap-3 border-t border-border pt-3">
        {running && (
          <Button variant="outline" size="lg" onClick={() => void cancelProvisioning()}>
            Cancel
          </Button>
        )}
        {stopped && (
          <>
            <Button size="lg" onClick={() => void retryProvisioning()} className="inline-flex items-center gap-2 px-6">
              <RefreshCw size={16} />
              {p.status === 'cancelled' ? 'Resume' : 'Try again'}
            </Button>
            <Button variant="outline" size="lg" onClick={() => skipPrivateAi()}>
              Skip for now
            </Button>
          </>
        )}
        {done && (
          <Button size="lg" onClick={() => continueToSuccess()} className="inline-flex items-center gap-2 px-6">
            <Check size={16} />
            Continue
          </Button>
        )}
      </div>
    </div>
  )
}
