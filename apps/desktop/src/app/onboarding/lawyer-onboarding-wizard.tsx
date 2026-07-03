import type { ReactNode } from 'react'
import { useEffect, useMemo, useState } from 'react'

import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import {
  applyProfileSkillSelection,
  completeOnboarding,
  createProfile,
  getLexEdgePracticeCatalog,
  getGlobalModelOptions,
  getOnboardingStatus,
  getPracticeRoleSoulTemplate,
  getRecommendedDefaultModel,
  getSkills,
  setEnvVar,
  setGlobalModel,
  saveLexEdgePracticeProfile,
  updateOnboardingStep,
  updateProfileSoul,
  validateProviderCredential
} from '@/hermes'
import { CheckCircle2, KeyRound, Loader2, MessageCircle, Users } from '@/lib/icons'
import { cn } from '@/lib/utils'
import { ensureGatewayProfile } from '@/store/profile'
import type { LexEdgePracticeCatalog, ModelOptionProvider, OnboardingStatus, SkillInfo } from '@/types/hermes'

const PROFILE_NAME_RE = /^[a-z0-9][a-z0-9_-]{0,63}$/
const FORCE_ONBOARDING_KEY = 'lexedge:onboarding:force'

const PRACTICE_ROLES = [
  {
    value: 'individual-advocate',
    label: 'Individual advocate',
    description: 'Solo matters, notices, replies, client updates, and limitation reminders.'
  },
  {
    value: 'litigation-lawyer',
    label: 'Litigation lawyer',
    description: 'Court matters, hearing preparation, pleadings, orders, and evidence review.'
  },
  {
    value: 'law-firm',
    label: 'Law firm',
    description: 'Team-safe matter intake, conflict checks, review gates, and client communication.'
  },
  {
    value: 'in-house-counsel',
    label: 'In-house counsel',
    description: 'Contract triage, risk flags, compliance routing, and business-facing updates.'
  },
  {
    value: 'legal-consultant',
    label: 'Legal consultant',
    description: 'Advisory memos, legal research, structuring options, and client-ready summaries.'
  }
] as const

const PROVIDER_CHOICES = [
  {
    key: 'gemini',
    label: 'Google Gemini',
    hint: 'Good default for Indian legal drafting and long documents.',
    match: /(gemini|google)/i
  },
  {
    key: 'openai',
    label: 'OpenAI',
    hint: 'Strong drafting, analysis, and document workflows.',
    match: /openai/i
  },
  {
    key: 'anthropic',
    label: 'Anthropic',
    hint: 'Strong for careful review, long context, and reasoning-heavy work.',
    match: /(anthropic|claude)/i
  },
  {
    key: 'openrouter',
    label: 'OpenRouter',
    hint: 'One key for many models from different AI labs.',
    match: /openrouter/i
  },
  {
    key: 'nous',
    label: 'Nous',
    hint: 'Hermes-native provider for Nous-hosted models.',
    match: /nous/i
  },
  {
    key: 'ollama',
    label: 'Ollama',
    hint: 'Local models on your own computer, when configured.',
    match: /ollama/i
  }
] as const

const PROVIDER_KEY_ENV_FALLBACKS: Array<{ env: string; match: RegExp }> = [
  { env: 'OPENROUTER_API_KEY', match: /openrouter/i },
  { env: 'GEMINI_API_KEY', match: /(gemini|google)/i },
  { env: 'ANTHROPIC_API_KEY', match: /(anthropic|claude)/i },
  { env: 'OPENAI_API_KEY', match: /openai(?!.*codex)/i },
  { env: 'XAI_API_KEY', match: /\bxai\b|grok/i },
  { env: 'DEEPSEEK_API_KEY', match: /deepseek/i },
  { env: 'MISTRAL_API_KEY', match: /mistral/i },
  { env: 'GROQ_API_KEY', match: /groq/i },
  { env: 'TOGETHER_API_KEY', match: /together/i },
  { env: 'PERPLEXITY_API_KEY', match: /perplexity/i },
  { env: 'COHERE_API_KEY', match: /cohere/i },
  { env: 'FIREWORKS_API_KEY', match: /fireworks/i },
  { env: 'NOVITA_API_KEY', match: /novita/i },
  { env: 'HUGGINGFACE_API_KEY', match: /huggingface/i },
  { env: 'OLLAMA_CLOUD_API_KEY', match: /ollama-cloud/i }
]

type LegalSkillGroup = {
  categories: readonly string[]
  description: string
  id: string
  indiaOnly?: boolean
  label: string
}

const LEGAL_SKILL_GROUPS: readonly LegalSkillGroup[] = [
  {
    categories: ['litigation-legal', 'litigation-legal-agents'],
    description: 'Court matters, pleadings, demand letters, chronology, deposition preparation, legal holds, and docket monitoring.',
    id: 'litigation-legal',
    label: 'Litigation legal'
  },
  {
    categories: ['commercial-legal', 'commercial-legal-agents'],
    description: 'NDA, SaaS/MSA, vendor agreement, renewal, stakeholder, escalation, and commercial playbook workflows.',
    id: 'commercial-legal',
    label: 'Commercial legal'
  },
  {
    categories: ['corporate-legal', 'corporate-legal-agents'],
    description: 'Board minutes, consents, diligence issue extraction, closing checklists, schedules, and deal team workflows.',
    id: 'corporate-legal',
    label: 'Corporate legal'
  },
  {
    categories: ['employment-legal', 'employment-legal-agents'],
    description: 'Hiring, termination, investigations, leave tracking, policy drafting, classification, and wage-hour QA.',
    id: 'employment-legal',
    label: 'Employment legal'
  },
  {
    categories: ['ip-legal', 'ip-legal-agents'],
    description: 'IP clearance, invention intake, OSS review, takedowns, FTO triage, portfolio, and renewal workflows.',
    id: 'ip-legal',
    label: 'IP legal'
  },
  {
    categories: ['privacy-legal'],
    description: 'DPA review, DSAR response, PIA generation, privacy gap analysis, policy monitoring, and use-case triage.',
    id: 'privacy-legal',
    label: 'Privacy legal'
  },
  {
    categories: ['product-legal', 'product-legal-agents'],
    description: 'Launch review, feature risk, marketing claims review, product issue triage, and launch watching.',
    id: 'product-legal',
    label: 'Product legal'
  },
  {
    categories: ['regulatory-legal', 'regulatory-legal-agents'],
    description: 'Regulatory feeds, comments, policy diffs, gap surfacing, redrafting, and regulatory change monitoring.',
    id: 'regulatory-legal',
    label: 'Regulatory legal'
  },
  {
    categories: ['ai-governance-legal'],
    description: 'AI inventory, AI impact assessment generation, governance policies, vendor AI review, and regulatory gap checks.',
    id: 'ai-governance-legal',
    label: 'AI governance legal'
  },
  {
    categories: ['legal-clinic'],
    description: 'Clinic intake, supervision queues, client letters, memos, deadlines, plain-language letters, and student handoff.',
    id: 'legal-clinic',
    label: 'Legal clinic'
  },
  {
    categories: ['law-student'],
    description: 'Case briefs, IRAC practice, outlines, flashcards, exam forecasting, cold-call prep, and study planning.',
    id: 'law-student',
    label: 'Law student'
  },
  {
    categories: ['legal-builder-hub', 'legal-builder-hub-agents'],
    description: 'Skill registry browsing, installation management, QA, related skill surfacing, and legal skill builder workflows.',
    id: 'legal-builder-hub',
    label: 'Legal builder hub'
  },
  {
    categories: ['cocounsel-legal'],
    description: 'CoCounsel-style deep legal research workflow imported from the external legal plugin.',
    id: 'cocounsel-legal',
    label: 'CoCounsel legal'
  },
  {
    categories: ['indian-legal'],
    description: 'India-specific legal workflows, currently including GST compliance and audit guard skills.',
    id: 'indian-legal',
    indiaOnly: true,
    label: 'Indian legal'
  }
]

const SUPPORT_SKILLS = ['lexedge-help', 'pdf', 'docx', 'xlsx', 'pptx', 'ocr-and-documents']

const OPTIONAL_CAPABILITY_GROUPS = [
  {
    description: 'Authentication, account setup, and provider connection helpers.',
    id: 'account',
    label: 'Account and identity'
  },
  {
    description: 'Agent authoring, Codex/Claude-style agent workflows, and autonomous coding assistants.',
    id: 'automation-agents',
    label: 'Automation agents'
  },
  {
    description: 'Email workflows for drafting, searching, and processing mailbox content.',
    id: 'email',
    label: 'Email'
  },
  {
    description: 'Repository review, issues, pull requests, and GitHub workflow helpers.',
    id: 'github',
    label: 'GitHub'
  },
  {
    description: 'PDF, Word, PowerPoint, OCR, notes, workspace, and office productivity helpers.',
    id: 'documents-productivity',
    label: 'Documents and productivity'
  },
  {
    description: 'Research papers, web research, knowledge lookup, and writing support.',
    id: 'research',
    label: 'Research'
  },
  {
    description: 'Code inspection, debugging, testing, web app building, and deployment helpers.',
    id: 'developer',
    label: 'Developer tools'
  },
  {
    description: 'Apple Notes, Reminders, iMessage, Find My, and local macOS control.',
    id: 'apple',
    label: 'Apple and desktop'
  },
  {
    description: 'Design, writing, diagrams, video, audio, and creative media helpers.',
    id: 'creative-media',
    label: 'Creative and media'
  },
  {
    description: 'MLOps, model serving, data science, and notebook workflows.',
    id: 'ml-data',
    label: 'ML and data'
  }
] as const

