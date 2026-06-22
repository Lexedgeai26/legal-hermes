import type { MatterRecord } from '@/types/hermes'

export function matterPrompt(matter: MatterRecord, action = 'Start by preparing a matter intake summary with parties, key dates, document types, obvious gaps, and recommended next steps.') {
  const fileLines = matter.files
    .slice(0, 40)
    .map(file => `- ${file.path}`)
    .join('\n')
  const remaining = matter.files.length > 40 ? `\n- ...and ${matter.files.length - 40} more indexed files` : ''

  return `
Use this as the active matter workspace:

Matter: ${matter.name}
Client: ${matter.client_name || 'not specified'}
Matter type: ${matter.matter_type}
Court / authority: ${matter.court_or_authority || 'not specified'}
Role: ${matter.role || 'not specified'}
Folder: ${matter.folder_path}

Work only inside this matter folder unless I explicitly add another file or folder.
First read the indexed documents that are relevant to my question, not every file automatically.
Keep all legal output marked as draft and suitable for advocate review.

Indexed files:
${fileLines || '- No indexed files yet'}${remaining}

${action}
`.trim()
}
