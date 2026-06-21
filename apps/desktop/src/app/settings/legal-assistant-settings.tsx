import { useEffect, useMemo, useState } from 'react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { getLegalAssistantSettings, updateLegalAssistantSettings } from '@/hermes'
import { Bell, CheckCircle2, FileText, Lock, MessageCircle, Settings2, Users } from '@/lib/icons'
import { notify, notifyError } from '@/store/notifications'
import type { LegalAssistantSettings } from '@/types/hermes'

import { asText, getNested, setNested } from './helpers'
import { ListRow, SectionHeading, SettingsContent } from './primitives'

const PRACTICE_AREAS = [
  ['civil_litigation', 'Civil litigation'],
  ['criminal_litigation', 'Criminal litigation'],
  ['gst_tax', 'GST and tax'],
  ['section_138', 'Cheque dishonour / Section 138 NI Act'],
  ['ibc', 'IBC'],
  ['sarfaesi', 'SARFAESI'],
  ['arbitration', 'Arbitration'],
  ['contracts', 'Contracts'],
  ['employment', 'Employment'],
  ['family_law', 'Family law'],
  ['property', 'Property'],
  ['consumer', 'Consumer disputes'],
  ['general_documentation', 'General documentation']
] as const

const APPROVAL_RULES = [
  ['draft_only', 'Draft only', 'Do not file, serve, send, or take action automatically.'],
  ['require_client_message_approval', 'Approve client-facing messages', 'Confirm before WhatsApp, email, or other external delivery.'],
  ['allow_internal_whatsapp_replies', 'Allow internal WhatsApp replies', 'Permit direct replies in the lawyer/staff assistant chat.'],
  ['allow_email_draft_creation', 'Allow email draft creation', 'Prepare email replies without sending them.'],
  ['allow_email_send_after_confirmation', 'Allow email send after confirmation', 'Only send after explicit lawyer approval.'],
  ['require_confirmation_before_external_files', 'Confirm external files and links', 'Ask before sending documents, links, or attachments.'],
  ['label_outputs_as_draft', 'Label legal outputs as draft', 'Mark legal outputs as drafts for advocate review.']
] as const

const CHANNEL_RULES = [
  ['channels.whatsapp.enabled', 'WhatsApp enabled', 'Use WhatsApp for intake, updates, and approvals.'],
  ['channels.whatsapp.approval_only', 'WhatsApp approval-only', 'External WhatsApp delivery needs confirmation.'],
  ['channels.whatsapp.pause_replies', 'Pause WhatsApp replies', 'Stop automatic assistant replies for WhatsApp.'],
  ['channels.gmail.enabled', 'Gmail enabled', 'Use Gmail for matter intake and draft replies.'],
  ['channels.gmail.draft_only', 'Gmail draft-only', 'Create drafts, never auto-send.'],
  ['channels.gmail.read_inbox', 'Read inbox', 'Allow selected mailbox intake.'],
  ['channels.gmail.send_after_approval', 'Send Gmail after approval', 'Permit sending only after confirmation.'],
  ['channels.slack.enabled', 'Slack enabled', 'Use Slack for internal firm review.'],
  ['channels.telegram.enabled', 'Telegram enabled', 'Use Telegram for selected chats.']
] as const

const NOTIFICATIONS = [
  ['draft_ready', 'Draft ready'],
  ['limitation_reminder', 'Limitation reminder'],
  ['hearing_reminder', 'Hearing reminder'],
  ['client_update_draft_ready', 'Client update draft ready'],
  ['missing_document_reminder', 'Missing document reminder'],
  ['daily_matter_summary', 'Daily matter summary'],
  ['weekly_work_summary', 'Weekly work summary'],
  ['failed_channel_connection', 'Failed channel connection'],
  ['approval_required', 'Approval required']
] as const

function boolAt(settings: LegalAssistantSettings, path: string): boolean {
  return Boolean(getNested(settings, path))
}