type WizardStep = 'practice' | 'model' | 'profile' | 'skills' | 'terms' | 'finish'
const assetPath = (path: string) => `${import.meta.env.BASE_URL}${path.replace(/^\/+/, '')}`

const LANGUAGE_BY_LOCALE: Record<string, string> = {
  ar: 'Arabic',
  bn: 'Bengali',
  de: 'German',
  en: 'English',
  es: 'Spanish',
  fr: 'French',
  gu: 'Gujarati',
  hi: 'Hindi',
  it: 'Italian',
  ja: 'Japanese',
  kn: 'Kannada',
  ko: 'Korean',
  ml: 'Malayalam',
  mr: 'Marathi',
  nl: 'Dutch',
  pa: 'Punjabi',
  pt: 'Portuguese',
  ru: 'Russian',
  ta: 'Tamil',
  te: 'Telugu',
  ur: 'Urdu',
  zh: 'Chinese'
}

function detectBrowserLanguage(): string {
  if (typeof navigator === 'undefined') {
    return 'English'
  }
  const locale = navigator.languages?.[0] || navigator.language || ''
  return LANGUAGE_BY_LOCALE[locale.split('-')[0]?.toLowerCase()] || 'English'
}

function detectBrowserTimeZone(): string {
  if (typeof Intl === 'undefined') {
    return 'Asia/Kolkata'
  }
  return Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Kolkata'
}

function normaliseProfileName(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64)
}

function providerPriority(provider: ModelOptionProvider): number {
  const index = PROVIDER_CHOICES.findIndex(choice => choice.match.test(provider.slug) || choice.match.test(provider.name))
  return index >= 0 ? index : PROVIDER_CHOICES.length + 1
}

function providerKeyEnv(provider: ModelOptionProvider | null): string {
  if (!provider) {
    return ''
  }
  const declared = (provider.key_env || '').trim()
  if (declared) {
    return declared
  }
  const identity = `${provider.slug} ${provider.name}`
  return PROVIDER_KEY_ENV_FALLBACKS.find(item => item.match.test(identity))?.env ?? ''
}

function providerHint(provider: ModelOptionProvider): string {
  const common = PROVIDER_CHOICES.find(choice => choice.match.test(provider.slug) || choice.match.test(provider.name))
  if (common) {
    return common.hint
  }
  if (provider.authenticated) {
    return 'Already connected in Hermes.'
  }
  const keyEnv = providerKeyEnv(provider)
  if (keyEnv) {
    return `Paste ${keyEnv} to connect this provider.`
  }
  return `Supported by Hermes. Setup type: ${provider.auth_type || 'external'}.`
}

function providerReady(provider: ModelOptionProvider | null, apiKey: string): boolean {
  if (!provider) {
    return false
  }
  if (provider.authenticated) {
    return true
  }
  return Boolean(providerKeyEnv(provider) && apiKey.trim())
}

function isValidateEndpointUnavailable(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error ?? '')
  return /405|Method Not Allowed|\/api\/providers\/validate/i.test(message)
}

function skillsForCapabilityGroup(groupId: string, skills: SkillInfo[]): string[] {
  return skills
    .filter(skill => {
      const category = (skill.category || '').toLowerCase()
      const name = skill.name.toLowerCase()
      switch (groupId) {
        case 'account':
          return /auth|oauth|account|token|credential|setup/.test(name) && category !== 'github'
        case 'automation-agents':
          return category === 'autonomous-ai-agents' || /agent|codex|claude-code|opencode/.test(name)
        case 'email':
          return category === 'email' || /mail|email|gmail|outlook|himalaya/.test(name)
        case 'github':
          return category === 'github' || /github|repo|pull-request|pr-workflow|code-review|issues/.test(name)
        case 'documents-productivity':
          return (
            category === 'productivity' ||
            /pdf|docx|xlsx|pptx|ocr|powerpoint|notion|airtable|workspace|notes|document/.test(name)
          )
        case 'research':
          return category === 'research' || /arxiv|research|wiki|paper|web/.test(name)
        case 'developer':
          return (
            category === 'software-development' ||
            /debug|test|code|vercel|deploy|frontend|webapp|mcp-builder|react|composition|optimize/.test(name)
          )
        case 'apple':
          return category === 'apple' || /apple|imessage|reminders|findmy|macos/.test(name)
        case 'creative-media':
          return category === 'creative' || category === 'media' || category === 'social-media'
        case 'ml-data':
          return category === 'mlops' || category === 'data-science' || /jupyter|llm|huggingface|vllm|llama/.test(name)
        default:
          return false
      }
    })
    .map(skill => skill.name)
}

function skillsForLegalGroup(group: (typeof LEGAL_SKILL_GROUPS)[number], skills: SkillInfo[]): string[] {
  const categories = new Set(group.categories)
  return skills
    .filter(skill => categories.has(skill.category))
    .map(skill => skill.name)
    .sort((a, b) => a.localeCompare(b))
}

function isIndiaJurisdiction(rows: Array<{ country: string }>, fallback: string): boolean {
  const countries = rows.length ? rows.map(row => row.country) : linesFromCsv(fallback)
  return countries.some(country => /^(india|in|bharat)$/i.test(country.trim()))
}

function defaultLegalSkillGroupIds(indiaPractice: boolean): string[] {
  return LEGAL_SKILL_GROUPS.filter(group => !group.indiaOnly || indiaPractice).map(group => group.id)
}

function linesFromCsv(value: string): string[] {
  return value
    .split(/[\n,]+/)
    .map(item => item.trim())
    .filter(Boolean)
}

function buildPracticeSoul(
  baseSoul: string,
  details: {
    address: string
    contact: string
    jurisdictions: string[]
    practiceName: string
    primaryContact: string
    roleLabel: string
  },
  skillGroups: readonly (typeof LEGAL_SKILL_GROUPS)[number][]
): string {
  const jurisdictions = details.jurisdictions.length ? details.jurisdictions.join(', ') : 'Not specified'
  const selectedGroups = skillGroups.map(group => `- ${group.label}: ${group.description}`).join('\n')
  const profileBlock = [
    '## LexEdge Practice Profile',
    '',
    `- Practice name: ${details.practiceName || 'Not specified'}`,
    `- Primary lawyer/contact: ${details.primaryContact || 'Not specified'}`,
    `- Address: ${details.address || 'Not specified'}`,
    `- Contact details: ${details.contact || 'Not specified'}`,
    `- Applicable jurisdictions: ${jurisdictions}`,
    `- Practice workspace type: ${details.roleLabel}`,
    '',
    '### Enabled legal skill groups',
    selectedGroups || '- Core legal workflow skills',
    '',
    '### Default operating rules',
    '- Treat every output as a draft for lawyer review unless the user explicitly states otherwise.',
    '- Prefer the jurisdictions above when asking follow-up questions, structuring research, and drafting.',
    '- Keep client confidentiality, conflicts, limitation dates, filing deadlines, and evidence gaps visible.',
    '- Ask for missing parties, dates, forum, relief sought, and document context before giving final-form legal work.'
  ].join('\n')

  return `${baseSoul.trim()}\n\n${profileBlock}\n`
}

