import { describe, expect, it } from 'vitest'

import { isLikelyAntivirusInterference } from './boot-failure-hints'

describe('isLikelyAntivirusInterference', () => {
  it('true for the real-world repository-stage missing-file signature', () => {
    const raw =
      "Hermes bootstrap failed at stage 'repository': Cannot find path " +
      "'C:\\Users\\Admin\\AppData\\Local\\Temp\\hermes-agent-source-hermes-agent-source-20260703-153805" +
      "\\hermes-agent\\batch_runner.py' because it does not exist.. " +
      'Check C:\\Users\\Admin\\AppData\\Local\\hermes\\logs\\desktop.log for the full transcript.'

    expect(isLikelyAntivirusInterference(raw)).toBe(true)
  })

  it('true for the dependencies stage with the same missing-file signature', () => {
    const raw = "Hermes bootstrap failed at stage 'dependencies': Cannot find path 'C:\\x\\y.whl' because it does not exist."

    expect(isLikelyAntivirusInterference(raw)).toBe(true)
  })

  it('false for an unrelated error at a file-write stage', () => {
    const raw = "Hermes bootstrap failed at stage 'repository': The process cannot access the file because it is being used by another process."

    expect(isLikelyAntivirusInterference(raw)).toBe(false)
  })

  it('false for the missing-file signature outside a file-write stage', () => {
    const raw = "Hermes bootstrap failed at stage 'path': Cannot find path 'C:\\x\\y' because it does not exist."

    expect(isLikelyAntivirusInterference(raw)).toBe(false)
  })

  it('false for null/undefined/empty', () => {
    expect(isLikelyAntivirusInterference(null)).toBe(false)
    expect(isLikelyAntivirusInterference(undefined)).toBe(false)
    expect(isLikelyAntivirusInterference('')).toBe(false)
  })
})
