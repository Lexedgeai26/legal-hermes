import { useEffect, useState } from 'react'
import {
  CalendarClock,
  FileSearch,
  Gavel,
  ListChecks,
  PenLine,
  Quote,
  ScanText,
  ShieldCheck
} from 'lucide-react'

/*
 * Rotating capability notes shown while the install runs.
 *
 * An install is dead time with a progress bar, and the stage titles
 * ("Preparing…", "Installing runtime") tell a lawyer nothing about what they
 * are about to have. This fills that time with what the product actually does
 * for a practice.
 *
 * Every line below maps to a real skill under skills/legal-india — this is a
 * capability list, not marketing. Inventing a feature here would be a promise
 * the product cannot keep, discovered by the user minutes later. Where a skill
 * deliberately stops short of acting (drafting but never serving or filing),
 * the copy says so, because that boundary is the reason a professional can
 * trust it.
 */
const HIGHLIGHTS = [
  {
    icon: PenLine,
    title: 'Draft replies to notices',
    body: 'GST, income-tax, labour and IP notices — classified, then drafted with the controlling limitation window and a filing checklist. Draft only; it never files for you.'
  },
  {
    icon: Quote,
    title: 'Catch hallucinated citations',
    body: 'Every assertion in a draft is checked against quoted document text or a real section reference, and anything unsupported is flagged as an assumption.'
  },
  {
    icon: CalendarClock,
    title: 'Track limitation',
    body: 'Statutory time windows computed from the documents themselves, and kept in a limitation diary rather than your memory.'
  },
  {
    icon: ListChecks,
    title: 'Build a chronology',
    body: 'Dated events pulled from a bundle into one ordered timeline, each entry anchored back to its source document.'
  },
  {
    icon: ScanText,
    title: 'Extract and validate identifiers',
    body: 'GSTIN, PAN, CIN and TAN, parties, case numbers and dates — each re-validated deterministically, not just pattern-matched.'
  },
  {
    icon: FileSearch,
    title: 'Redline and review drafts',
    body: 'Clause-level review against your positions, with risk analysis and suggested actions before anything leaves your desk.'
  },
  {
    icon: Gavel,
    title: 'Draft demand notices',
    body: 'Section 138 NI Act, IBC Section 8, SARFAESI 13(2), Section 80 CPC and arbitration invocations, with the statutory windows computed.'
  },
  {
    icon: ShieldCheck,
    title: 'Matters stay where you put them',
    body: 'Matter files remain in the folder you choose. Only lightweight metadata and an index live alongside the agent.'
  }
]

const ROTATE_MS = 6500

export default function InstallHighlights() {
  const [index, setIndex] = useState(0)
  const [visible, setVisible] = useState(true)

  useEffect(() => {
    // Respect a user who has asked the OS for less motion: they still get the
    // content, just without the cross-fade.
    const reduced = window.matchMedia?.(
      '(prefers-reduced-motion: reduce)'
    )?.matches

    const timer = window.setInterval(() => {
      if (reduced) {
        setIndex((i) => (i + 1) % HIGHLIGHTS.length)
        return
      }
      setVisible(false)
      window.setTimeout(() => {
        setIndex((i) => (i + 1) % HIGHLIGHTS.length)
        setVisible(true)
      }, 350)
    }, ROTATE_MS)

    return () => window.clearInterval(timer)
  }, [])

  const { icon: Icon, title, body } = HIGHLIGHTS[index]

  return (
    <div
      className="flex h-full flex-col justify-center px-8 py-6"
      /* Announced politely rather than assertively: this is ambient reading
         material, and must not interrupt a screen reader working through the
         stage list beside it. */
      aria-live="polite"
    >
      <div
        className={`max-w-sm transition-opacity duration-300 ${
          visible ? 'opacity-100' : 'opacity-0'
        }`}
      >
        <Icon size={20} className="mb-3 text-muted-foreground" />
        <h3 className="m-0 text-sm font-semibold text-foreground">{title}</h3>
        <p className="m-0 mt-2 text-xs leading-relaxed text-muted-foreground">
          {body}
        </p>
      </div>

      {/* Position indicator — tells the reader this rotates, so a line they
          half-read is understood to be coming back. */}
      <div className="mt-6 flex gap-1.5">
        {HIGHLIGHTS.map((h, i) => (
          <span
            key={h.title}
            className={`h-1 w-4 rounded-full transition-colors ${
              i === index ? 'bg-foreground/40' : 'bg-foreground/10'
            }`}
          />
        ))}
      </div>
    </div>
  )
}