export function LawyerOnboardingWizard({
  enabled,
  onCompleted
}: {
  enabled: boolean
  onCompleted?: () => void
}) {
  const [visible, setVisible] = useState(false)
  const [status, setStatus] = useState<OnboardingStatus | null>(null)
  const [practiceCatalog, setPracticeCatalog] = useState<LexEdgePracticeCatalog | null>(null)
  const [allSkills, setAllSkills] = useState<SkillInfo[]>([])
  const [step, setStep] = useState<WizardStep>('practice')
  const [profileTab, setProfileTab] = useState<'advanced' | 'essentials'>('essentials')
  const [practiceRole, setPracticeRole] = useState('litigation-lawyer')
  const [profileName, setProfileName] = useState('lexedge-practice')
  const [practiceName, setPracticeName] = useState('')
  const [primaryContact, setPrimaryContact] = useState('')
  const [fullName, setFullName] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [emailAddress, setEmailAddress] = useState('')
  const [mobileNumber, setMobileNumber] = useState('')
  const [practiceAddress, setPracticeAddress] = useState('')
  const [practiceContact, setPracticeContact] = useState('')
  const [jurisdictions, setJurisdictions] = useState('India\nSupreme Court of India\nHigh Court\nDistrict Courts')
  const [positionTitle, setPositionTitle] = useState('')
  const [barRegistrationNumber, setBarRegistrationNumber] = useState('')
  const [yearsExperience, setYearsExperience] = useState('')
  const [primaryLanguage, setPrimaryLanguage] = useState(() => detectBrowserLanguage())
  const [timeZone, setTimeZone] = useState(() => detectBrowserTimeZone())
  const [professionalRoles, setProfessionalRoles] = useState<string[]>(['Advocate'])
  const [secondaryLanguages, setSecondaryLanguages] = useState<string[]>([])
  const [legalSystem, setLegalSystem] = useState('Common Law')
  const [draftingStyle, setDraftingStyle] = useState('Formal')
  const [writingPreference, setWritingPreference] = useState('Balanced')
  const [riskPreference, setRiskPreference] = useState('Conservative')
  const [practiceAreas, setPracticeAreas] = useState<string[]>(['Civil Litigation'])
  const [clientTypes, setClientTypes] = useState<string[]>(['Individuals'])
  const [workTypes, setWorkTypes] = useState<string[]>(['Litigation', 'Drafting', 'Legal Research'])
  const [courtTypes, setCourtTypes] = useState<string[]>(['High Court'])
  const [citationStyles, setCitationStyles] = useState<string[]>(['Indian Neutral Citation'])
  const [complianceFrameworks, setComplianceFrameworks] = useState<string[]>(['India DPDP Act'])
  const [documentTypes, setDocumentTypes] = useState<string[]>(['Petition', 'Affidavit', 'Legal Opinion'])
  const [notificationPreferences, setNotificationPreferences] = useState<string[]>(['Court Updates', 'Judgment Updates'])
  const [jurisdictionRows, setJurisdictionRows] = useState<
    Array<{ bench: string; country: string; court: string; court_type: string; is_primary: boolean; legal_system: string; region: string; state: string }>
  >([
    {
      bench: '',
      country: 'India',
      court: 'Supreme Court of India',
      court_type: 'Supreme Court',
      is_primary: true,
      legal_system: 'Common Law',
      region: 'New Delhi',
      state: 'India'
    }
  ])
  const [jurisdictionDraft, setJurisdictionDraft] = useState({
    bench: '',
    country: 'India',
    court: 'Supreme Court of India',
    court_type: 'Supreme Court',
    legal_system: 'Common Law',
    region: 'New Delhi',
    state: 'India'
  })
  const [selectedSkillGroups, setSelectedSkillGroups] = useState<string[]>(() => defaultLegalSkillGroupIds(true))
  const [selectedCapabilityGroups, setSelectedCapabilityGroups] = useState<string[]>([])
  const [soul, setSoul] = useState('')
  const [providers, setProviders] = useState<ModelOptionProvider[]>([])
  const [providerSlug, setProviderSlug] = useState('')
  const [apiKey, setApiKey] = useState('')
  const [modelSelection, setModelSelection] = useState<null | { model: string; provider: string }>(null)
  const [termsAccepted, setTermsAccepted] = useState(false)
  const [aiDisclaimerAccepted, setAiDisclaimerAccepted] = useState(false)
  const [copyrightAccepted, setCopyrightAccepted] = useState(false)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const providerRows = useMemo(
    () =>
      [...providers].sort((a, b) => {
        const priority = providerPriority(a) - providerPriority(b)
        if (priority !== 0) {
          return priority
        }
        const aConnectable = a.authenticated || Boolean(providerKeyEnv(a))
        const bConnectable = b.authenticated || Boolean(providerKeyEnv(b))
        if (aConnectable !== bConnectable) {
          return aConnectable ? -1 : 1
        }
        return a.name.localeCompare(b.name)
      }),
    [providers]
  )

  const selectedProvider = useMemo(() => providerRows.find(provider => provider.slug === providerSlug) ?? null, [
    providerRows,
    providerSlug
  ])

  useEffect(() => {
    if (!enabled) {
      return
    }

    let cancelled = false
    const forceOnboarding =
      typeof window !== 'undefined' && window.localStorage.getItem(FORCE_ONBOARDING_KEY) === '1'

    getOnboardingStatus()
      .then(next => {
        if (cancelled) {
          return
        }
        setStatus(next)
        setVisible(forceOnboarding || !next.completed)
        if (next.profile_name) {
          setProfileName(next.profile_name === 'default' ? 'lexedge-practice' : next.profile_name)
        }
      })
      .catch(() => {
        if (!cancelled) {
          setVisible(true)
        }
      })

    getGlobalModelOptions({ refresh: true })
      .then(options => {
        if (!cancelled) {
          const rows = options.providers ?? []
          setProviders(rows)
          setProviderSlug(current => {
            if (current && rows.some(provider => provider.slug === current)) {
              return current
            }
            const sorted = [...rows].sort((a, b) => providerPriority(a) - providerPriority(b))
            const preferred =
              sorted.find(provider => provider.authenticated || Boolean(providerKeyEnv(provider))) ??
              sorted[0]
            return preferred?.slug ?? ''
          })
        }
      })
      .catch(() => undefined)

    getLexEdgePracticeCatalog()
      .then(catalog => {
        if (!cancelled) {
          setPracticeCatalog(catalog)
          setPositionTitle(current => current || catalog.options.position_titles?.[0] || '')
          setPrimaryLanguage(current => current || catalog.options.languages?.[0] || 'English')
          setTimeZone(current => current || catalog.options.time_zones?.[0] || 'Asia/Kolkata')
          setLegalSystem(current => current || catalog.options.legal_systems?.[0] || 'Common Law')
          setDraftingStyle(current => current || catalog.options.drafting_styles?.[0] || 'Formal')
          setWritingPreference(current => current || catalog.options.writing_preferences?.[1] || catalog.options.writing_preferences?.[0] || 'Balanced')
          setRiskPreference(current => current || catalog.options.risk_preferences?.[1] || catalog.options.risk_preferences?.[0] || 'Conservative')
        }
      })
      .catch(() => undefined)

    getSkills()
      .then(skills => {
        if (!cancelled) {
          setAllSkills(skills)
        }
      })
      .catch(() => undefined)

    return () => {
      cancelled = true
    }
  }, [enabled])

  useEffect(() => {
    let cancelled = false
    setMessage('Preparing workspace defaults...')
    getPracticeRoleSoulTemplate(practiceRole)
      .then(template => {
        if (!cancelled) {
          setSoul(template.content)
          setMessage(null)
        }
      })
      .catch(err => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Could not prepare workspace defaults.')
          setMessage(null)
        }
      })
    return () => {
      cancelled = true
    }
  }, [practiceRole])

  useEffect(() => {
    const indiaPractice = isIndiaJurisdiction(jurisdictionRows, jurisdictions)
    setSelectedSkillGroups(current => {
      const withoutIndia = current.filter(id => id !== 'indian-legal')
      if (indiaPractice) {
        return Array.from(new Set([...withoutIndia, 'indian-legal']))
      }
      return withoutIndia
    })
  }, [jurisdictionRows, jurisdictions])

  if (!enabled || !visible) {
    return null
  }

  const trimmedProfileName = normaliseProfileName(profileName)
  const profileNameInvalid = !trimmedProfileName || !PROFILE_NAME_RE.test(trimmedProfileName)
  const selectedProviderKeyEnv = providerKeyEnv(selectedProvider)
  const modelReady = providerReady(selectedProvider, apiKey)
  const stepOrder: WizardStep[] = ['practice', 'model', 'profile', 'skills', 'terms', 'finish']
  const currentStepIndex = stepOrder.indexOf(step)
  const indiaPractice = isIndiaJurisdiction(jurisdictionRows, jurisdictions)
  const selectedLegalSkillGroups = LEGAL_SKILL_GROUPS.filter(group => selectedSkillGroups.includes(group.id))
  const skillsByLegalGroup = new Map<string, string[]>(
    LEGAL_SKILL_GROUPS.map(group => [group.id, skillsForLegalGroup(group, allSkills)])
  )
  const selectedLegalSkillNames = new Set<string>(
    selectedLegalSkillGroups.flatMap(group => skillsByLegalGroup.get(group.id) ?? [])
  )
  const supportSkillNames = new Set<string>(SUPPORT_SKILLS)
  const skillsByCapabilityGroup = new Map<string, string[]>(
    OPTIONAL_CAPABILITY_GROUPS.map(group => [group.id, skillsForCapabilityGroup(group.id, allSkills)])
  )
  const selectedCapabilitySkills = selectedCapabilityGroups.flatMap(group => skillsByCapabilityGroup.get(group) ?? [])
  const keepSkills = Array.from(
    new Set([
      ...SUPPORT_SKILLS,
      ...selectedLegalSkillGroups.flatMap(group => skillsByLegalGroup.get(group.id) ?? []),
      ...selectedCapabilitySkills
    ])
  )
  const selectedCapabilityGroupSet = new Set(selectedCapabilityGroups)
  const selectedPracticeRole = PRACTICE_ROLES.find(role => role.value === practiceRole)
  const jurisdictionList = jurisdictionRows.length
    ? jurisdictionRows.map(row => [row.country, row.state, row.region, row.court_type, row.court, row.bench].filter(Boolean).join(' / '))
    : linesFromCsv(jurisdictions)
  const catalogOptions = practiceCatalog?.options ?? {}
  const catalogGroups = practiceCatalog?.groups ?? {}
  const jurisdictionCatalog = practiceCatalog?.jurisdictions ?? []
  const countryOptions = Array.from(new Set(jurisdictionCatalog.map(item => item.country))).sort()
  const stateOptions = Array.from(
    new Set(jurisdictionCatalog.filter(item => item.country === jurisdictionDraft.country).map(item => item.state).filter(Boolean))
  ).sort()
  const regionOptions = Array.from(
    new Set(
      jurisdictionCatalog
        .filter(item => item.country === jurisdictionDraft.country && (!jurisdictionDraft.state || item.state === jurisdictionDraft.state))
        .map(item => item.region)
        .filter(Boolean)
    )
  ).sort()
  const jurisdictionCourtTypes = Array.from(
    new Set(
      jurisdictionCatalog
        .filter(
          item =>
            item.country === jurisdictionDraft.country &&
            (!jurisdictionDraft.state || item.state === jurisdictionDraft.state) &&
            (!jurisdictionDraft.region || item.region === jurisdictionDraft.region)
        )
        .map(item => item.court_type)
        .filter(Boolean)
    )
  ).sort()
  const courtOptions = Array.from(
    new Set(
      jurisdictionCatalog
        .filter(
          item =>
            item.country === jurisdictionDraft.country &&
            (!jurisdictionDraft.state || item.state === jurisdictionDraft.state) &&
            (!jurisdictionDraft.region || item.region === jurisdictionDraft.region) &&
            (!jurisdictionDraft.court_type || item.court_type === jurisdictionDraft.court_type)
        )
        .map(item => item.court)
        .filter(Boolean)
    )
  ).sort()

  function updatePrimaryJurisdiction(nextDraft: typeof jurisdictionDraft) {
    setJurisdictionDraft(nextDraft)
    setJurisdictionRows(current => {
      const primary = { ...nextDraft, is_primary: true }
      if (!current.length) {
        return [primary]
      }
      return current.map((row, index) => (index === 0 ? primary : { ...row, is_primary: false }))
    })
  }

  async function refreshStatus(): Promise<OnboardingStatus | null> {
    try {
      const next = await getOnboardingStatus()
      setStatus(next)
      return next
    } catch {
      return null
    }
  }

  async function savePracticeWorkspace() {
    if (profileNameInvalid) {
      setError('Use lowercase letters, numbers, hyphen, or underscore for the workspace name.')
      return
    }

    setError(null)
    setStep('model')
  }

  async function saveAndTestModel() {
    if (!selectedProvider) {
      setError('Choose an AI service that supports setup in the app.')
      return
    }
    if (!modelReady) {
      setError('Paste the API key for the selected AI service.')
      return
    }

    setBusy(true)
    setError(null)
    setMessage('Checking the AI service and choosing a model...')
    try {
      if (!selectedProvider.authenticated) {
        if (!selectedProviderKeyEnv) {
          throw new Error(`${selectedProvider.name} cannot be configured with an API key here.`)
        }
        try {
          const probe = await validateProviderCredential(selectedProviderKeyEnv, apiKey.trim(), apiKey.trim())
          if (!probe.ok) {
            throw new Error(probe.message || 'The API key could not be verified.')
          }
        } catch (err) {
          if (!isValidateEndpointUnavailable(err)) {
            throw err
          }
          setMessage('This backend cannot live-test the key yet. Saving it locally and continuing setup...')
        }
        await setEnvVar(selectedProviderKeyEnv, apiKey.trim())
      }

      const refreshed = await getGlobalModelOptions({ refresh: true })
      const provider =
        refreshed.providers?.find(item => item.slug === selectedProvider.slug) ??
        selectedProvider
      const recommendation = await getRecommendedDefaultModel(provider.slug)
      await setGlobalModel(recommendation.provider, recommendation.model)
      setModelSelection({ provider: recommendation.provider, model: recommendation.model })
      await updateOnboardingStep('ai_model', true)
      await updateOnboardingStep('model_test', true)
      await refreshStatus()
      setApiKey('')
      setStep('profile')
      setMessage(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'The AI service test failed.')
    } finally {
      setBusy(false)
    }
  }

  async function savePracticeProfile() {
    if (!practiceName.trim()) {
      setError('Enter the lawyer or firm practice name.')
      return
    }
    if (!fullName.trim()) {
      setError('Enter the lawyer full name for this practice profile.')
      return
    }
    if (!emailAddress.trim()) {
      setError('Enter the email address for this practice profile.')
      return
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailAddress.trim())) {
      setError('Enter a valid email address for this practice profile.')
      return
    }
    if (!jurisdictionList.length) {
      setError('Add at least one applicable jurisdiction.')
      return
    }

    setError(null)
    setStep('skills')
  }

  async function saveSkillSelection() {
    if (!selectedLegalSkillGroups.length) {
      setError('Select at least one legal skill group.')
      return
    }

    setBusy(true)
    setError(null)
    setMessage('Creating your customized Hermes practice profile...')
    try {
      const existing = status?.profiles.find(profile => profile.name === trimmedProfileName)
      const customizedSoul = buildPracticeSoul(
        soul,
        {
          address: practiceAddress.trim(),
          contact: practiceContact.trim(),
          jurisdictions: jurisdictionList,
          practiceName: practiceName.trim(),
          primaryContact: primaryContact.trim() || displayName.trim() || fullName.trim(),
          roleLabel: selectedPracticeRole?.label ?? practiceRole
        },
        selectedLegalSkillGroups
      )

      if (!existing) {
        await createProfile({
          name: trimmedProfileName,
          clone_from: 'default',
          keep_skills: keepSkills,
          model: modelSelection?.model,
          provider: modelSelection?.provider,
          practice_role: practiceRole
        })
      } else if (!existing.practice_role) {
        throw new Error('A workspace with this name already exists. Choose another name for the legal workspace.')
      } else {
        await applyProfileSkillSelection(trimmedProfileName, keepSkills)
      }

      await saveLexEdgePracticeProfile(trimmedProfileName, {
        personal: {
          bar_registration_number: barRegistrationNumber.trim(),
          display_name: displayName.trim() || fullName.trim(),
          email: emailAddress.trim(),
          full_name: fullName.trim(),
          mobile: mobileNumber.trim(),
          organisation: practiceName.trim(),
          position_title: positionTitle,
          primary_language: primaryLanguage,
          time_zone: timeZone,
          years_experience: yearsExperience.trim() ? Number(yearsExperience.trim()) : null
        },
        client_types: clientTypes,
        compliance_frameworks: complianceFrameworks,
        court_types: courtTypes,
        citation_styles: citationStyles,
        document_types: documentTypes,
        jurisdictions: jurisdictionRows,
        notification_preferences: notificationPreferences,
        practice_areas: practiceAreas,
        preferences: {
          drafting_style: draftingStyle,
          legal_system: legalSystem,
          risk_preference: riskPreference,
          writing_preference: writingPreference
        },
        professional_roles: professionalRoles,
        secondary_languages: secondaryLanguages,
        skill_groups: selectedLegalSkillGroups.map(group => group.id),
        work_types: workTypes
      })
      await updateProfileSoul(trimmedProfileName, customizedSoul)
      await updateOnboardingStep('profile_name', trimmedProfileName)
      await updateOnboardingStep('practice_workspace', true)
      await ensureGatewayProfile(trimmedProfileName)
      await refreshStatus()
      setStep('terms')
      setMessage(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create the practice profile.')
    } finally {
      setBusy(false)
    }
  }

  async function acceptSafety() {
    if (!termsAccepted || !aiDisclaimerAccepted || !copyrightAccepted) {
      setError('Accept the terms, AI disclaimer, and copyright notice before continuing.')
      return
    }

    setBusy(true)
    setError(null)
    try {
      await updateOnboardingStep('legal_safety', true)
      await refreshStatus()
      setStep('finish')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save the terms confirmation.')
    } finally {
      setBusy(false)
    }
  }

  async function finish() {
    setBusy(true)
    setError(null)
    try {
      await completeOnboarding(true)
      window.localStorage.removeItem(FORCE_ONBOARDING_KEY)
      setVisible(false)
      onCompleted?.()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Mandatory setup is not complete yet.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="fixed inset-0 z-[1320] flex bg-[#f8fbff] text-slate-950">
      <aside className="hidden w-[18rem] shrink-0 border-r border-slate-200 bg-white p-8 lg:block">
        <div className="flex items-center gap-3">
          <img alt="" className="size-12 rounded-[8px] object-cover" src={assetPath('lexedge-app-icon.jpg')} />
          <div>
            <div className="text-xs font-semibold tracking-[0.18em] text-primary uppercase">LexEdge</div>
            <div className="text-sm font-semibold">Legal Hermes Agent</div>
          </div>
        </div>
        <h1 className="mt-7 text-2xl leading-8 font-semibold">LexEdge Legal Hermes Agent setup</h1>
        <p className="mt-3 text-sm leading-6 text-(--ui-text-secondary)">
          Complete the required setup once. Messaging, Gmail, WhatsApp, templates, and reminders can be added later.
        </p>

        <ol className="mt-10 space-y-4 text-sm">
          {[
            ['practice', 'Practice workspace'],
            ['model', 'AI service'],
            ['terms', 'Terms and AI disclaimer'],
            ['finish', 'Start screen']
          ].map(([id, label], index) => (
            <li
              className={cn(
                'flex items-center gap-3 text-(--ui-text-secondary)',
                index <= currentStepIndex && 'text-(--ui-text-primary)'
              )}
              key={id}
            >
              <span
                className={cn(
                  'flex size-6 items-center justify-center rounded-full border border-(--ui-stroke-secondary) text-xs',
                  index < currentStepIndex && 'border-primary bg-primary text-primary-foreground',
                  index === currentStepIndex && 'border-primary text-primary'
                )}
              >
                {index < currentStepIndex ? <CheckCircle2 className="size-3.5" /> : index + 1}
              </span>
              {label}
            </li>
          ))}
        </ol>
      </aside>

      <main className="flex min-w-0 flex-1 flex-col bg-[#f8fbff]">
        <div className="border-b border-slate-200 bg-white px-6 py-5 lg:px-10">
          <div className="flex items-center justify-between gap-6">
            <div>
              <div className="flex items-center gap-3">
                <img alt="" className="size-10 rounded-[8px] object-cover" src={assetPath('lexedge-app-icon.jpg')} />
                <div>
                  <div className="text-xs font-semibold tracking-[0.18em] text-primary uppercase">
                    LexEdge Legal Hermes Agent
                  </div>
                  <div className="mt-1 text-sm text-slate-600">LexEdge AI Labs Private Limited</div>
                </div>
              </div>
            </div>
            <div className="hidden text-right text-xs leading-5 text-slate-500 sm:block">
              Mandatory setup for Indian legal workflows
            </div>
          </div>
        </div>

        <div className="flex-1 overflow-auto px-6 py-8 lg:px-10">
          {(error || message) && (
            <div className="sticky top-0 z-20 mx-auto max-w-5xl pb-4">
              <StatusAlert error={error} message={message} />
            </div>
          )}

          <div className="mx-auto max-w-5xl">
            {step === 'practice' && (
              <section>
                <StepHeading
                  icon={<Users />}
                  title="Create your practice workspace"
                  description="Choose the closest practice type. LexEdge Legal Hermes Agent will create a separate workspace with the right legal skills, defaults, and safeguards."
                />
                <PrivacySafetyNote />
                <div className="mt-8 grid gap-4 lg:grid-cols-2">
                  {PRACTICE_ROLES.map(role => (
                    <button
                      className={cn(
                        'rounded-[6px] border border-(--ui-stroke-secondary) p-5 text-left transition hover:border-primary/60 hover:bg-(--chrome-action-hover)',
                        practiceRole === role.value && 'border-primary bg-primary/5'
                      )}
                      disabled={busy}
                      key={role.value}
                      onClick={() => {
                        setPracticeRole(role.value)
                        setProfileName(normaliseProfileName(role.value.replace('-lawyer', '')))
                      }}
                      type="button"
                    >
                      <div className="text-base font-semibold">{role.label}</div>
                      <p className="mt-2 text-sm leading-6 text-(--ui-text-secondary)">{role.description}</p>
                    </button>
                  ))}
                </div>

                <label className="mt-8 block text-sm font-medium" htmlFor="lexedge-profile-name">
                  Workspace name
                </label>
                <Input
                  className="mt-2 max-w-md"
                  disabled={busy}
                  id="lexedge-profile-name"
                  onChange={event => setProfileName(event.target.value)}
                  value={profileName}
                />
                <p className="mt-2 text-sm text-(--ui-text-secondary)">
                  This keeps matters, settings, legal skills, and practice preferences separate from other workspaces.
                </p>
              </section>
            )}

            {step === 'model' && (
              <section>
                <StepHeading
                  icon={<KeyRound />}
                  title="Connect an AI service"
                  description="Choose any provider supported by Hermes. Common providers are shown first; advanced providers remain available below."
                />
                <PrivacySafetyNote />
                <div className="mt-8 grid max-h-[25rem] gap-3 overflow-auto pr-1 lg:grid-cols-3">
                  {providerRows.map(provider => {
                    const selected = provider.slug === selectedProvider?.slug
                    const connected = Boolean(provider.authenticated)
                    const connectable = connected || Boolean(providerKeyEnv(provider))
                    return (
                      <button
                        className={cn(
                          'rounded-[6px] border border-slate-200 bg-white p-4 text-left transition hover:border-primary/60 hover:bg-blue-50/50',
                          selected && 'border-primary bg-primary/5'
                        )}
                        disabled={busy}
                        key={provider.slug}
                        onClick={() => {
                          setProviderSlug(provider.slug)
                          setApiKey('')
                        }}
                        type="button"
                      >
                        <div className="flex items-center justify-between gap-3">
                          <span className="text-sm font-semibold">{provider.name}</span>
                          <span
                            className={cn(
                              'rounded-full px-2 py-0.5 text-[0.6875rem]',
                              connected && 'bg-emerald-500/10 text-emerald-700',
                              !connected && connectable && 'bg-blue-500/10 text-blue-700',
                              !connected && !connectable && 'bg-slate-100 text-slate-500'
                            )}
                          >
                            {connected ? 'Connected' : connectable ? 'API key' : 'Advanced'}
                          </span>
                        </div>
                        <p className="mt-2 text-sm leading-5 text-slate-600">{providerHint(provider)}</p>
                      </button>
                    )
                  })}
                </div>

                <div className="mt-8 max-w-xl">
                  <label className="block text-sm font-medium" htmlFor="lexedge-api-key">
                    API key
                  </label>
                  <Input
                    autoComplete="off"
                    className="mt-2"
                    disabled={busy || Boolean(selectedProvider?.authenticated) || !selectedProviderKeyEnv}
                    id="lexedge-api-key"
                    onChange={event => setApiKey(event.target.value)}
                    placeholder={
                      selectedProvider?.authenticated
                        ? 'Already connected'
                        : selectedProviderKeyEnv
                          ? selectedProviderKeyEnv
                          : 'Advanced setup required'
                    }
                    type="password"
                    value={apiKey}
                  />
                  <p className="mt-2 text-sm leading-6 text-(--ui-text-secondary)">
                    {selectedProvider?.authenticated
                      ? 'This AI service is already connected. Continue to run the model test.'
                      : selectedProviderKeyEnv
                        ? `This saves ${selectedProviderKeyEnv} locally on this computer.`
                        : 'This provider is supported by Hermes but needs its own advanced setup. Pick an API-key provider to finish onboarding here.'}
                  </p>
                </div>
              </section>
            )}

            {step === 'profile' && (
              <section>
                <StepHeading
                  icon={<Users />}
                  title="Practice profile"
                  description="Add the lawyer or firm details LexEdge should use as the default context for this Hermes profile."
                />
                <PrivacySafetyNote />

                <div className="mt-8 grid gap-5 lg:grid-cols-2">
                  <div>
                    <label className="block text-sm font-medium" htmlFor="lexedge-practice-name">
                      Lawyer or firm name
                    </label>
                    <Input
                      className="mt-2"
                      disabled={busy}
                      id="lexedge-practice-name"
                      onChange={event => {
                        setPracticeName(event.target.value)
                        if (!profileName.trim()) {
                          setProfileName(normaliseProfileName(event.target.value))
                        }
                      }}
                      placeholder="Example & Associates"
                      value={practiceName}
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium" htmlFor="lexedge-full-name">
                      Lawyer full name
                    </label>
                    <Input
                      className="mt-2"
                      disabled={busy}
                      id="lexedge-full-name"
                      onChange={event => {
                        setFullName(event.target.value)
                        if (!displayName.trim()) {
                          setDisplayName(event.target.value)
                        }
                      }}
                      placeholder="Adv. Full Name"
                      value={fullName}
                    />
                  </div>
                </div>

                <div className="mt-5 grid gap-5 lg:grid-cols-2">
                  <div>
                    <label className="block text-sm font-medium" htmlFor="lexedge-email">
                      Email address
                    </label>
                    <Input
                      className="mt-2"
                      disabled={busy}
                      id="lexedge-email"
                      onChange={event => setEmailAddress(event.target.value)}
                      placeholder="lawyer@example.com"
                      type="email"
                      value={emailAddress}
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium" htmlFor="lexedge-mobile">
                      Mobile number
                    </label>
                    <Input
                      className="mt-2"
                      disabled={busy}
                      id="lexedge-mobile"
                      onChange={event => setMobileNumber(event.target.value)}
                      placeholder="+91 ..."
                      value={mobileNumber}
                    />
                  </div>
                </div>

                <div className="mt-5 rounded-[6px] border border-slate-200 bg-white p-5">
                  <div className="text-base font-semibold">Primary jurisdiction</div>
                  <div className="mt-4 grid gap-4 lg:grid-cols-4">
                    <SelectField
                      label="Country"
                      onChange={country =>
                        updatePrimaryJurisdiction({ ...jurisdictionDraft, country, state: '', region: '', court_type: '', court: '' })
                      }
                      options={countryOptions}
                      value={jurisdictionDraft.country}
                    />
                    <SelectField
                      label="State / province"
                      onChange={state =>
                        updatePrimaryJurisdiction({ ...jurisdictionDraft, state, region: '', court_type: '', court: '' })
                      }
                      options={stateOptions}
                      value={jurisdictionDraft.state}
                    />
                    <SelectField
                      label="Court type"
                      onChange={court_type => updatePrimaryJurisdiction({ ...jurisdictionDraft, court_type, court: '' })}
                      options={jurisdictionCourtTypes.length ? jurisdictionCourtTypes : catalogOptions.court_types ?? []}
                      value={jurisdictionDraft.court_type}
                    />
                    <SelectField
                      label="Legal system"
                      onChange={value => {
                        setLegalSystem(value)
                        updatePrimaryJurisdiction({ ...jurisdictionDraft, legal_system: value })
                      }}
                      options={catalogOptions.legal_systems ?? []}
                      value={legalSystem}
                    />
                    <SelectField label="Time zone" onChange={setTimeZone} options={catalogOptions.time_zones ?? []} value={timeZone} />
                  </div>
                </div>

                <div className="mt-8 flex gap-2 border-b border-slate-200">
                  <button
                    className={cn(
                      'border-b-2 px-1 pb-3 text-sm font-medium',
                      profileTab === 'essentials' ? 'border-primary text-primary' : 'border-transparent text-slate-500'
                    )}
                    onClick={() => setProfileTab('essentials')}
                    type="button"
                  >
                    Essentials
                  </button>
                  <button
                    className={cn(
                      'border-b-2 px-1 pb-3 text-sm font-medium',
                      profileTab === 'advanced' ? 'border-primary text-primary' : 'border-transparent text-slate-500'
                    )}
                    onClick={() => setProfileTab('advanced')}
                    type="button"
                  >
                    Advanced
                  </button>
                </div>

                {profileTab === 'essentials' && (
                  <div className="mt-5 rounded-[6px] border border-slate-200 bg-white p-5 text-sm leading-6 text-slate-700">
                    LexEdge will use sensible defaults for language, drafting style, citations, document types, and
                    legal skill preferences. Time zone is detected automatically when possible. Open Advanced only
                    when this practice needs more specific configuration.
                  </div>
                )}

                {profileTab === 'advanced' && (
                  <>
                <div className="mt-5 grid gap-5 lg:grid-cols-2">
                  <div>
                    <label className="block text-sm font-medium" htmlFor="lexedge-primary-contact">
                      Primary lawyer/contact role
                    </label>
                    <Input
                      className="mt-2"
                      disabled={busy}
                      id="lexedge-primary-contact"
                      onChange={event => setPrimaryContact(event.target.value)}
                      placeholder="Managing partner, counsel, chambers contact, or team"
                      value={primaryContact}
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium" htmlFor="lexedge-display-name">
                      Display name
                    </label>
                    <Input
                      className="mt-2"
                      disabled={busy}
                      id="lexedge-display-name"
                      onChange={event => setDisplayName(event.target.value)}
                      placeholder="Name shown in LexEdge"
                      value={displayName}
                    />
                  </div>
                </div>

                <div className="mt-5 grid gap-5 lg:grid-cols-2">
                  <div>
                    <label className="block text-sm font-medium" htmlFor="lexedge-practice-address">
                      Address
                    </label>
                    <Textarea
                      className="mt-2 min-h-28"
                      disabled={busy}
                      id="lexedge-practice-address"
                      onChange={event => setPracticeAddress(event.target.value)}
                      placeholder="Office address, city, state, PIN"
                      value={practiceAddress}
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium" htmlFor="lexedge-practice-contact">
                      Contact details
                    </label>
                    <Textarea
                      className="mt-2 min-h-28"
                      disabled={busy}
                      id="lexedge-practice-contact"
                      onChange={event => setPracticeContact(event.target.value)}
                      placeholder="Phone, email, website, chambers, or internal contact rules"
                      value={practiceContact}
                    />
                  </div>
                </div>

                <div className="mt-8 grid gap-5 lg:grid-cols-3">
                  <SelectField label="Position / title" onChange={setPositionTitle} options={catalogOptions.position_titles ?? []} value={positionTitle} />
                  <SelectField label="Primary language" onChange={setPrimaryLanguage} options={catalogOptions.languages ?? []} value={primaryLanguage} />
                  <div>
                    <label className="block text-sm font-medium" htmlFor="lexedge-bar-registration">
                      Bar registration number
                    </label>
                    <Input
                      className="mt-2"
                      disabled={busy}
                      id="lexedge-bar-registration"
                      onChange={event => setBarRegistrationNumber(event.target.value)}
                      value={barRegistrationNumber}
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium" htmlFor="lexedge-years-experience">
                      Years of experience
                    </label>
                    <Input
                      className="mt-2"
                      disabled={busy}
                      id="lexedge-years-experience"
                      min="0"
                      onChange={event => setYearsExperience(event.target.value)}
                      type="number"
                      value={yearsExperience}
                    />
                  </div>
                  <SelectField label="Legal system" onChange={setLegalSystem} options={catalogOptions.legal_systems ?? []} value={legalSystem} />
                </div>

                <div className="mt-8 grid gap-5 lg:grid-cols-2">
                  <MultiCheckGroup label="Professional roles" onChange={setProfessionalRoles} options={catalogOptions.professional_roles ?? []} value={professionalRoles} />
                  <MultiCheckGroup label="Secondary languages" onChange={setSecondaryLanguages} options={catalogOptions.languages ?? []} value={secondaryLanguages} />
                </div>

                <div className="mt-8 rounded-[6px] border border-slate-200 bg-white p-5">
                  <div className="text-base font-semibold">Practice jurisdictions</div>
                  <div className="mt-4 grid gap-4 lg:grid-cols-3">
                    <SelectField
                      label="Country"
                      onChange={country => setJurisdictionDraft(current => ({ ...current, country, state: '', region: '', court_type: '', court: '' }))}
                      options={countryOptions}
                      value={jurisdictionDraft.country}
                    />
                    <SelectField
                      label="State / province"
                      onChange={state => setJurisdictionDraft(current => ({ ...current, state, region: '', court_type: '', court: '' }))}
                      options={stateOptions}
                      value={jurisdictionDraft.state}
                    />
                    <SelectField
                      label="Judicial region"
                      onChange={region => setJurisdictionDraft(current => ({ ...current, region, court_type: '', court: '' }))}
                      options={regionOptions}
                      value={jurisdictionDraft.region}
                    />
                    <SelectField
                      label="Court type"
                      onChange={court_type => setJurisdictionDraft(current => ({ ...current, court_type, court: '' }))}
                      options={jurisdictionCourtTypes.length ? jurisdictionCourtTypes : catalogOptions.court_types ?? []}
                      value={jurisdictionDraft.court_type}
                    />
                    <SelectField
                      label="Court"
                      onChange={court => setJurisdictionDraft(current => ({ ...current, court }))}
                      options={courtOptions}
                      value={jurisdictionDraft.court}
                    />
                    <div>
                      <label className="block text-sm font-medium" htmlFor="lexedge-bench">
                        Bench
                      </label>
                      <Input
                        className="mt-2"
                        disabled={busy}
                        id="lexedge-bench"
                        onChange={event => setJurisdictionDraft(current => ({ ...current, bench: event.target.value }))}
                        value={jurisdictionDraft.bench}
                      />
                    </div>
                  </div>
                  <Button
                    className="mt-4"
                    onClick={() => {
                      setJurisdictionRows(current => [
                        ...current.map(row => ({ ...row, is_primary: false })),
                        { ...jurisdictionDraft, is_primary: current.length === 0 }
                      ])
                    }}
                    type="button"
                    variant="secondary"
                  >
                    Add jurisdiction
                  </Button>
                  <div className="mt-4 grid gap-2">
                    {jurisdictionRows.map((row, index) => (
                      <div className="flex items-center justify-between rounded-[6px] bg-slate-50 px-3 py-2 text-sm" key={`${row.country}-${row.state}-${row.court}-${index}`}>
                        <span>
                          {row.is_primary ? 'Primary - ' : ''}
                          {[row.legal_system, row.country, row.state, row.region, row.court_type, row.court, row.bench]
                            .filter(Boolean)
                            .join(' / ')}
                        </span>
                        <button
                          className="text-xs text-slate-500 hover:text-red-600"
                          onClick={() => setJurisdictionRows(current => current.filter((_, itemIndex) => itemIndex !== index))}
                          type="button"
                        >
                          Remove
                        </button>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="mt-8 grid gap-5 lg:grid-cols-2">
                  <MultiCheckGroup grouped label="Practice areas" onChange={setPracticeAreas} options={catalogGroups.practice_areas ?? {}} value={practiceAreas} />
                  <MultiCheckGroup label="Client types" onChange={setClientTypes} options={catalogOptions.client_types ?? []} value={clientTypes} />
                  <MultiCheckGroup label="Work types" onChange={setWorkTypes} options={catalogOptions.work_types ?? []} value={workTypes} />
                  <MultiCheckGroup label="Court types" onChange={setCourtTypes} options={catalogOptions.court_types ?? []} value={courtTypes} />
                  <MultiCheckGroup label="Citation styles" onChange={setCitationStyles} options={catalogOptions.citation_styles ?? []} value={citationStyles} />
                  <MultiCheckGroup label="Compliance frameworks" onChange={setComplianceFrameworks} options={catalogOptions.compliance_frameworks ?? []} value={complianceFrameworks} />
                  <MultiCheckGroup grouped label="Preferred document types" onChange={setDocumentTypes} options={catalogGroups.document_types ?? {}} value={documentTypes} />
                  <MultiCheckGroup label="Notification preferences" onChange={setNotificationPreferences} options={catalogOptions.notification_preferences ?? []} value={notificationPreferences} />
                </div>

                <div className="mt-8 grid gap-5 lg:grid-cols-3">
                  <SelectField label="Drafting style" onChange={setDraftingStyle} options={catalogOptions.drafting_styles ?? []} value={draftingStyle} />
                  <SelectField label="Writing preference" onChange={setWritingPreference} options={catalogOptions.writing_preferences ?? []} value={writingPreference} />
                  <SelectField label="Risk preference" onChange={setRiskPreference} options={catalogOptions.risk_preferences ?? []} value={riskPreference} />
                </div>
                  </>
                )}
              </section>
            )}

            {step === 'skills' && (
              <section>
                <StepHeading
                  icon={<CheckCircle2 />}
                  title="Legal skill groups"
                  description="Legal practice groups are selected by default. Indian legal is selected only when the practice jurisdiction includes India."
                />
                <PrivacySafetyNote />

                <div className="mt-8 grid gap-4 lg:grid-cols-2">
                  {LEGAL_SKILL_GROUPS.map(group => {
                    const selected = selectedSkillGroups.includes(group.id)
                    const skills = skillsByLegalGroup.get(group.id) ?? []
                    const lockedOff = group.indiaOnly && !indiaPractice
                    return (
                      <label
                        className={cn(
                          'flex items-start gap-4 rounded-[6px] border border-slate-200 bg-white p-5 transition',
                          selected && 'border-primary bg-primary/5',
                          lockedOff && 'bg-slate-50 opacity-75'
                        )}
                        key={group.id}
                      >
                        <Checkbox
                          checked={selected}
                          className="mt-1"
                          disabled={busy || lockedOff}
                          onCheckedChange={checked => {
                            setSelectedSkillGroups(current =>
                              checked ? Array.from(new Set([...current, group.id])) : current.filter(id => id !== group.id)
                            )
                          }}
                        />
                        <span>
                          <span className="flex flex-wrap items-center gap-2 text-base font-semibold">
                            {group.label}
                            {group.indiaOnly && (
                              <span className="rounded-full bg-blue-100 px-2 py-0.5 text-[0.6875rem] font-medium text-blue-700">
                                {indiaPractice ? 'India jurisdiction' : 'India only'}
                              </span>
                            )}
                            <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[0.6875rem] font-medium text-slate-600">
                              {skills.length} skills
                            </span>
                          </span>
                          <span className="mt-2 block text-sm leading-6 text-slate-600">{group.description}</span>
                          {skills.length > 0 && (
                            <span className="mt-3 block text-xs leading-5 text-slate-500">
                              Includes: {skills.slice(0, 4).join(', ')}
                              {skills.length > 4 ? `, +${skills.length - 4} more` : ''}
                            </span>
                          )}
                        </span>
                      </label>
                    )
                  })}
                </div>

                <div className="mt-6 rounded-[6px] border border-slate-200 bg-white p-4 text-sm leading-6 text-slate-700">
                  This profile will keep {keepSkills.length} focused skills active, including document helpers for PDF,
                  Word, Excel, PowerPoint, and OCR where available.
                </div>

                <div className="mt-8 rounded-[6px] border border-slate-200 bg-white p-5">
                  <div className="flex flex-wrap items-end justify-between gap-3">
                    <div>
                      <div className="text-base font-semibold">Additional skill groups</div>
                      <p className="mt-2 text-sm leading-6 text-slate-600">
                        Legal practice groups are selected above from your profile. Add only the extra non-legal
                        capability groups this workspace needs.
                      </p>
                    </div>
                    <div className="text-sm text-slate-500">
                      {selectedCapabilityGroups.length} optional groups selected
                    </div>
                  </div>

                  <div className="mt-5 grid gap-3 lg:grid-cols-2">
                    <label className="flex items-start gap-3 rounded-[6px] border border-primary bg-primary/5 p-4 text-sm">
                      <Checkbox checked className="mt-1" disabled />
                      <span>
                        <span className="flex flex-wrap items-center gap-2 font-semibold">
                          Document helpers
                          <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[0.6875rem] font-medium text-slate-600">
                            Support
                          </span>
                        </span>
                        <span className="mt-2 block leading-5 text-slate-600">
                          PDF, Word, Excel, PowerPoint, OCR, and LexEdge help skills needed for legal document work.
                        </span>
                        <span className="mt-2 block text-xs text-slate-500">{supportSkillNames.size} support skills selected</span>
                      </span>
                    </label>

                    {OPTIONAL_CAPABILITY_GROUPS.map(group => {
                      const skills = skillsByCapabilityGroup.get(group.id) ?? []
                      const selected = selectedCapabilityGroupSet.has(group.id)
                      return (
                        <label
                          className={cn(
                            'flex items-start gap-3 rounded-[6px] border border-slate-200 p-4 text-sm transition',
                            selected && 'border-primary bg-primary/5'
                          )}
                          key={group.id}
                        >
                          <Checkbox
                            checked={selected}
                            className="mt-1"
                            disabled={busy || skills.length === 0}
                            onCheckedChange={checked => {
                              setSelectedCapabilityGroups(current =>
                                checked
                                  ? Array.from(new Set([...current, group.id]))
                                  : current.filter(id => id !== group.id)
                              )
                            }}
                          />
                          <span>
                            <span className="flex flex-wrap items-center gap-2 font-semibold">
                              {group.label}
                              <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[0.6875rem] font-medium text-slate-600">
                                {skills.length} skills
                              </span>
                            </span>
                            <span className="mt-2 block leading-5 text-slate-600">{group.description}</span>
                            {skills.length > 0 && (
                              <span className="mt-2 block text-xs text-slate-500">
                                Includes: {skills.slice(0, 5).join(', ')}
                                {skills.length > 5 ? `, +${skills.length - 5} more` : ''}
                              </span>
                            )}
                          </span>
                        </label>
                      )
                    })}
                  </div>
                </div>
              </section>
            )}

            {step === 'terms' && (
              <section>
                <StepHeading
                  icon={<CheckCircle2 />}
                  title="Terms, credits, and AI disclaimer"
                  description="Please review and accept these mandatory notices before using LexEdge Legal Hermes Agent for legal work."
                />
                <PrivacySafetyNote />

                <div className="mt-8 grid gap-5 lg:grid-cols-2">
                  <div className="rounded-[6px] border-2 border-amber-400 bg-amber-50 p-6 shadow-sm">
                    <div className="text-xl font-semibold text-amber-950">Terms and conditions</div>
                    <div className="mt-2 text-sm font-medium text-amber-800">Required before using LexEdge for legal work</div>
                    <p className="mt-3 text-sm leading-6 text-slate-700">
                      LexEdge Legal Hermes Agent is provided as-is and as available, without warranties of any
                      kind, express or implied. LexEdge AI Labs Private Limited does not warrant that outputs will be
                      complete, accurate, current, legally sufficient, uninterrupted, or error-free.
                    </p>
                    <p className="mt-3 text-sm leading-6 text-slate-700">
                      You remain responsible for professional judgment, client confidentiality, legal compliance,
                      court rules, limitation periods, filing requirements, and every document, message, submission,
                      or advice issued from your practice.
                    </p>
                  </div>

                  <div className="rounded-[6px] border border-slate-200 bg-white p-5">
                    <div className="text-base font-semibold">Copyright and open-source credit</div>
                    <p className="mt-3 text-sm leading-6 text-slate-700">
                      LexEdge Legal Hermes Agent is a customized and secured legal workflow build by LexEdge AI Labs
                      Private Limited. LexEdge claims copyright only in its LexEdge-specific branding, legal workflow
                      customizations, security hardening, configuration, documentation, and distribution-specific
                      additions.
                    </p>
                    <p className="mt-3 text-sm leading-6 text-slate-700">
                      Full credit for the original Hermes Agent project, architecture, and upstream source belongs to
                      the original Hermes Agent authors and contributors. Upstream Hermes Agent copyright, license
                      notices, and attribution remain preserved and are not claimed by LexEdge.
                    </p>
                    <a
                      className="mt-3 inline-flex text-sm font-medium text-primary hover:underline"
                      href="https://www.lexedge.ai"
                      rel="noreferrer"
                      target="_blank"
                    >
                      www.lexedge.ai
                    </a>
                  </div>

                  <div className="rounded-[6px] border border-slate-200 bg-white p-5">
                    <div className="text-base font-semibold">AI and legal-use disclaimer</div>
                    <p className="mt-3 text-sm leading-6 text-slate-700">
                      AI-generated content may be incorrect, incomplete, outdated, or unsuitable for a specific
                      matter. It must not be treated as a substitute for a qualified lawyer's independent review,
                      legal research, factual verification, or professional judgment.
                    </p>
                    <p className="mt-3 text-sm leading-6 text-slate-700">
                      Always review and verify all drafts, citations, dates, calculations, legal positions, and
                      factual statements before making any judgment, advising a client, sending a message, filing a
                      case, or submitting anything to a court, tribunal, regulator, tax authority, police authority,
                      or any other public authority.
                    </p>
                  </div>

                  <div className="rounded-[6px] border border-slate-200 bg-white p-5">
                    <div className="text-base font-semibold">Privacy and local data</div>
                    <p className="mt-3 text-sm leading-6 text-slate-700">
                      Onboarding details, practice profile data, skill selections, local database records, and app
                      settings are stored on this computer. LexEdge does not send this setup data to a LexEdge cloud.
                    </p>
                    <p className="mt-3 text-sm leading-6 text-slate-700">
                      The only external service that may receive prompts, documents, or matter content is the AI/LLM
                      provider you configure, and only when you ask the assistant to process that content.
                    </p>
                  </div>
                </div>

                <label className="mt-6 flex items-start gap-3 rounded-[6px] border border-slate-200 bg-white p-4 text-sm leading-6">
                  <Checkbox
                    checked={termsAccepted}
                    className="mt-1"
                    disabled={busy}
                    onCheckedChange={checked => setTermsAccepted(Boolean(checked))}
                  />
                  I accept the terms and conditions, including that LexEdge Legal Hermes Agent is provided as-is
                  and without warranty.
                </label>

                <label className="mt-3 flex items-start gap-3 rounded-[6px] border border-slate-200 bg-white p-4 text-sm leading-6">
                  <Checkbox
                    checked={copyrightAccepted}
                    className="mt-1"
                    disabled={busy}
                    onCheckedChange={checked => setCopyrightAccepted(Boolean(checked))}
                  />
                  I acknowledge that LexEdge Legal Hermes Agent is customized and secured by LexEdge AI Labs Private
                  Limited, and that full credit, copyright, and license attribution for the original Hermes Agent
                  remain with the original Hermes Agent authors and contributors.
                </label>

                <label className="mt-3 flex items-start gap-3 rounded-[6px] border border-slate-200 bg-white p-4 text-sm leading-6">
                  <Checkbox
                    checked={aiDisclaimerAccepted}
                    className="mt-1"
                    disabled={busy}
                    onCheckedChange={checked => setAiDisclaimerAccepted(Boolean(checked))}
                  />
                  I understand that AI outputs require human legal review before any judgment, advice, filing,
                  service, communication, or submission to any authority.
                </label>
              </section>
            )}

            {step === 'finish' && (
              <section>
                <StepHeading
                  icon={<MessageCircle />}
                  title="Welcome to LexEdge Legal Hermes Agent"
                  description="Your workspace is ready. Open the assistant and start with a clear legal task, document, or question."
                />
                <PrivacySafetyNote />

                <div className="mt-8 grid gap-4 lg:grid-cols-3">
                  <GuideCard
                    title="Bring the matter"
                    text="Paste facts, upload a document, or describe the stage of the case. Add dates, parties, notices, orders, and deadlines when available."
                  />
                  <GuideCard
                    title="Ask for a draft"
                    text="Request a notice, reply, summary, chronology, hearing note, client update, email draft, or checklist."
                  />
                  <GuideCard
                    title="Review before use"
                    text="Verify facts, law, citations, limitation, and strategy before sending, filing, advising, or submitting anything."
                  />
                </div>

                <div className="mt-8 rounded-[6px] border border-slate-200 bg-white p-5">
                  <div className="text-base font-semibold">Example first requests</div>
                  <div className="mt-4 grid gap-3 text-sm leading-6 text-slate-700 lg:grid-cols-2">
                    <div>Draft a client update from this hearing order and list next steps.</div>
                    <div>Review this agreement and flag high-risk clauses under Indian law.</div>
                    <div>Prepare a GST show-cause notice reply checklist from this PDF.</div>
                    <div>Create a chronology and issue list from these pleadings.</div>
                  </div>
                </div>

                <div className="mt-8 grid gap-4 lg:grid-cols-3">
                  <OptionalCard title="Gmail" text="Connect later for matter intake and draft email replies." />
                  <OptionalCard title="WhatsApp" text="Connect later by scanning QR for client updates and approvals." />
                  <OptionalCard title="Templates" text="Add firm templates later for notices, replies, and applications." />
                </div>
              </section>
            )}

            {(error || message) && (
              <div className="mt-8">
                <StatusAlert error={error} message={message} />
              </div>
            )}
          </div>
        </div>

        <footer className="flex items-center justify-between border-t border-(--ui-stroke-secondary) px-6 py-4 lg:px-10">
          <Button
            disabled={busy || step === 'practice'}
            onClick={() => {
              setError(null)
              const previous = stepOrder[Math.max(0, currentStepIndex - 1)]
              setStep(previous)
            }}
            variant="secondary"
          >
            Back
          </Button>
          <Button
            disabled={busy || (step === 'model' && !modelReady)}
            onClick={() => {
              if (step === 'practice') {
                void savePracticeWorkspace()
              } else if (step === 'model') {
                void saveAndTestModel()
              } else if (step === 'profile') {
                void savePracticeProfile()
              } else if (step === 'skills') {
                void saveSkillSelection()
              } else if (step === 'terms') {
                void acceptSafety()
              } else {
                void finish()
              }
            }}
            size="lg"
          >
            {busy ? <Loader2 className="animate-spin" /> : null}
            {step === 'finish'
              ? 'Open LexEdge Legal Hermes Agent'
              : step === 'model'
                ? 'Test and continue'
                : step === 'skills'
                  ? 'Create practice profile'
                : 'Continue'}
          </Button>
        </footer>
      </main>
    </div>
  )
}

function StepHeading({
  description,
  icon,
  title
}: {
  description: string
  icon: ReactNode
  title: string
}) {
  return (
    <div className="max-w-3xl">
      <div className="flex size-10 items-center justify-center rounded-[6px] bg-primary/10 text-primary">{icon}</div>
      <h2 className="mt-5 text-3xl leading-10 font-semibold">{title}</h2>
      <p className="mt-3 text-base leading-7 text-(--ui-text-secondary)">{description}</p>
    </div>
  )
}

function PrivacySafetyNote() {
  return (
    <div className="mt-5 rounded-[6px] border border-blue-200 bg-blue-50/70 p-4 text-sm leading-6 text-slate-700">
      <span className="font-semibold text-slate-900">Privacy and safety:</span> Setup data, practice profiles,
      skill selections, and local database records stay private on this machine. Nothing is sent to any cloud except
      the AI/LLM provider you configure, and only when the assistant needs that provider to process your request.
    </div>
  )
}

function StatusAlert({ error, message }: { error: string | null; message: string | null }) {
  return (
    <div
      className={cn(
        'rounded-[6px] border px-4 py-3 text-sm shadow-sm',
        error
          ? 'border-red-300 bg-red-50 text-red-700'
          : 'border-(--ui-stroke-secondary) bg-white text-(--ui-text-secondary)'
      )}
    >
      {error ?? message}
    </div>
  )
}

function SelectField({
  label,
  onChange,
  options,
  value
}: {
  label: string
  onChange: (value: string) => void
  options: string[]
  value: string
}) {
  const rows = Array.from(new Set(value ? [...options, value] : options))
  return (
    <label className="block text-sm font-medium">
      {label}
      <select
        className="mt-2 h-10 w-full rounded-[6px] border border-slate-200 bg-white px-3 text-sm"
        onChange={event => onChange(event.target.value)}
        value={value}
      >
        <option value="">Select</option>
        {rows.map(option => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
    </label>
  )
}

function MultiCheckGroup({
  grouped = false,
  label,
  onChange,
  options,
  value
}: {
  grouped?: boolean
  label: string
  onChange: (value: string[]) => void
  options: Record<string, string[]> | string[]
  value: string[]
}) {
  const groups = grouped && !Array.isArray(options) ? options : { Options: Array.isArray(options) ? options : [] }
  return (
    <div className="rounded-[6px] border border-slate-200 bg-white p-5">
      <div className="text-base font-semibold">{label}</div>
      <div className="mt-4 grid max-h-64 gap-3 overflow-auto pr-1">
        {Object.entries(groups).map(([group, rows]) => (
          <div key={group}>
            {group !== 'Options' && <div className="mb-2 text-xs font-semibold uppercase text-slate-500">{group}</div>}
            <div className="grid gap-2">
              {rows.map(option => {
                const checked = value.includes(option)
                return (
                  <label className="flex items-start gap-2 text-sm leading-5" key={option}>
                    <Checkbox
                      checked={checked}
                      className="mt-0.5"
                      onCheckedChange={next =>
                        onChange(next ? Array.from(new Set([...value, option])) : value.filter(item => item !== option))
                      }
                    />
                    {option}
                  </label>
                )
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

function OptionalCard({ text, title }: { text: string; title: string }) {
  return (
    <div className="rounded-[6px] border border-(--ui-stroke-secondary) p-4">
      <div className="text-sm font-semibold">{title}</div>
      <p className="mt-2 text-sm leading-6 text-(--ui-text-secondary)">{text}</p>
      <div className="mt-3 text-xs font-medium text-(--ui-text-tertiary)">Optional after setup</div>
    </div>
  )
}

function GuideCard({ text, title }: { text: string; title: string }) {
  return (
    <div className="rounded-[6px] border border-slate-200 bg-white p-5">
      <div className="text-base font-semibold">{title}</div>
      <p className="mt-3 text-sm leading-6 text-slate-700">{text}</p>
    </div>
  )
}
