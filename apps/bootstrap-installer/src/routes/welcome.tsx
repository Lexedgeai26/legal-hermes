import { type CSSProperties } from 'react'
import { Button } from '../components/button'
import { beginPrivateAiChoice } from '../store'
import { ArrowRight } from 'lucide-react'
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
 */
export default function Welcome() {
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
          The agent that grows with you. We&rsquo;ll set things up in the
          background &mdash; takes a few minutes.
        </p>
      </div>

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
