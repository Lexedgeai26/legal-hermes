import { Button } from '../components/button'
import { backToWelcome, chooseCloudProvider, choosePrivateAi } from '../store'
import {
  ShieldCheck,
  Cloud,
  HardDrive,
  WifiOff,
  ArrowLeft,
  Gauge,
  Zap,
  Globe
} from 'lucide-react'

/*
 * Private AI explanation and consent.
 *
 * This screen exists because local inference is a meaningful decision, not a
 * default to be applied quietly: it downloads several gigabytes, uses the
 * machine's memory, and changes where client documents are processed. The user
 * chooses; the installer never decides for them.
 *
 * Declining must be a first-class outcome, so "Continue with cloud provider"
 * is a real button, not a link buried in small print.
 *
 * Both paths are now described side by side. Previously only Private AI was
 * explained, which made the cloud button read as "the option with nothing good
 * to say about it" — users declined local inference with no idea what they
 * were getting instead, or accepted it to avoid the unexplained alternative.
 * A choice is only informed if both sides are stated, including the honest
 * costs (disk and memory here, network and third-party processing there).
 */

const PRIVATE_POINTS = [
  {
    icon: WifiOff,
    title: 'Documents stay on this machine',
    body: 'Matter documents and prompts are never sent to LexEdge or a model provider. Works with no internet connection.'
  },
  {
    icon: ShieldCheck,
    title: 'Only approved models',
    // Deliberately claims selection and testing, not a formal benchmark. The
    // catalogue carries a legalBenchmark score, but no independent legal
    // benchmark has been run against these models yet, and a product sold to
    // lawyers should not assert a review it cannot evidence. Restore the
    // stronger wording once a real benchmark exists.
    body: 'Models come from a signed LexEdge catalogue — a fixed, tested set, not whatever happens to be on the machine.'
  },
  {
    icon: HardDrive,
    title: 'Needs room to run',
    body: 'Downloads several gigabytes and holds memory while answering. Older machines may not qualify.'
  }
]

const CLOUD_POINTS = [
  {
    icon: Zap,
    title: 'Ready in minutes',
    body: 'No model download. The agent is usable as soon as the base install finishes.'
  },
  {
    icon: Gauge,
    title: 'Runs on any machine',
    body: 'The model runs on the provider’s hardware, so a modest laptop performs the same as a workstation.'
  },
  {
    icon: Globe,
    title: 'Needs internet and a key',
    body: 'Prompts and document text are sent to the provider you configure. Requires a connection and your own API key.'
  }
]

function PointList({
  points
}: {
  points: { icon: typeof ShieldCheck; title: string; body: string }[]
}) {
  return (
    <ul className="mt-4 flex list-none flex-col gap-3 p-0">
      {points.map(({ icon: Icon, title, body }) => (
        <li key={title} className="flex items-start gap-2.5">
          <Icon size={16} className="mt-0.5 shrink-0 text-muted-foreground" />
          <div className="min-w-0">
            <div className="text-sm font-medium text-foreground">{title}</div>
            <div className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
              {body}
            </div>
          </div>
        </li>
      ))}
    </ul>
  )
}

export default function Privacy() {
  return (
    <div className="hermes-fade-in relative flex h-full flex-col items-center justify-center gap-7 px-12 py-10">
      {/* Back to Welcome. Nothing has been detected or downloaded yet, so
          leaving this screen costs the user nothing. */}
      <Button
        variant="ghost"
        size="sm"
        onClick={() => backToWelcome()}
        className="absolute left-4 top-4 inline-flex items-center gap-1.5 text-muted-foreground"
      >
        <ArrowLeft size={15} />
        Back
      </Button>

      <div className="w-full max-w-3xl min-w-0">
        <h1 className="m-0 text-center text-2xl font-semibold tracking-tight text-foreground">
          Choose where the model runs
        </h1>
        <p className="mx-auto mt-3 max-w-xl text-center text-sm leading-relaxed text-muted-foreground">
          LexEdge Hermes Agent can run a legal language model directly on this
          computer, or call a hosted one. We&rsquo;ll check what this machine
          can handle before downloading anything.
        </p>

        <div className="mt-7 grid grid-cols-2 gap-5">
          <section className="rounded-lg border border-border/60 bg-muted/20 p-5">
            <div className="flex items-center gap-2">
              <ShieldCheck size={17} className="shrink-0 text-foreground" />
              <h2 className="m-0 text-base font-semibold text-foreground">
                Private AI
              </h2>
            </div>
            <PointList points={PRIVATE_POINTS} />
          </section>

          <section className="rounded-lg border border-border/60 bg-muted/20 p-5">
            <div className="flex items-center gap-2">
              <Cloud size={17} className="shrink-0 text-foreground" />
              <h2 className="m-0 text-base font-semibold text-foreground">
                Cloud provider
              </h2>
            </div>
            <PointList points={CLOUD_POINTS} />
          </section>
        </div>
      </div>

      <div className="flex flex-col items-center gap-3">
        <Button
          onClick={() => void choosePrivateAi()}
          size="lg"
          className="inline-flex items-center gap-2 px-6"
        >
          <ShieldCheck size={18} />
          Check this computer for Private AI
        </Button>
        <Button
          variant="outline"
          size="lg"
          onClick={() => void chooseCloudProvider()}
          className="inline-flex items-center gap-2"
        >
          <Cloud size={16} />
          Continue with a cloud provider
        </Button>
      </div>

      <p className="m-0 max-w-md text-center text-xs leading-relaxed text-muted-foreground/70">
        You can turn Private AI on or off later in Settings. Choosing a cloud
        provider now does not limit anything else in the application.
      </p>
    </div>
  )
}
