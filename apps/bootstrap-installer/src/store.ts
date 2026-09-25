import { atom, computed } from 'nanostores'
import { listen, type UnlistenFn } from '@tauri-apps/api/event'
import { open } from '@tauri-apps/plugin-dialog'
import { invoke } from '@tauri-apps/api/core'

/*
 * Bootstrap state store — single source of truth for installer screens.
 *
 * Lives in nanostores per the project's TypeScript guidelines (apps/desktop
 * AGENTS.md): "Prefer small nanostores over component state when state is
 * shared, reused, or read by distant UI."
 *
 * One channel from Rust ('bootstrap' event), discriminated by payload.type.
 * We translate those events into typed atom updates here so the rest of
 * the app only deals with React-friendly state.
 */

// ---------------------------------------------------------------------------
// Types — mirror src-tauri/src/events.rs
// ---------------------------------------------------------------------------

export interface StageInfo {
  name: string
  title: string
  category: string
  needs_user_input: boolean
}

export type StageState = 'running' | 'succeeded' | 'skipped' | 'failed'

export interface StageRecord {
  info: StageInfo
  state: StageState | null
  durationMs?: number
  error?: string
}

export interface BootstrapStateModel {
  status: 'idle' | 'running' | 'completed' | 'failed'
  protocolVersion: number | null
  stages: Record<string, StageRecord>
  stageOrder: string[]
  currentStage: string | null
  installRoot: string | null
  error: string | null
  logs: Array<{ stage?: string; line: string; stream?: 'stdout' | 'stderr' }>
}

const INITIAL: BootstrapStateModel = {
  status: 'idle',
  protocolVersion: null,
  stages: {},
  stageOrder: [],
  currentStage: null,
  installRoot: null,
  error: null,
  logs: []
}

// ---------------------------------------------------------------------------
// Atoms
// ---------------------------------------------------------------------------

export type Route =
  | 'welcome'
  | 'privacy'
  | 'analysis'
  | 'progress'
  | 'provision'
  | 'success'
  | 'failure'

/// Whether the user opted into local inference. 'undecided' is the only state
/// in which the installer has not yet been told what to do; it must never be
/// resolved on the user's behalf.
export type PrivateAiChoice = 'undecided' | 'private' | 'cloud'

/// How the installer was launched, mirrored from src-tauri AppMode.
/// 'install' = first-run onboarding (bare launch). 'update' = driven by the
/// desktop app handing off via the staged `hermes-setup.exe --update`.
export type AppMode = 'install' | 'update'

export const $route = atom<Route>('welcome')
export const $mode = atom<AppMode>('install')
export const $bootstrap = atom<BootstrapStateModel>(INITIAL)
export const $logPath = atom<string | null>(null)
export const $hermesHome = atom<string | null>(null)
export const $privateAiChoice = atom<PrivateAiChoice>('undecided')
export const $analysis = atom<PrivateAiAnalysis | null>(null)
export const $analysisError = atom<string | null>(null)
export const $analysisPending = atom<boolean>(false)
/// The profile the user has chosen. Defaults to the recommendation, but the
/// installer never substitutes it silently afterwards.
export const $selectedProfileId = atom<string | null>(null)

export const $progress = computed($bootstrap, (b) => {
  const total = b.stageOrder.length
  if (total === 0) return { done: 0, total: 0, fraction: 0 }
  let done = 0
  for (const name of b.stageOrder) {
    const s = b.stages[name]?.state
    if (s === 'succeeded' || s === 'skipped' || s === 'failed') done += 1
  }
  return { done, total, fraction: done / total }
})

// ---------------------------------------------------------------------------
// Private AI — mirrors src-tauri/src/private_ai_flow.rs
// ---------------------------------------------------------------------------

export interface ModelRecommendation {
  profileId: string
  friendlyName: string
  ollamaModel: string
  fit: string
  executionMode: string
  quantization: string | null
  estimatedTokensPerSecond: number | null
  estimatedMemoryGb: number | null
  /** Catalogue requirements, always present — unlike the estimates above,
   *  which depend on a fit report that production builds do not produce. */
  minimumRamGb: number
  recommendedRamGb: number
  targetTokensPerSecond: number
  downloadSizeGb: number
  operationalContextTokens: number
  recommended: boolean
  reasons: string[]
  warnings: string[]
}

export interface ExcludedProfile {
  profileId: string
  friendlyName: string
  reasons: string[]
}