export function LegalAssistantSettingsView() {
  const [settings, setSettings] = useState<LegalAssistantSettings | null>(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    let cancelled = false
    getLegalAssistantSettings()
      .then(result => {
        if (!cancelled) {
          setSettings(result.settings)
        }
      })
      .catch(err => notifyError(err, 'Could not load legal assistant settings.'))
    return () => {
      cancelled = true
    }
  }, [])

  const dirty = useMemo(() => Boolean(settings), [settings])

  function update(path: string, value: unknown) {
    setSettings(current => (current ? setNested(current, path, value) : current))
  }

  async function save() {
    if (!settings) {
      return
    }
    setSaving(true)
    try {
      const result = await updateLegalAssistantSettings(settings)
      setSettings(result.settings)
      notify({ kind: 'success', title: 'Legal assistant settings saved', message: 'Your workspace preferences were updated.' })
    } catch (err) {
      notifyError(err, 'Could not save legal assistant settings.')
    } finally {
      setSaving(false)
    }
  }

  if (!settings) {
    return (
      <SettingsContent>
        <div className="py-8 text-sm text-muted-foreground">Loading legal assistant settings...</div>
      </SettingsContent>
    )
  }

  return (
    <SettingsContent>
      <div className="flex flex-col gap-6 py-4">
        <header>
          <h2 className="text-lg font-semibold tracking-tight">Legal Assistant</h2>
          <p className="mt-1 max-w-3xl text-sm leading-6 text-muted-foreground">
            Configure LexEdge for Indian legal work without editing files or technical gateway settings. These
            preferences are saved for the active workspace.
          </p>
        </header>

        <section>
          <SectionHeading icon={Users} title="Identity" />
          <ListRow
            action={<Input value={asText(getNested(settings, 'identity.assistant_name'))} onChange={e => update('identity.assistant_name', e.target.value)} />}
            description="Name shown in lawyer-facing messages."
            title="Assistant name"
          />
          <ListRow
            action={<Input value={asText(getNested(settings, 'identity.firm_name'))} onChange={e => update('identity.firm_name', e.target.value)} />}
            description="Firm or chamber name used in defaults."
            title="Firm name"
          />
          <ListRow
            action={<Input value={asText(getNested(settings, 'identity.default_jurisdiction'))} onChange={e => update('identity.default_jurisdiction', e.target.value)} />}
            description="Default jurisdiction for legal drafting and review."
            title="Default jurisdiction"
          />
          <ListRow
            action={<Input value={asText(getNested(settings, 'identity.default_court'))} onChange={e => update('identity.default_court', e.target.value)} />}
            description="Optional default court, tribunal, or forum."
            title="Default court/forum"
          />
          <ListRow
            below={
              <Textarea
                className="mt-3 min-h-24"
                value={asText(getNested(settings, 'identity.signature_block'))}
                onChange={e => update('identity.signature_block', e.target.value)}
              />
            }
            description="Optional signature block for drafts and client updates."
            title="Signature block"
            wide
          />
          <ListRow
            below={
              <Textarea
                className="mt-3 min-h-24"
                value={asText(getNested(settings, 'identity.draft_disclaimer'))}
                onChange={e => update('identity.draft_disclaimer', e.target.value)}
              />
            }
            description="Default disclaimer attached to legal drafts."
            title="Draft disclaimer"
            wide
          />
          <ListRow
            below={
              <Textarea
                className="mt-3 min-h-40"
                value={asText(getNested(settings, 'identity.welcome_message'))}
                onChange={e => update('identity.welcome_message', e.target.value)}
              />
            }
            description="Default welcome/help message for connected channels."
            title="Welcome message"
            wide
          />
        </section>

        <section>
          <SectionHeading icon={FileText} title="Practice areas" />
          <div className="grid gap-x-6 sm:grid-cols-2">
            {PRACTICE_AREAS.map(([key, label]) => (
              <ToggleRow
                checked={boolAt(settings, `practice_areas.${key}`)}
                key={key}
                onChange={value => update(`practice_areas.${key}`, value)}
                title={label}
              />
            ))}
          </div>
        </section>

        <section>
          <SectionHeading icon={Lock} title="Approval rules" />
          {APPROVAL_RULES.map(([key, title, description]) => (
            <ToggleRow
              checked={boolAt(settings, `approval_rules.${key}`)}
              description={description}
              key={key}
              onChange={value => update(`approval_rules.${key}`, value)}
              title={title}
            />
          ))}
        </section>

        <section>
          <SectionHeading icon={MessageCircle} title="Channels" />
          <div className="rounded-md border border-border/70 bg-muted/20 px-3 py-2 text-sm leading-6 text-muted-foreground">
            Connect accounts from the Messaging page. These toggles control legal safety defaults for those connected
            channels.
          </div>
          {CHANNEL_RULES.map(([path, title, description]) => (
            <ToggleRow
              checked={boolAt(settings, path)}
              description={description}
              key={path}
              onChange={value => update(path, value)}
              title={title}
            />
          ))}
        </section>

        <section>
          <SectionHeading icon={Bell} title="Notifications" />
          <div className="grid gap-x-6 sm:grid-cols-2">
            {NOTIFICATIONS.map(([key, label]) => (
              <ToggleRow
                checked={boolAt(settings, `notifications.${key}`)}
                key={key}
                onChange={value => update(`notifications.${key}`, value)}
                title={label}
              />
            ))}
          </div>
        </section>

        <section>
          <SectionHeading icon={Settings2} title="Matter defaults" />
          <ListRow
            action={<Input value={asText(getNested(settings, 'matter_defaults.matter_number_format'))} onChange={e => update('matter_defaults.matter_number_format', e.target.value)} />}
            description="Example: LEX-{YYYY}-{####}"
            title="Matter numbering format"
          />
          <ListRow
            action={<Input value={asText(getNested(settings, 'matter_defaults.default_folder'))} onChange={e => update('matter_defaults.default_folder', e.target.value)} />}
            description="Optional folder for matter documents."
            title="Default matter folder"
          />
          <ListRow
            action={<Input value={asText(getNested(settings, 'matter_defaults.reminder_schedule'))} onChange={e => update('matter_defaults.reminder_schedule', e.target.value)} />}
            description="Default time for reminders, e.g. 09:00."
            title="Reminder schedule"
          />
          <ListRow
            action={<Input value={asText(getNested(settings, 'matter_defaults.client_update_format'))} onChange={e => update('matter_defaults.client_update_format', e.target.value)} />}
            description="concise, detailed, bilingual, or client-friendly."
            title="Client update format"
          />
        </section>

        <div className="sticky bottom-0 flex justify-end border-t border-border/60 bg-(--ui-bg-primary)/95 py-3">
          <Button disabled={!dirty || saving} onClick={() => void save()}>
            {saving ? 'Saving...' : 'Save legal assistant settings'}
          </Button>
        </div>
      </div>
    </SettingsContent>
  )
}

function ToggleRow({
  checked,
  description,
  onChange,
  title
}: {
  checked: boolean
  description?: string
  onChange: (checked: boolean) => void
  title: string
}) {
  return (
    <ListRow
      action={<Switch checked={checked} onCheckedChange={onChange} size="xs" />}
      description={description}
      title={
        <span className="flex items-center gap-2">
          {checked ? <CheckCircle2 className="size-3.5 text-primary" /> : null}
          {title}
        </span>
      }
    />
  )
}
