// Pure helper for the boot-failure overlay's "translate a raw install error
// into plain language" branch. Kept out of the .tsx so it's unit-testable
// without a React/jsdom render, mirroring ./boot-failure-reauth.
//
// Most users installing the desktop app (lawyers, not developers) can't act
// on a raw PowerShell exception like "Cannot find path '...\batch_runner.py'
// because it does not exist." — that signature is what Windows Defender /
// third-party antivirus produces when it deletes or quarantines a file the
// installer just extracted, moments before the installer tries to move or
// read it. Detecting that class of error lets the overlay show an actionable
// hint (pause antivirus / add an exclusion, then Repair install) instead of
// leaving a non-technical user stuck on a stack-trace-shaped message.

// "Cannot find path '<path>' because it does not exist." is PowerShell's
// generic missing-file wording, thrown here by Move-Item/Get-Content/etc.
// when a file vanishes between install.ps1 writing it and reading it back.
const MISSING_FILE_PATTERN = /cannot find path .*because it does not exist/i

// Stages where install.ps1 extracts/writes fresh files to disk and is
// therefore exposed to a real-time scanner racing the installer. Stages
// further along (venv, path, config-templates, …) that hit the same
// generic PowerShell error are more likely a genuine permissions/disk issue,
// so we don't relabel those as an antivirus hint.
const FILE_WRITE_STAGES = ["'repository'", "'dependencies'", "'node-deps'"]

// True when a boot-failure error string looks like antivirus/security
// software interfered with the installer's freshly-written files rather
// than a real bug in the install steps themselves.
export function isLikelyAntivirusInterference(rawError: string | null | undefined): boolean {
  if (!rawError) {
    return false
  }

  if (!MISSING_FILE_PATTERN.test(rawError)) {
    return false
  }

  return FILE_WRITE_STAGES.length === 0 || FILE_WRITE_STAGES.some(stage => rawError.includes(stage))
}
