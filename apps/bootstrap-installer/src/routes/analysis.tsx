import { useStore } from '@nanostores/react'
import { Button } from '../components/button'
import {
  $analysis,
  $analysisError,
  $analysisPending,
  $selectedProfileId,
  analyzePrivateAi,
  chooseCloudProvider,
  selectProfile,
  startInstall,
  type ModelRecommendation
} from '../store'
import {
  AlertTriangle,
  Check,
  Cpu,
  Info,
  RefreshCw,
  Server
} from 'lucide-react'

/*
 * Local hardware analysis and model choice.
 *
 * Everything shown here is explainable: each offered model carries the reasons
 * it fits, and each excluded model carries the reason it does not. A user who
 * cannot run the recommended model is told why, in plain language, rather than
 * being shown a shorter list with no explanation.
 *
 * The recommendation is pre-selected but never enforced. Alternatives remain
 * one click away, and the download size is stated before any confirmation.
 */

function ModelCard({
  model,
  selected,
  onSelect
}: {
  model: ModelRecommendation
  selected: boolean
  onSelect: () => void
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      className={`w-full rounded-lg border px-4 py-3 text-left transition-colors ${
        selected
          ? 'border-primary bg-primary/5'
          : 'border-border hover:border-muted-foreground/40'
      }`}
    >
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-sm font-medium text-foreground">
          {model.friendlyName}
        </span>
        {model.recommended && (
          <span className="shrink-0 rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-medium text-primary">
            Recommended
          </span>
        )}
      </div>

      <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-muted-foreground sm:grid-cols-4">
        <div>
          <dt className="sr-only">Download size</dt>
          <dd>{model.downloadSizeGb.toFixed(1)} GB download</dd>
        </div>
        <div>
          <dt className="sr-only">Memory</dt>
          <dd>
            {model.estimatedMemoryGb
              ? `${model.estimatedMemoryGb.toFixed(1)} GB memory`
              : 'Memory varies'}
          </dd>
        </div>
        <div>
          <dt className="sr-only">Speed</dt>
          <dd>
            {model.estimatedTokensPerSecond
              ? `~${Math.round(model.estimatedTokensPerSecond)} words/sec`
              : 'Speed unknown'}
          </dd>
        </div>
        <div>
          <dt className="sr-only">Context</dt>
          <dd>
            {(model.operationalContextTokens / 1000).toFixed(0)}k context
          </dd>
        </div>
      </dl>

      {model.reasons.length > 0 && (
        <p className="m-0 mt-2 text-xs leading-relaxed text-muted-foreground">
          {model.reasons.join(' ')}
        </p>
      )}
      {model.warnings.map((warning) => (
        <p
          key={warning}
          className="m-0 mt-1.5 flex items-start gap-1.5 text-xs leading-relaxed text-amber-600 dark:text-amber-500"
        >
          <AlertTriangle size={12} className="mt-0.5 shrink-0" />
          {warning}
        </p>
      ))}
    </button>
  )
}