export interface PrivateAiAnalysis {
  hardware: {
    os: { name: string; version: string; arch: string }
    cpu: { model: string; physicalCores: number; logicalCores: number }
    memory: { totalGb: number; availableGb: number }
    gpus: Array<{ vendor: string; model: string; dedicatedVramGb: number; backend: string | null }>
    storage: Array<{ volume: string; freeGb: number }>
    existingRuntime: {
      found: boolean
      version: string | null
      port: number | null
      managedByProduct: boolean
      models: DetectedModel[]
      scanNote: string | null
    }
  }
  recommendation: {
    compatible: ModelRecommendation[]
    excluded: ExcludedProfile[]
    usedConservativeFallback: boolean
  }
  catalogueId: string
  catalogueVersion: string
  embeddingModel: string
  embeddingDimensions: number
  totalDownloadGb: number
  embeddingDownloadGb: number
  freeDiskGb: number
  usedConservativeFallback: boolean
  reusableModels: ReuseCandidate[]
}

/// A model found in an Ollama the user installed themselves.
export interface DetectedModel {
  tag: string
  digest: string
  sizeBytes: number
  contextLength: number | null
  supportsTools: boolean
  capabilitiesKnown: boolean
  describeError: string | null
}

/// Whether one installed model can stand in for a catalogue profile. Carries
/// the grounds either way — a rejection the user cannot understand reads as a
/// bug, and "you already have this but we downloaded it anyway" is the exact
/// complaint this feature exists to prevent.
export interface ReuseCandidate {
  tag: string
  profileId: string | null
  friendlyName: string | null
  reusable: boolean
  sizeBytes: number
  reasons: string[]
}

// ---------------------------------------------------------------------------
// Private AI provisioning — mirrors src-tauri/src/provision.rs
// ---------------------------------------------------------------------------

export type ProvisionStageState = 'running' | 'succeeded' | 'skipped' | 'failed'

export interface ProvisionStage {
  name: string
  title: string
  state: ProvisionStageState | null
  detail?: string
  error?: string
}

export interface ValidationCheck {
  id: string
  title: string
  status: 'passed' | 'failed' | 'skipped'
  detail: string
}

export interface ValidationReport {
  passed: boolean
  checks: ValidationCheck[]
  metrics: {
    runtimeStartupMs: number | null
    modelLoadMs: number | null
    timeToFirstTokenMs: number | null
    tokensPerSecond: number | null
    embeddingLatencyMs: number | null
    executionMode: string | null
  }
  warnings: string[]
  suggestedSmallerProfile: string | null
  selectedGenerationModel: string
  selectedEmbeddingModel: string
}

export interface RuntimeConfigSummary {
  ollama: { baseUrl: string; runtimeVersion: string }
  models: { profileId: string; generation: string; embedding: string; contextTokens: number }
}

export interface ProvisionModel {
  status: 'idle' | 'running' | 'completed' | 'failed' | 'cancelled'
  stages: Record<string, ProvisionStage>
  stageOrder: string[]
  currentStage: string | null
  progress: Record<string, { fraction: number; detail: string }>
  error: string | null
  report: ValidationReport | null
  config: RuntimeConfigSummary | null
}

/// True from the moment Cancel is pressed until provisioning actually stops.
/// Separate from ProvisionModel.status because it describes a pending request,
/// not a state the backend has confirmed.
export const $provisionCancelling = atom<boolean>(false)

const PROVISION_INITIAL: ProvisionModel = {
  status: 'idle',
  stages: {},
  stageOrder: [],
  currentStage: null,
  progress: {},
  error: null,
  report: null,
  config: null
}

export const $provision = atom<ProvisionModel>(PROVISION_INITIAL)

type PrivateAiEvent =
  | { type: 'manifest'; stages: Array<{ name: string; title: string }> }
  | { type: 'stage'; name: string; state: ProvisionStageState; detail?: string; error?: string }
  | { type: 'progress'; stage: string; fraction: number; detail: string }
  | { type: 'complete'; report: ValidationReport; config: RuntimeConfigSummary }
  | { type: 'failed'; stage?: string; error: string; resumable: boolean }

let unlistenPrivateAi: UnlistenFn | null = null

