import type { ReactNode } from 'react'
import { useEffect, useMemo, useState } from 'react'

import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import {
  completeOnboarding,
  createProfile,
  getGlobalModelOptions,
  getOnboardingStatus,
  getPracticeRoleSoulTemplate,
  getRecommendedDefaultModel,
  setEnvVar,
  setGlobalModel,
  updateOnboardingStep,
  updateProfileSoul,
  validateProviderCredential
} from '@/hermes'
import { CheckCircle2, KeyRound, Loader2, MessageCircle, Users } from '@/lib/icons'
import { cn } from '@/lib/utils'
import { ensureGatewayProfile } from '@/store/profile'
import type { ModelOptionProvider, OnboardingStatus } from '@/types/hermes'

const PROFILE_NAME_RE = /^[a-z0-9][a-z0-9_-]{0,63}$/

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

type WizardStep = 'practice' | 'model' | 'terms' | 'finish'
const assetPath = (path: string) => `${import.meta.env.BASE_URL}${path.replace(/^\/+/, '')}`

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

function providerHint(provider: ModelOptionProvider): string {
  const common = PROVIDER_CHOICES.find(choice => choice.match.test(provider.slug) || choice.match.test(provider.name))
  if (common) {
    return common.hint
  }
  if (provider.authenticated) {
    return 'Already connected in Hermes.'
  }
  if (provider.auth_type === 'api_key' && provider.key_env) {
    return `Paste ${provider.key_env} to connect this provider.`
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
  return Boolean(provider.key_env && apiKey.trim())
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
  const [step, setStep] = useState<WizardStep>('practice')
  const [practiceRole, setPracticeRole] = useState('litigation-lawyer')
  const [profileName, setProfileName] = useState('litigation')
  const [soul, setSoul] = useState('')
  const [providers, setProviders] = useState<ModelOptionProvider[]>([])
  const [providerSlug, setProviderSlug] = useState('')
  const [apiKey, setApiKey] = useState('')
  const [termsAccepted, setTermsAccepted] = useState(false)
  const [aiDisclaimerAccepted, setAiDisclaimerAccepted] = useState(false)
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
        const aConnectable = a.authenticated || (a.auth_type === 'api_key' && a.key_env)
        const bConnectable = b.authenticated || (b.auth_type === 'api_key' && b.key_env)
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
    getOnboardingStatus()
      .then(next => {
        if (cancelled) {
          return
        }
        setStatus(next)
        setVisible(!next.completed)
        if (next.profile_name) {
          setProfileName(next.profile_name === 'default' ? 'litigation' : next.profile_name)
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
              sorted.find(provider => provider.authenticated || (provider.auth_type === 'api_key' && provider.key_env)) ??
              sorted[0]
            return preferred?.slug ?? ''
          })
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

  if (!enabled || !visible) {
    return null
  }

  const trimmedProfileName = normaliseProfileName(profileName)
  const profileNameInvalid = !trimmedProfileName || !PROFILE_NAME_RE.test(trimmedProfileName)
  const modelReady = providerReady(selectedProvider, apiKey)
  const currentStepIndex = ['practice', 'model', 'terms', 'finish'].indexOf(step)

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

    setBusy(true)
    setError(null)
    setMessage('Creating your legal workspace...')
    try {
      const existing = status?.profiles.find(profile => profile.name === trimmedProfileName)
      if (!existing) {
        await createProfile({
          name: trimmedProfileName,
          clone_from: 'default',
          practice_role: practiceRole
        })
      } else if (!existing.practice_role) {
        throw new Error('A workspace with this name already exists. Choose another name for the legal workspace.')
      }
      if (soul.trim()) {
        await updateProfileSoul(trimmedProfileName, soul)
      }
      await updateOnboardingStep('profile_name', trimmedProfileName)
      await updateOnboardingStep('practice_workspace', true)
      await ensureGatewayProfile(trimmedProfileName)
      await refreshStatus()
      setStep('model')
      setMessage(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create the workspace.')
    } finally {
      setBusy(false)
    }
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
      await ensureGatewayProfile(trimmedProfileName)

      if (!selectedProvider.authenticated) {
        if (!selectedProvider.key_env) {
          throw new Error(`${selectedProvider.name} cannot be configured with an API key here.`)
        }
        const probe = await validateProviderCredential(selectedProvider.key_env, apiKey.trim(), apiKey.trim())
        if (!probe.ok) {
          throw new Error(probe.message || 'The API key could not be verified.')
        }
        await setEnvVar(selectedProvider.key_env, apiKey.trim())
      }

      const refreshed = await getGlobalModelOptions({ refresh: true })
      const provider =
        refreshed.providers?.find(item => item.slug === selectedProvider.slug) ??
        selectedProvider
      const recommendation = await getRecommendedDefaultModel(provider.slug)
      await setGlobalModel(recommendation.provider, recommendation.model)
      await updateOnboardingStep('ai_model', true)
      await updateOnboardingStep('model_test', true)
      await refreshStatus()
      setApiKey('')
      setStep('terms')
      setMessage(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'The AI service test failed.')
    } finally {
      setBusy(false)
    }
  }

  async function acceptSafety() {
    if (!termsAccepted || !aiDisclaimerAccepted) {
      setError('Accept the terms and AI disclaimer before continuing.')
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
            <div className="text-sm font-semibold">Personal AI Assistant</div>
          </div>
        </div>
        <h1 className="mt-7 text-2xl leading-8 font-semibold">LexEdge Personal AI Assistant setup</h1>
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
                    LexEdge Personal AI Assistant
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
          <div className="mx-auto max-w-5xl">
            {step === 'practice' && (
              <section>
                <StepHeading
                  icon={<Users />}
                  title="Create your practice workspace"
                  description="Choose the closest practice type. LexEdge Personal AI Assistant will create a separate workspace with the right legal skills, defaults, and safeguards."
                />
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
                <div className="mt-8 grid max-h-[25rem] gap-3 overflow-auto pr-1 lg:grid-cols-3">
                  {providerRows.map(provider => {
                    const selected = provider.slug === selectedProvider?.slug
                    const connected = Boolean(provider.authenticated)
                    const connectable = connected || (provider.auth_type === 'api_key' && provider.key_env)
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
                    disabled={busy || Boolean(selectedProvider?.authenticated) || !selectedProvider?.key_env}
                    id="lexedge-api-key"
                    onChange={event => setApiKey(event.target.value)}
                    placeholder={
                      selectedProvider?.authenticated
                        ? 'Already connected'
                        : selectedProvider?.key_env
                          ? selectedProvider.key_env
                          : 'Advanced setup required'
                    }
                    type="password"
                    value={apiKey}
                  />
                  <p className="mt-2 text-sm leading-6 text-(--ui-text-secondary)">
                    {selectedProvider?.authenticated
                      ? 'This AI service is already connected. Continue to run the model test.'
                      : selectedProvider?.key_env
                        ? `This saves ${selectedProvider.key_env} locally on this computer.`
                        : 'This provider is supported by Hermes but needs its own advanced setup. Pick an API-key provider to finish onboarding here.'}
                  </p>
                </div>
              </section>
            )}

            {step === 'terms' && (
              <section>
                <StepHeading
                  icon={<CheckCircle2 />}
                  title="Terms and AI disclaimer"
                  description="Please review and accept these mandatory terms before using LexEdge Personal AI Assistant for legal work."
                />

                <div className="mt-8 grid gap-5 lg:grid-cols-2">
                  <div className="rounded-[6px] border border-slate-200 bg-white p-5">
                    <div className="text-base font-semibold">Terms and conditions</div>
                    <p className="mt-3 text-sm leading-6 text-slate-700">
                      LexEdge Personal AI Assistant is provided as-is and as available, without warranties of any
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
                </div>

                <label className="mt-6 flex items-start gap-3 rounded-[6px] border border-slate-200 bg-white p-4 text-sm leading-6">
                  <Checkbox
                    checked={termsAccepted}
                    className="mt-1"
                    disabled={busy}
                    onCheckedChange={checked => setTermsAccepted(Boolean(checked))}
                  />
                  I accept the terms and conditions, including that LexEdge Personal AI Assistant is provided as-is
                  and without warranty.
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
                  title="Welcome to LexEdge Personal AI Assistant"
                  description="Your workspace is ready. Open the assistant and start with a clear legal task, document, or question."
                />

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
              <div
                className={cn(
                  'mt-8 rounded-[6px] border px-4 py-3 text-sm',
                  error
                    ? 'border-red-300 bg-red-50 text-red-700'
                    : 'border-(--ui-stroke-secondary) bg-(--ui-bg-secondary) text-(--ui-text-secondary)'
                )}
              >
                {error ?? message}
              </div>
            )}
          </div>
        </div>

        <footer className="flex items-center justify-between border-t border-(--ui-stroke-secondary) px-6 py-4 lg:px-10">
          <Button
            disabled={busy || step === 'practice'}
            onClick={() => {
              setError(null)
              setStep(
                step === 'model'
                  ? 'practice'
                  : step === 'terms'
                    ? 'model'
                    : 'terms'
              )
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
              ? 'Open LexEdge Personal AI Assistant'
              : step === 'model'
                ? 'Test and continue'
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