export default function Analysis() {
  const analysis = useStore($analysis)
  const error = useStore($analysisError)
  const pending = useStore($analysisPending)
  const selectedId = useStore($selectedProfileId)

  if (pending) {
    return (
      <div className="hermes-fade-in flex h-full flex-col items-center justify-center gap-3 px-12">
        <Cpu size={22} className="animate-pulse text-muted-foreground" />
        <p className="m-0 text-sm text-muted-foreground">
          Checking what this computer can run&hellip;
        </p>
      </div>
    )
  }

  if (error || !analysis) {
    return (
      <div className="hermes-fade-in flex h-full flex-col items-center justify-center gap-5 px-12 text-center">
        <p className="m-0 max-w-md text-sm text-muted-foreground">
          {error ?? 'We couldn’t check this computer.'}
        </p>
        <div className="flex items-center gap-3">
          <Button onClick={() => void analyzePrivateAi()} className="inline-flex items-center gap-2">
            <RefreshCw size={16} />
            Try again
          </Button>
          <Button variant="outline" onClick={() => void chooseCloudProvider()}>
            Continue with a cloud provider
          </Button>
        </div>
      </div>
    )
  }

  const { hardware, recommendation } = analysis
  const compatible = recommendation.compatible
  const selected = compatible.find((m) => m.profileId === selectedId) ?? compatible[0]
  // Generation model + the catalogue's embedding model. Recomputed from the
  // user's actual choice rather than reusing the figure for the recommendation.
  const totalGb = selected
    ? selected.downloadSizeGb + analysis.embeddingDownloadGb
    : analysis.embeddingDownloadGb

  return (
    <div className="hermes-fade-in flex h-full min-h-0 flex-col gap-4 px-10 py-8">
      <div className="shrink-0">
        <h1 className="m-0 text-xl font-semibold tracking-tight text-foreground">
          What this computer can run
        </h1>
        <p className="m-0 mt-1.5 text-xs leading-relaxed text-muted-foreground">
          {hardware.cpu.model} &middot; {hardware.memory.totalGb} GB memory
          {hardware.gpus[0] ? ` · ${hardware.gpus[0].model}` : ''} &middot;{' '}
          {analysis.freeDiskGb.toFixed(0)} GB free
        </p>
      </div>

      {hardware.existingRuntime.found && !hardware.existingRuntime.managedByProduct && (
        <div className="flex shrink-0 items-start gap-2 rounded-md border border-border bg-muted/40 px-3 py-2 text-xs leading-relaxed text-muted-foreground">
          <Server size={14} className="mt-0.5 shrink-0" />
          <span>
            An existing Ollama installation is already running on port{' '}
            {hardware.existingRuntime.port}
            {hardware.existingRuntime.version
              ? ` (version ${hardware.existingRuntime.version})`
              : ''}
            . LexEdge will install its own separate runtime on another port and
            will not change or remove yours.
          </span>
        </div>
      )}

      {analysis.usedConservativeFallback && (
        <div className="flex shrink-0 items-start gap-2 rounded-md border border-border bg-muted/40 px-3 py-2 text-xs leading-relaxed text-muted-foreground">
          <Info size={14} className="mt-0.5 shrink-0" />
          <span>
            Detailed hardware analysis was unavailable, so these
            recommendations use conservative limits.
          </span>
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-y-auto pr-1">
        {compatible.length === 0 ? (
          <p className="m-0 text-sm text-muted-foreground">
            No approved model fits this computer.
          </p>
        ) : (
          <div className="flex flex-col gap-2">
            {compatible.map((model) => (
              <ModelCard
                key={model.profileId}
                model={model}
                selected={model.profileId === selected?.profileId}
                onSelect={() => selectProfile(model.profileId)}
              />
            ))}
          </div>
        )}

        {recommendation.excluded.length > 0 && (
          <details className="mt-4">
            <summary className="cursor-pointer text-xs text-muted-foreground">
              {recommendation.excluded.length} model
              {recommendation.excluded.length === 1 ? '' : 's'} won&rsquo;t run
              on this computer
            </summary>
            <ul className="mt-2 flex list-none flex-col gap-2 p-0">
              {recommendation.excluded.map((profile) => (
                <li key={profile.profileId} className="text-xs text-muted-foreground">
                  <span className="font-medium text-foreground/80">
                    {profile.friendlyName}
                  </span>{' '}
                  &mdash; {profile.reasons.join(' ')}
                </li>
              ))}
            </ul>
          </details>
        )}
      </div>

      <div className="shrink-0 border-t border-border pt-3">
        <p className="m-0 mb-3 text-xs text-muted-foreground">
          {selected ? (
            <>
              Downloads {selected.friendlyName} plus the embedding model
              &mdash; about{' '}
              <span className="font-medium text-foreground">
                {totalGb.toFixed(1)} GB
              </span>
              . You have {analysis.freeDiskGb.toFixed(0)} GB free.
            </>
          ) : (
            'Nothing will be downloaded.'
          )}
        </p>
        <div className="flex items-center gap-3">
          <Button
            onClick={() => void startInstall()}
            disabled={!selected}
            size="lg"
            className="inline-flex items-center gap-2 px-6"
          >
            <Check size={16} />
            Install and download
          </Button>
          <Button variant="outline" size="lg" onClick={() => void chooseCloudProvider()}>
            Skip Private AI
          </Button>
        </div>
      </div>
    </div>
  )
}
