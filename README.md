# LexEdge AI

LexEdge AI is an open-source, legal-focused personal AI assistant built on the MIT-licensed [Nous Research Hermes Agent](https://github.com/NousResearch/hermes-agent).

This repository keeps the core Hermes agent architecture and adds LexEdge legal workflows, legal skill groups, desktop packaging improvements, and public-release documentation for lawyer-facing use cases.

Customized by Chirag Kansara and LexEdge AI contributors. See [LexEdge AI](https://www.lexedge.ai/) for product context.

> **Legal safety note:** LexEdge AI prepares drafts, checklists, summaries, and analysis for human review. It is not a lawyer, does not provide final legal advice, and should not file, serve, send, sign, or submit legal material without human approval.

## What this adds over upstream Hermes Agent

- Legal-first skill organization for intake, research, drafting, review, litigation, compliance, and matter workflows.
- Jurisdiction-neutral legal workflow patterns that can be adapted to local law and firm policy.
- Desktop app hardening for non-technical users, including clearer startup recovery and installer guidance.
- Legal skill import support for packaged external legal visualizer/skill definitions.
- Public installation and build instructions for CLI, macOS desktop, Windows ZIP, and Windows installer builds.
- Safety language and repository hygiene for open-source distribution.

## Legal skill areas

- Matter intake and conflict screening
- Contract triage and routing
- Contract drafting support
- Document classification and extraction
- Citation-grounded research and Q&A
- Litigation drafting support
- Hearing preparation
- Deadline and limitation monitoring
- Compliance filing preparation
- Matter status reporting

These workflows are designed to support legal work across jurisdictions. Jurisdiction-specific conclusions, filings, limitation periods, court rules, and professional responsibility requirements must be reviewed by a qualified lawyer in the relevant jurisdiction.

## Quick start

```bash
git clone https://github.com/<your-org>/<your-repo>.git
cd <your-repo>
```

Install and run the CLI using the upstream Hermes development flow:

```bash
uv sync --extra all
uv run hermes
```

For desktop and release builds, see [INSTALL.md](INSTALL.md).

## Desktop development

```bash
cd apps/desktop
npm install
npm run dev
```

For production packaging, use the commands documented in [INSTALL.md](INSTALL.md). Windows installer builds should be produced on Windows for best code-signing and NSIS/MSI compatibility.

## Provider configuration

LexEdge AI uses the same provider configuration model as Hermes Agent. Configure your preferred LLM provider through environment variables, CLI setup, or desktop settings.

Never commit real API keys, OAuth tokens, credentials, client documents, matter exports, logs, databases, or local desktop runtime state.

## Repository hygiene for public use

Before publishing a fork publicly:

```bash
gitleaks detect --source . --redact
```

Also verify Git history, not only the current working tree, if any private documents were ever committed.

## License and attribution

This project is released under the MIT License.

LexEdge AI is developed from the original [Nous Research Hermes Agent](https://github.com/NousResearch/hermes-agent), which is also MIT licensed. Copyright notices for both upstream and LexEdge contributors are preserved in [LICENSE](LICENSE).
