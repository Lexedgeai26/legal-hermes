import { type CSSProperties } from 'react'
import { Button } from '../components/button'
import { useStore } from '@nanostores/react'
import { useEffect } from 'react'
import {
  $alternateHome,
  $existingInstall,
  beginPrivateAiChoice,
  checkExistingInstall,
  chooseAlternateHome
} from '../store'
import { ArrowRight, HardDrive, Cloud, Cpu, AlertTriangle, FolderOpen } from 'lucide-react'
import appIcon from '../assets/lexedge-app-icon.png'

/*
 * Welcome screen.
 *
 * Mirrors the desktop's chat intro (apps/desktop/src/components/chat/intro.tsx):
 *   - LEXEDGE HERMES AGENT wordmark rendered in Collapse Bold, uppercase, tracked
 *   - mix-blend-plus-lighter so the type "glows" on the canvas
 *   - fit-text utility so the wordmark sizes itself to the column
 *
 * No install-path footer. The default install location is correct for
 * almost everyone; the rest use the CLI installer with a -HermesHome flag.
 *
 * The install button opens the Private AI decision rather than starting the
 * install outright, so the user is asked about local inference before
 * anything is downloaded.
 *
 * The two-path preview below the tagline exists because users previously hit
 * the Private AI screen with no warning that a choice was coming, read it as
 * an unexpected upsell, and could not tell whether their machine was even a
 * candidate. Naming both paths here — and saying plainly that we measure the
 * machine and recommend rather than making them guess — turns the next screen
 * into a confirmation instead of a surprise.
 */
const PATHS = [
  {
    icon: HardDrive,
    title: 'Private AI',
    body: 'A legal model runs on this computer. Documents never leave the machine. Needs enough memory and disk.'
  },
  {
    icon: Cloud,
    title: 'Cloud provider',
    body: 'The agent calls a hosted model over the internet. Runs on any machine and installs in minutes.'
  }
]

export default function Welcome() {
  const existing = useStore($existingInstall)
  const alternateHome = useStore($alternateHome)

  useEffect(() => {
    void checkExistingInstall()
  }, [])

  return (
    <div className="hermes-fade-in flex h-full flex-col items-center justify-center gap-10 px-12 py-10">
      {/* Hero — same recipe the desktop's chat/intro.tsx uses */}
      <div className="w-full max-w-2xl min-w-0 text-center">
        <img
          src={appIcon}
          alt=""
          aria-hidden="true"
          width={96}
          height={96}
          className="mx-auto mb-5 h-24 w-24 select-none"
          draggable={false}
        />
        <p
          className="fit-text mx-auto mb-4 w-full font-['Collapse'] font-bold uppercase leading-[0.9] tracking-[0.08em] text-midground mix-blend-plus-lighter dark:text-foreground/90"
          style={
            {
              '--fit-text-line-height': '0.9',
              '--fit-text-max': '6rem',
              '--fit-text-min': '2.5rem'
            } as CSSProperties
          }
        >
          <span>
            <span>LEXEDGE HERMES AGENT</span>
          </span>
          <span aria-hidden="true">LEXEDGE HERMES AGENT</span>
        </p>

        <p className="m-0 text-center text-base leading-normal tracking-tight text-muted-foreground">
          Built for legal practice &mdash; draft notices and replies, check
          citations, build chronologies and track limitation. We&rsquo;ll set
          things up in the background.
        </p>

        {/* Two-path preview. Deliberately says "or" and not "and": these are
            alternatives, and either one is a complete install. */}
        <div className="mx-auto mt-8 flex max-w-lg items-stretch gap-3 text-left">
          {PATHS.map(({ icon: Icon, title, body }) => (
            <div
              key={title}
              className="flex-1 rounded-lg border border-border/60 bg-muted/20 px-4 py-3"
            >
              <div className="flex items-center gap-2">
                <Icon size={15} className="shrink-0 text-muted-foreground" />
                <span className="text-sm font-medium text-foreground">
                  {title}
                </span>
              </div>
              <p className="m-0 mt-1.5 text-xs leading-relaxed text-muted-foreground">
                {body}
              </p>
            </div>
          ))}
        </div>

        <p className="mx-auto mt-4 flex max-w-lg items-center justify-center gap-2 text-center text-sm leading-relaxed text-muted-foreground">
          <Cpu size={15} className="shrink-0" />
          <span>
            We&rsquo;ll measure this computer first and recommend the one it can
            actually run. Nothing downloads until you choose.
          </span>
        </p>
      </div>

      {/* Installing over an existing setup replaces its configuration and
          matter metadata without asking. Someone re-running setup to repair
          something should not lose a working install, so the choice is made
          explicit before anything is written. */}
      {existing?.found && (
        <div className="w-full max-w-xl rounded-lg border border-border bg-muted/30 p-4 text-left">
          <div className="flex items-start gap-2.5">
            <AlertTriangle size={16} className="mt-0.5 shrink-0 text-muted-foreground" />
            <div className="min-w-0">
              <p className="m-0 text-sm font-semibold text-foreground">
                LexEdge is already installed on this computer
              </p>
              <p className="m-0 mt-1.5 text-sm leading-relaxed text-muted-foreground">
                Found at <code className="text-xs">{existing.installRoot}</code>. Continuing will
                update it in place, replacing its settings and matter records.
              </p>
              {alternateHome ? (
                <p className="m-0 mt-2.5 text-sm leading-relaxed text-foreground">
                  Installing a separate copy in{' '}
                  <code className="text-xs">{alternateHome}</code> instead — the existing install
                  is left untouched.
                </p>
              ) : (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => void chooseAlternateHome()}
                  className="mt-3 inline-flex items-center gap-2"
                >
                  <FolderOpen size={15} />
                  Install alongside it in another folder
                </Button>
              )}
            </div>
          </div>
        </div>
      )}

      <Button
        onClick={() => beginPrivateAiChoice()}
        size="lg"
        className="group inline-flex items-center gap-2 px-6"
      >
        Install LexEdge Hermes Agent
        <ArrowRight
          size={18}
          className="transition-transform group-hover:translate-x-0.5"
        />
      </Button>

      {/* Attribution. Nous Research is credited as the upstream project
          author; the publisher and product owner is LexEdge AI Labs. */}
      <p className="m-0 max-w-md text-center text-xs leading-relaxed text-muted-foreground/70">
        Published by LexEdge AI Labs Private Limited. Built on Hermes, an open
        project by Nous Research.
      </p>
    </div>
  )
}
