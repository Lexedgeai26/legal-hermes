# UI Development Guide

This guide explains how to update the LexEdge desktop UI.

## UI Stack

- Electron shell: `apps/desktop/electron`
- React renderer: `apps/desktop/src`
- Routing: `react-router-dom`
- Styling: Tailwind-style utility classes and app CSS in `apps/desktop/src/styles.css`
- UI primitives: `apps/desktop/src/components/ui`
- API client: `apps/desktop/src/hermes.ts`
- Types: `apps/desktop/src/types/hermes.ts`

## Route and Screen Structure

Main route list:

- `apps/desktop/src/app/routes.ts`

Screens:

- Chat: `apps/desktop/src/app/chat`
- Skills: `apps/desktop/src/app/skills`
- Matters: `apps/desktop/src/app/matters`
- Messaging: `apps/desktop/src/app/messaging`
- Artifacts: `apps/desktop/src/app/artifacts`
- Cron: `apps/desktop/src/app/cron`
- Profiles: `apps/desktop/src/app/profiles`
- Agents: `apps/desktop/src/app/agents`
- Settings: `apps/desktop/src/app/settings`

To add a new top-level screen:

1. Create `apps/desktop/src/app/<feature>/index.tsx`.
2. Add a route constant in `apps/desktop/src/app/routes.ts`.
3. Register it in `APP_ROUTES`.
4. Add shell/sidebar navigation where appropriate.
5. Add backend API functions to `apps/desktop/src/hermes.ts`.
6. Add types to `apps/desktop/src/types/hermes.ts`.

## Design Rules for Lawyer-Facing UI

- Use plain legal office language.
- Avoid raw JSON, Python, stack traces, or config names in normal flows.
- Show primary actions as buttons: Open, Download, Connect, Refresh, Review, Export.
- Keep generated files visible as documents, not as file paths.
- Use "Draft" labels for generated legal outputs.
- Recommend human/advocate review before filing, sending, or submission.
- Put advanced or uncommon settings behind collapsible sections.
- Default to safe settings.

## Common UI Patterns

### API Data Screen

Use this shape:

1. Local loading state.
2. `refresh()` function.
3. `useEffect(() => void refresh(), [])`.
4. `notifyError(err, "...")` for failures.
5. Empty state.
6. Action buttons that call backend APIs.

Example files:

- `apps/desktop/src/app/matters/index.tsx`
- `apps/desktop/src/app/messaging/index.tsx`
- `apps/desktop/src/app/artifacts/index.tsx`

### Settings Panel

Settings pages usually:

- Read current config from backend.
- Show form fields.
- Save through API client.
- Display non-technical success/failure notification.

Example files:

- `apps/desktop/src/app/settings/providers-settings.tsx`
- `apps/desktop/src/app/settings/legal-assistant-settings.tsx`
- `apps/desktop/src/app/settings/model-settings.tsx`

### Open Local File

Use:

```ts
await window.hermesDesktop?.openExternal?.(mediaExternalUrl(path))
```

Import:

```ts
import { mediaExternalUrl } from '@/lib/media'
```

Do not open local paths through `window.open` directly.

### User Notifications

Use:

```ts
import { notify, notifyError } from '@/store/notifications'
```

Guidance:

- `notify` for success and user-friendly warnings.
- `notifyError` for caught errors, with a human-readable fallback.
- Do not expose technical exceptions to lawyers unless in a debug view.

## Adding Backend API Usage

1. Add Python endpoint in `hermes_cli/web_server.py`.
2. Add TypeScript interfaces in `apps/desktop/src/types/hermes.ts`.
3. Add a wrapper in `apps/desktop/src/hermes.ts`.
4. Call the wrapper from UI.

Example wrapper:

```ts
export function listMatters(): Promise<MattersResponse> {
  return window.hermesDesktop.api<MattersResponse>({
    ...profileScoped(),
    path: '/api/matters'
  })
}
```

Use `profileScoped()` for profile-specific settings/data.

## Build and Test UI

```bash
npm --workspace apps/desktop run build
npm --workspace apps/desktop run typecheck
npm --workspace apps/desktop run lint
npm --workspace apps/desktop run test:ui
```

For local app development:

```bash
npm --workspace apps/desktop run dev
```

For isolated profile development:

```bash
HERMES_HOME=/tmp/lexedge-ui-dev npm --workspace apps/desktop run dev
```

## Updating the Installed macOS App During Development

After `npm --workspace apps/desktop run build`, repack the installed app if the user needs to see the change immediately:

```bash
APP_RES="/Users/chiraghome/Applications/LexEdge AI.app/Contents/Resources"
STAMP="$(date +%Y%m%d%H%M%S)"
TMP="$(mktemp -d)"
cp "$APP_RES/app.asar" "$APP_RES/app.asar.before-ui-$STAMP"
npx asar extract "$APP_RES/app.asar" "$TMP/app"
rm -rf "$TMP/app/apps/desktop/dist" "$TMP/app/dist"
mkdir -p "$TMP/app/apps/desktop"
cp -R apps/desktop/dist "$TMP/app/apps/desktop/dist"
cp -R apps/desktop/dist "$TMP/app/dist"
npx asar pack "$TMP/app" "$APP_RES/app.asar"
rm -rf "$TMP"
osascript -e 'tell application "LexEdge AI" to quit' || true
sleep 2
open -a "/Users/chiraghome/Applications/LexEdge AI.app"
```

