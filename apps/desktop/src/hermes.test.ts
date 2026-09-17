import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { getSessionMessages, listAllProfileSessions, listSessions } from './hermes'

const emptySessionsResponse = {
  limit: 0,
  offset: 0,
  sessions: [],
  total: 0
}

describe('Hermes REST session helpers', () => {
  let api: ReturnType<typeof vi.fn>

  beforeEach(() => {
    api = vi.fn().mockResolvedValue(emptySessionsResponse)
    Object.defineProperty(window, 'hermesDesktop', {
      configurable: true,
      value: { api }
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
    Reflect.deleteProperty(window, 'hermesDesktop')
  })

  it('uses a longer timeout for the single-profile session list', async () => {
    await listSessions(50, 1)

    expect(api).toHaveBeenCalledWith(
      expect.objectContaining({
        path: '/api/sessions?limit=50&offset=0&min_messages=1&archived=exclude&order=recent',
        timeoutMs: 60_000
      })
    )
  })

  it('uses a longer timeout for the all-profile session list', async () => {
    await listAllProfileSessions(50, 1)

    expect(api).toHaveBeenCalledWith(
      expect.objectContaining({
        path: '/api/profiles/sessions?limit=50&offset=0&min_messages=1&archived=exclude&order=recent&profile=all',
        timeoutMs: 60_000
      })
    )
  })

  it('tags cross-profile message reads for Electron routing and backend lookup', async () => {
    api.mockResolvedValue({ messages: [], session_id: 'session-1' })

    await getSessionMessages('session-1', 'xiaoxuxu')

    expect(api).toHaveBeenCalledWith({
      path: '/api/sessions/session-1/messages?profile=xiaoxuxu',
      profile: 'xiaoxuxu'
    })
  })
})

describe('backend warm-up retry', () => {
  let api: ReturnType<typeof vi.fn>

  beforeEach(() => {
    vi.useFakeTimers()
    api = vi.fn()
    Object.defineProperty(window, 'hermesDesktop', {
      configurable: true,
      value: { api }
    })
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  // Drives the retry loop's timers to completion without waiting in real time.
  async function settle<T>(promise: Promise<T>): Promise<T> {
    const result = promise.then(
      value => ({ ok: true as const, value }),
      error => ({ ok: false as const, error })
    )
    for (let i = 0; i < 50; i += 1) {
      await vi.advanceTimersByTimeAsync(10_000)
    }
    const outcome = await result
    if (!outcome.ok) throw outcome.error
    return outcome.value
  }

  it('retries a connection timeout and succeeds once the backend is up', async () => {
    // The reported failure: the wizard's first call lands while the backend is
    // still importing, and a single 15s attempt gives up on a working install.
    api
      .mockRejectedValueOnce(new Error('Timed out connecting to LexEdge AI backend after 15000ms'))
      .mockRejectedValueOnce(new Error('Timed out connecting to LexEdge AI backend after 15000ms'))
      .mockResolvedValue({ completed: false })

    const { getOnboardingStatus } = await import('./hermes')
    await expect(settle(getOnboardingStatus())).resolves.toEqual({ completed: false })
    expect(api).toHaveBeenCalledTimes(3)
  })

  it('retries a refused connection too', async () => {
    api
      .mockRejectedValueOnce(new Error('connect ECONNREFUSED 127.0.0.1:8765'))
      .mockResolvedValue({ completed: true })

    const { getOnboardingStatus } = await import('./hermes')
    await expect(settle(getOnboardingStatus())).resolves.toEqual({ completed: true })
    expect(api).toHaveBeenCalledTimes(2)
  })

  it('does not retry an unrelated failure', async () => {
    // Retrying a real error would hide it behind two minutes of silence.
    api.mockRejectedValue(new Error('500: internal server error'))

    const { getOnboardingStatus } = await import('./hermes')
    await expect(settle(getOnboardingStatus())).rejects.toThrow('500: internal server error')
    expect(api).toHaveBeenCalledTimes(1)
  })

  it('gives a plain-language message when the backend never comes up', async () => {
    // A lawyer should not be shown "Error invoking remote method 'hermes:api'".
    api.mockRejectedValue(new Error('Timed out connecting to LexEdge AI backend after 45000ms'))

    const { getOnboardingStatus } = await import('./hermes')
    await expect(settle(getOnboardingStatus())).rejects.toThrow(/still starting/i)
    expect(api.mock.calls.length).toBeGreaterThan(1)
  })
})