async function subscribePrivateAi(): Promise<void> {
  if (unlistenPrivateAi) return
  unlistenPrivateAi = await listen<PrivateAiEvent>('private-ai', (event) => {
    const payload = event.payload
    const cur = $provision.get()
    switch (payload.type) {
      case 'manifest': {
        const stages: Record<string, ProvisionStage> = {}
        const order: string[] = []
        for (const s of payload.stages) {
          stages[s.name] = { name: s.name, title: s.title, state: null }
          order.push(s.name)
        }
        $provisionCancelling.set(false)
        $provision.set({ ...PROVISION_INITIAL, status: 'running', stages, stageOrder: order })
        break
      }
      case 'stage': {
        const existing = cur.stages[payload.name]
        if (!existing) break
        $provision.set({
          ...cur,
          stages: {
            ...cur.stages,
            [payload.name]: { ...existing, state: payload.state, detail: payload.detail, error: payload.error }
          },
          currentStage: payload.state === 'running' ? payload.name : cur.currentStage
        })
        break
      }
      case 'progress':
        $provision.set({
          ...cur,
          progress: { ...cur.progress, [payload.stage]: { fraction: payload.fraction, detail: payload.detail } }
        })
        break
      case 'complete':
        $provision.set({ ...cur, status: 'completed', currentStage: null, report: payload.report, config: payload.config })
        break
      case 'failed': {
        const cancelled = /cancelled/i.test(payload.error)
        $provision.set({ ...cur, status: cancelled ? 'cancelled' : 'failed', currentStage: null, error: payload.error })
        break
      }
    }
  })
}

// ---------------------------------------------------------------------------
// Tauri event subscription
// ---------------------------------------------------------------------------

interface BootstrapManifestEvent {
  type: 'manifest'
  stages: StageInfo[]
  protocolVersion: number | null
}

interface BootstrapStageEvent {
  type: 'stage'
  name: string
  state: StageState
  durationMs?: number
  error?: string
}

interface BootstrapLogEvent {
  type: 'log'
  stage?: string
  line: string
  stream?: 'stdout' | 'stderr'
}

interface BootstrapCompleteEvent {
  type: 'complete'
  installRoot: string
  marker: unknown
}

interface BootstrapFailedEvent {
  type: 'failed'
  stage?: string
  error: string
}

type BootstrapEvent =
  | BootstrapManifestEvent
  | BootstrapStageEvent
  | BootstrapLogEvent
  | BootstrapCompleteEvent
  | BootstrapFailedEvent

let unlisten: UnlistenFn | null = null

export async function initialize(): Promise<void> {
  if (unlisten) return

  // Pull static info on mount for the diagnostics footer.
  try {
    const [logPath, hermesHome, mode] = await Promise.all([
      invoke<string>('get_log_path'),
      invoke<string>('get_hermes_home'),
      invoke<AppMode>('get_mode')
    ])
    $logPath.set(logPath)
    $hermesHome.set(hermesHome)
    $mode.set(mode)
  } catch (err) {
    console.warn('failed to fetch installer paths', err)
  }

  await subscribePrivateAi()

  unlisten = await listen<BootstrapEvent>('bootstrap', (event) => {
    const payload = event.payload
    const cur = $bootstrap.get()
    switch (payload.type) {
      case 'manifest': {
        const stages: Record<string, StageRecord> = {}
        const order: string[] = []
        for (const s of payload.stages) {
          stages[s.name] = { info: s, state: null }
          order.push(s.name)
        }
        $bootstrap.set({
          ...cur,
          status: 'running',
          protocolVersion: payload.protocolVersion,
          stages,
          stageOrder: order,
          currentStage: null,
          installRoot: null,
          error: null,
          logs: []
        })
        $installCancelling.set(false)
  $route.set('progress')
        break
      }
      case 'stage': {
        const existing = cur.stages[payload.name]
        if (!existing) {
          console.warn('stage event for unknown stage', payload.name)
          break
        }
        const next: StageRecord = {
          ...existing,
          state: payload.state,
          durationMs: payload.durationMs,
          error: payload.error
        }
        $bootstrap.set({
          ...cur,
          stages: { ...cur.stages, [payload.name]: next },
          currentStage:
            payload.state === 'running' ? payload.name : cur.currentStage
        })
        break
      }
      case 'log': {
        const logs = [...cur.logs, { stage: payload.stage, line: payload.line, stream: payload.stream }]
        // Keep the rolling buffer bounded so the UI doesn't get OOM'd
        // during a long install (playwright chromium download is ~10k lines).
        const trimmed = logs.length > 2000 ? logs.slice(-2000) : logs
        $bootstrap.set({ ...cur, logs: trimmed })
        break
      }
      case 'complete':
        $bootstrap.set({
          ...cur,
          status: 'completed',
          installRoot: payload.installRoot,
          currentStage: null
        })
        // Install: show the "launch Hermes" success screen. Update: this is a
        // hand-off — the installer relaunches the desktop and exits within a
        // few hundred ms, so routing to success just flashes that screen
        // before the window closes. Stay on progress until we exit.
        //
        // Private AI is additive: it starts only after the base install has
        // succeeded, so a Private AI failure can never take the base install
        // down with it.
        if ($mode.get() !== 'update') {
          const profileId = $selectedProfileId.get()
          if ($privateAiChoice.get() === 'private' && profileId) {
            $route.set('provision')
            void startProvisioning(profileId)
          } else {
            $route.set('success')
          }
        }
        break
      case 'failed':
        $bootstrap.set({
          ...cur,
          status: 'failed',
          error: payload.error,
          currentStage: null
        })
        $route.set('failure')
        break
    }
  })

  // Update mode is a hand-off, not a user-initiated flow: the desktop already
  // exited and re-launched us as `--update`. Kick the update immediately so
  // the user lands on progress, not a redundant "click to update" screen.
  if ($mode.get() === 'update') {
    void startUpdate()
  }
}

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

