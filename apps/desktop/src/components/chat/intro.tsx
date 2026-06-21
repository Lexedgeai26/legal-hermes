import { useState } from 'react'

import { requestComposerInsert } from '@/app/chat/composer/focus'

import introCopyJsonl from './intro-copy.jsonl?raw'

type IntroCopy = {
  headline: string
  body: string
}

type IntroCopyRecord = IntroCopy & {
  personality: string
}

export type IntroProps = {
  personality?: string
  seed?: number
}

const NEUTRAL_PERSONALITIES = new Set(['', 'default', 'none', 'neutral'])

const FALLBACK_COPY: IntroCopy[] = [
  {
    headline: 'How can LexEdge AI help?',
    body: 'Ask about Indian legal research, notices, limitation dates, GST replies, PDFs, documents, or presentations.'
  },
  {
    headline: 'What legal work should we prepare?',
    body: 'Share the matter, document, or deadline. LexEdge AI will keep the workflow focused and practical.'
  },
  {
    headline: 'What should LexEdge AI review?',
    body: 'Paste facts, upload documents, or describe the legal task. The assistant will help structure the next step.'
  },
  {
    headline: 'Where should we start?',
    body: 'Bring the problem, goal, or file. LexEdge AI will inspect first and keep the next step concrete.'
  },
  {
    headline: 'What needs attention?',
    body: 'Send the context you have. LexEdge AI will help sort it into a legal workflow.'
  }
]

function normalizeKey(value?: string): string {
  return (value || '').trim().toLowerCase()
}

function titleize(value: string): string {
  return value
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map(part => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ')
}

function isIntroCopyRecord(value: unknown): value is IntroCopyRecord {
  if (!value || typeof value !== 'object') {
    return false
  }

  const record = value as Record<string, unknown>

  return (
    typeof record.personality === 'string' &&
    typeof record.headline === 'string' &&
    typeof record.body === 'string' &&
    Boolean(record.personality.trim()) &&
    Boolean(record.headline.trim()) &&
    Boolean(record.body.trim())
  )
}

function parseIntroCopy(raw: string): Record<string, IntroCopy[]> {
  const byPersonality: Record<string, IntroCopy[]> = {}

  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim()

    if (!trimmed) {
      continue
    }

    try {
      const parsed: unknown = JSON.parse(trimmed)

      if (!isIntroCopyRecord(parsed)) {
        continue
      }

      const key = normalizeKey(parsed.personality)
      byPersonality[key] ??= []
      byPersonality[key].push({
        headline: parsed.headline.trim(),
        body: parsed.body.trim()
      })
    } catch {
      // Bad generated copy should not break the whole desktop app.
    }
  }

  return byPersonality
}

const INTRO_COPY_BY_PERSONALITY = parseIntroCopy(introCopyJsonl)

function neutralCopy(): IntroCopy[] {
  return INTRO_COPY_BY_PERSONALITY.none || INTRO_COPY_BY_PERSONALITY.default || FALLBACK_COPY
}

function fallbackCopyForPersonality(personalityKey: string): IntroCopy[] {
  if (NEUTRAL_PERSONALITIES.has(personalityKey)) {
    return neutralCopy()
  }

  const label = titleize(personalityKey)

  return [
    {
      headline: `${label} mode is on. What should we work on?`,
      body: "Send the legal matter, document, deadline, or research question. I'll keep the workflow grounded in Indian legal review."
    },
    {
      headline: `What does ${label} LexEdge AI need to see?`,
      body: "Bring the facts, file, or notice. I'll adapt the style while keeping outputs review-ready."
    },
    {
      headline: `${label} mode is ready.`,
      body: "Send the legal task, document, or question. I'll follow the configured style without losing the legal workflow."
    },
    {
      headline: `What should ${label} LexEdge AI tackle?`,
      body: 'Drop the matter context here. I will structure facts, issues, gaps, and next steps.'
    },
    {
      headline: 'Where should we begin?',
      body: `Give me the legal context and I'll answer in ${label} mode for advocate review.`
    }
  ]
}

function pickCopy(copies: IntroCopy[], seed = 0): IntroCopy {
  return copies[Math.abs(seed) % copies.length] || FALLBACK_COPY[0]
}

const WORDMARK = 'LexEdge Personal AI Assistant'
const START_EXAMPLES = [
  'Review this legal notice and list risks, deadlines, and next steps.',
  'Draft a reply to this GST show cause notice for advocate review.',
  'Check limitation from these dates and explain the safest filing window.',
  'Review this agreement for Indian law risks and suggest negotiation points.',
  'Summarise this document for a client update with open questions.'
]

function resolveCopy(personality?: string, seed?: number): IntroCopy {
  const personalityKey = normalizeKey(personality)

  const copies = NEUTRAL_PERSONALITIES.has(personalityKey)
    ? INTRO_COPY_BY_PERSONALITY[personalityKey] || neutralCopy()
    : INTRO_COPY_BY_PERSONALITY[personalityKey] || fallbackCopyForPersonality(personalityKey)

  return pickCopy(copies, seed)
}

export function Intro({ personality, seed }: IntroProps) {
  const [mountSeed] = useState(() => Math.floor(Math.random() * 100000))
  const copy = resolveCopy(personality, mountSeed + (seed ?? 0))
  const orderedExamples = START_EXAMPLES.map((_, index) => START_EXAMPLES[(index + mountSeed) % START_EXAMPLES.length])

  const useExample = (example: string) => {
    requestComposerInsert(example, { mode: 'block', target: 'main' })
  }

  return (
    <div
      className="pointer-events-none flex w-full min-w-0 flex-col items-center justify-center px-0.5 py-6 text-center sm:px-6 lg:px-8"
      data-slot="aui_intro"
    >
      <div className="w-full min-w-0">
        <p className="mx-auto mb-2 max-w-3xl text-2xl font-medium leading-snug tracking-normal text-slate-700 sm:text-3xl">
          {WORDMARK}
        </p>

        <p className="m-0 text-center leading-normal tracking-normal text-slate-700">{copy.body}</p>

        <div className="pointer-events-auto mx-auto mt-6 grid w-full max-w-3xl gap-2 text-left sm:grid-cols-2">
          {orderedExamples.map(example => (
            <button
              className="min-h-12 rounded-md border border-slate-400 bg-white/95 px-3 py-2 text-left text-sm font-semibold leading-snug text-slate-950 shadow-sm transition hover:border-slate-700 hover:bg-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-800"
              key={example}
              onClick={() => useExample(example)}
              type="button"
            >
              {example}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
