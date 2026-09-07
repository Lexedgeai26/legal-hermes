import { Button } from '../components/button'
import { chooseCloudProvider, choosePrivateAi } from '../store'
import { ShieldCheck, Cloud, HardDrive, WifiOff } from 'lucide-react'

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
 */

const POINTS = [
  {
    icon: HardDrive,
    title: 'Runs on this computer',
    body: 'A language model is installed locally. Answering a question uses this machine, not a server.'
  },
  {
    icon: WifiOff,
    title: 'Documents stay on this machine',
    body: 'Matter documents and prompts are not sent to LexEdge or any model provider once setup is complete.'
  },
  {
    icon: ShieldCheck,
    title: 'Only approved models',
    body: 'Models come from a signed LexEdge catalogue that has passed legal benchmark review.'
  }
]

export default function Privacy() {
  return (
    <div className="hermes-fade-in flex h-full flex-col items-center justify-center gap-8 px-12 py-10">
      <div className="w-full max-w-xl min-w-0">
        <h1 className="m-0 text-center text-2xl font-semibold tracking-tight text-foreground">
          Set up Private AI
        </h1>
        <p className="mx-auto mt-3 max-w-lg text-center text-sm leading-relaxed text-muted-foreground">
          LexEdge Hermes Agent can run a legal language model directly on this
          computer. We&rsquo;ll check what this machine can handle before
          downloading anything.
        </p>

        <ul className="mt-7 flex list-none flex-col gap-4 p-0">
          {POINTS.map(({ icon: Icon, title, body }) => (
            <li key={title} className="flex items-start gap-3">
              <Icon size={18} className="mt-0.5 shrink-0 text-muted-foreground" />
              <div className="min-w-0">
                <div className="text-sm font-medium text-foreground">{title}</div>
                <div className="mt-0.5 text-sm leading-relaxed text-muted-foreground">
                  {body}
                </div>
              </div>
            </li>
          ))}
        </ul>
      </div>

      <div className="flex flex-col items-center gap-3">
        <Button
          onClick={() => void choosePrivateAi()}
          size="lg"
          className="inline-flex items-center gap-2 px-6"
        >
          <ShieldCheck size={18} />
          Use Private AI
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