export async function startInstall(opts?: { branch?: string }): Promise<void> {
  // Reset before kicking off so a retry from the failure screen clears
  // the previous run's state.
  $bootstrap.set(INITIAL)
  $installCancelling.set(false)
  $route.set('progress')
  await invoke('start_bootstrap', {
    args: {
      commit: null,
      branch: opts?.branch ?? null,
      include_desktop: true,
      // A folder the user chose to keep an existing install intact. Null is
      // the default location, which is the ordinary case.
      hermes_home: $alternateHome.get()
    }
  })
}

export async function startUpdate(): Promise<void> {
  // Update is driven by the desktop handing off (hermes-setup.exe --update);
  // there's no welcome click. Reset + jump straight to progress, then let the
  // Rust side stream the synthetic update manifest.
  $bootstrap.set(INITIAL)
  $installCancelling.set(false)
  $route.set('progress')
  await invoke('start_update')
}

/// True from the moment Cancel is pressed on the base install until it stops.
///
/// The backend does honour cancellation — it is checked between stages and
/// each stage is given a cancel receiver — but a stage already running (a
/// dependency install, a desktop build) has to reach a safe point first. With
/// no local state the screen did not change at all on click, so the button
/// read as broken and was reported as such.
export const $installCancelling = atom<boolean>(false)

export async function cancelInstall(): Promise<void> {
  if ($installCancelling.get()) return
  $installCancelling.set(true)
  try {
    await invoke('cancel_bootstrap')
  } catch (error) {
    // Nothing is stopping, so release the flag rather than leaving the button
    // dead for the rest of the run.
    $installCancelling.set(false)
    throw error
  }
}

export async function launchHermesDesktop(): Promise<void> {
  const installRoot = $bootstrap.get().installRoot
  if (!installRoot) throw new Error('no install root')
  await invoke('launch_hermes_desktop', { installRoot })
}

export async function openLogDir(): Promise<void> {
  await invoke('open_log_dir')
}

// ---------------------------------------------------------------------------
// Private AI actions
// ---------------------------------------------------------------------------

/// Move from Welcome into the Private AI explanation. Nothing is installed and
/// nothing is detected until the user has read what local inference means.
export interface ExistingInstall {
  found: boolean
  hermesHome: string
  installRoot: string | null
}

/// What is already installed at the default location, and where.
export const $existingInstall = atom<ExistingInstall | null>(null)

/// A user-chosen Hermes home, set when someone opts to install alongside an
/// existing copy rather than over it. Null means the default location.
export const $alternateHome = atom<string | null>(null)

/// Check for an existing install before anything is written.
///
/// Installing over an existing setup silently replaces its configuration and
/// matter metadata. The user is told and offered a separate folder, so a
/// working install is never destroyed by someone simply running setup again.
export async function checkExistingInstall(): Promise<void> {
  try {
    $existingInstall.set(await invoke<ExistingInstall>('detect_existing_install'))
  } catch {
    // A failed probe must not block setup: the worst case is the behaviour
    // that shipped before this check existed.
    $existingInstall.set(null)
  }
}

/// Choose a different Hermes home so both installs can coexist.
export async function chooseAlternateHome(): Promise<void> {
  const picked = await open({ directory: true, multiple: false, title: 'Choose a folder for this install' })
  if (typeof picked === 'string' && picked.trim()) {
    $alternateHome.set(picked)
  }
}

export function beginPrivateAiChoice(): void {
  $privateAiChoice.set('undecided')
  $analysisError.set(null)
  $route.set('privacy')
}

/// Step back from the Private AI explanation to Welcome. Pure navigation: at
/// this point nothing has been detected, downloaded or written, so there is
/// no state to unwind beyond the undecided choice itself.
export function backToWelcome(): void {
  $privateAiChoice.set('undecided')
  $analysisError.set(null)
  $route.set('welcome')
}

/// Step back from the hardware analysis to the Private AI explanation, so a
/// user who has just seen what this machine can run can still change course.
/// The scan result is cleared deliberately — returning re-runs detection
/// rather than showing a stale verdict from a moment ago.
export function backToPrivacy(): void {
  $privateAiChoice.set('undecided')
  $analysis.set(null)
  $analysisError.set(null)
  $selectedProfileId.set(null)
  $route.set('privacy')
}

/// Consent to local inference, then analyse this machine.
export async function choosePrivateAi(): Promise<void> {
  $privateAiChoice.set('private')
  $route.set('analysis')
  await analyzePrivateAi()
}

/// Decline local inference. The base install proceeds unchanged — Private AI
/// is additive and skipping it must never degrade the product.
export async function chooseCloudProvider(): Promise<void> {
  $privateAiChoice.set('cloud')
  $analysis.set(null)
  $selectedProfileId.set(null)
  await startInstall()
}

export async function analyzePrivateAi(): Promise<void> {
  $analysisPending.set(true)
  $analysisError.set(null)
  try {
    const analysis = await invoke<PrivateAiAnalysis>('analyze_private_ai_options')
    $analysis.set(analysis)
    // Pre-select the recommendation, but leave it a user-owned choice.
    const recommended =
      analysis.recommendation.compatible.find((m) => m.recommended) ??
      analysis.recommendation.compatible[0]
    $selectedProfileId.set(recommended ? recommended.profileId : null)
  } catch (err) {
    $analysis.set(null)
    $analysisError.set(err instanceof Error ? err.message : String(err))
  } finally {
    $analysisPending.set(false)
  }
}

export function selectProfile(profileId: string): void {
  $selectedProfileId.set(profileId)
}

// ---------------------------------------------------------------------------
// Private AI provisioning actions
// ---------------------------------------------------------------------------

export async function startProvisioning(profileId: string): Promise<void> {
  $provisionCancelling.set(false)
  $provision.set({ ...PROVISION_INITIAL, status: 'running' })
  $route.set('provision')
  try {
    await invoke('start_private_ai_provisioning', { profileId })
  } catch (err) {
    $provision.set({
      ...$provision.get(),
      status: 'failed',
      error: err instanceof Error ? err.message : String(err)
    })
  }
}

/// Ask the backend to stop provisioning.
///
/// The final `cancelled` status arrives as a backend event, but a multi-GB
/// download does not stop the instant the button is pressed — the stage has to
/// reach a safe point first. Without local state the screen therefore does not
/// change at all when Cancel is clicked, so the user presses it again, and
/// again, with no evidence anything is happening. QA reported exactly that
/// across three cases. This marks the request immediately; the backend event
/// still decides the outcome.
export async function cancelProvisioning(): Promise<void> {
  if ($provisionCancelling.get()) return
  $provisionCancelling.set(true)
  try {
    await invoke('cancel_private_ai_provisioning')
  } catch (error) {
    // The request itself failed, so nothing is stopping — release the flag or
    // the button stays dead for the rest of the run.
    $provisionCancelling.set(false)
    throw error
  }
}

/// Resume from the failed stage. Every stage is idempotent on the Rust side,
/// so this is a plain restart with the same profile.
export async function retryProvisioning(): Promise<void> {
  const profileId = $selectedProfileId.get()
  if (!profileId) return
  await startProvisioning(profileId)
}

/// Give up on Private AI for now. The base install is already complete and
/// untouched; the desktop app runs with a cloud provider until this is
/// revisited from Settings.
export function skipPrivateAi(): void {
  $privateAiChoice.set('cloud')
  $route.set('success')
}

export function continueToSuccess(): void {
  $route.set('success')
}
