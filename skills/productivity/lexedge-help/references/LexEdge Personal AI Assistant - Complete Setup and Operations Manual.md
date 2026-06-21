### LexEdge Personal AI Assistant: The Complete Setup & Operations Manual

#### 1\. Executive Overview: Unified Gateway Architecture

The LexEdge Personal AI Assistant is not merely a standalone application; it is the primary interface for a  **Unified Gateway Architecture** . Built by the original open-source project, this system ensures that a single deployment—sharing one configuration, one set of API keys, and one memory store—drives every interaction surface, from the native Desktop App and CLI/TUI to messaging platforms like Telegram, Discord, and Slack.

##### Core Philosophy: The Learning Loop

Unlike traditional, stateless LLM wrappers, LexEdge Personal AI Assistant operates on a continuous  **Learning Loop** . Utilizing a high-performance  **SQLite**  backend with  **FTS5**  full-text search, the agent encodes operational experience into procedural .md or "skill files." As you complete tasks, LexEdge Personal AI Assistant identifies repeatable patterns. Data suggests that after 10–20 similar operations, the agent achieves a 2–3x increase in efficiency by autonomously referencing these generated skills.

##### Interface Comparison Matrix

Interface,Primary Use Case,Architectural Role
Desktop App,Native Control Center,A React-based renderer for the local/remote backend. Features a preview rail and file browser.
CLI / TUI,Advanced users,Terminal-native interface for scripting and high-speed text interaction.
Web Dashboard,Remote Ops Management,A browser-based admin panel (the dashboard command). Includes a TUI-embedded Chat tab.

#### 2\. Getting Started: Platform-Specific Installation

LexEdge Personal AI Assistant requires a specific environment to maintain technical rigor.  **Python 3.11 is strictly required.**  While the installer may attempt to download a standalone build if it detects 3.12 or 3.13, these downloads frequently time out or fail. Install Python 3.11 manually before proceeding.

##### macOS (12+)

1. Download the native .dmg or use the terminal: use the LexEdge app installer.
2. **Permissions:**  The OS will prompt for microphone access during the first launch of Voice Mode.

##### Windows (Native vs. WSL2)

Windows users have two distinct deployment paths:

* **Native Windows:**  Use the PowerShell installer. To prevent charmap encoding crashes (Error 5\) caused by non-ASCII characters, you must set the UTF-8 environment variable: $env:PYTHONUTF8=1.
* **WSL2 (Recommended):**  This is the preferred path for power users. The embedded TUI Chat feature and specific terminal-dependent skills require a POSIX pseudo-terminal (PTY), which is only natively supported on Windows via WSL2.

##### Linux

Deploy via terminal: use the LexEdge app installer. Ensure the binary path \~/.local/bin is in your $PATH.

##### Backend Choice

On first run, you must choose your runtime environment:

* **Local Backend:**  Managed entirely on your machine.
* **Remote Backend:**  Connects to an external LexEdge Personal AI Assistant instance (VPS, home server, or RTX Spark workstation).

#### 3\. Configuring the Brain: Providers and Remote Connectivity

LexEdge Personal AI Assistant is a model-agnostic framework. You provide the "brain" via an API provider or local inference.

##### Provider Setup & DeepSeek Optimization

* **OpenRouter:**  The recommended service for pay-as-you-go access to 200+ models (Anthropic, OpenAI, xAI).
* **DeepSeek Quirk (Error 7):**  If using DeepSeek with "Thinking Mode" enabled, you must disable it for tasks involving tool calls. DeepSeek's API currently returns a 400 error if reasoning\_content is not replayed exactly after a tool call—a logic loop LexEdge Personal AI Assistant is currently patching.
* **Rate Limits (Error 6):**  If Telegram integrations die in a crash loop with DeepSeek, it is likely due to OpenRouter’s shared pool rate limits. Fix this by adding a personal DeepSeek API key in your OpenRouter integrations.

##### Remote Backend Architecture

Connecting to a remote machine requires configuring the "auth gate":

1. **Host Binding:**  The remote dashboard must bind to a non-loopback address (the dashboard command \--host 0.0.0.0).
2. **DNS/Header Security:**  The app enforces a DNS-rebinding guard. The Remote URL in your settings must match the Host header reported by the server.
3. **Stability:**  Set a stable dashboard authentication secret in the local secrets file to prevent session logouts whenever the remote backend restarts.**Authentication Types:**
* **OAuth (OAuth portal):**  Mandatory for servers exposed to the public internet.
* **Basic Auth:**  Suitable only for trusted local networks or VPNs (e.g., Tailscale).

##### Local Model Integration (Ollama)

For unmetered, private intelligence:

* Point LexEdge Personal AI Assistant to the Ollama custom endpoint (typically port 11434).
* **Critical:**  You  **must**  set the context layer to  **64K** . LexEdge Personal AI Assistant checks available context before execution; values below this threshold will trigger a runtime error.

#### 4\. Interface Navigation & Core Features

##### The Chat Environment

1. **Streaming & Artifacts:**  Live tool activity summaries appear in real-time.
2. **Right-Hand Preview Rail:**  Side-by-side rendering of generated web pages, code files, and search results.
3. **Drag-and-Drop:**  Attach files to the context window by dropping them into the composer.

##### UI Persistence

The  **Model Picker**  in the composer is "sticky." It tracks your selection per device and session. Switching models here will only affect the current chat. To change the agent's behavior for new chats, sub-agents, or cron jobs, you must update the  **Global Default**  in  **Settings \> Model** .

#### 5\. Advanced Intelligence: Memory, Profiles, and Skills

##### Profiles: Isolated Environments

Profiles are distinct agent silos with unique soul.md personas and SQLite memory stores.| Profile Name | Purpose | Suggested Tools || \------ | \------ | \------ || **Coding Agent** | Software Engineering | Terminal, File Read/Write, Code Execution || **Research Agent** | Data Synthesis | Web Search, Browser, Memory || **Ops Agent** | System Audits | Schedules, Terminal, Web Search |

##### The Memory Loop

LexEdge Personal AI Assistant uses a "Tell, Inspect, Correct, Test" loop. Use the  **Memory Management Pane**  to prune stale facts or promote useful preferences. Because it uses  **FTS5** , search within memory is instantaneous even with thousands of entries.

##### Tool Permissions Matrix

As an Architect, you must manage the "blast radius" of your agent. Enable tools based on the risk profile of the task.| Risk Level | Tools | Security Recommendation || \------ | \------ | \------ || **Low** | Memory, Web Search, Planning | Safe for all profiles. || **Medium** | Browser Automation, File Read | Restrict to non-sensitive data profiles. || **High** | Terminal, File Writing, Messaging | **Requires Oversight.**  Use only in isolated profiles. |

#### 6\. Automation: The "Brain Dump" Workflow

LexEdge Personal AI Assistant supports  **Cron Jobs**  for unattended tasks (e.g., "Daily 9 AM Market Briefing").

##### The "Perfect Cron" Strategy

Do not simply prompt the agent to "set a schedule." Use the  **Brain Dump to Reverse Prompt**  combo:

1. **Brain Dump:**  Feed the agent all your goals and constraints (e.g., "I invest in AI and follow the Boston Celtics; I prefer bullet points").
2. **Reverse Prompt:**  Ask:  *"What is the best prompt I should use to set up a Cron job for this, ensuring you use web search correctly and avoid stale data?"*
3. **Execution:**  Use the generated prompt in the  **Cron management pane**  or via natural language.

#### 7\. Delegation: Sub-Agents vs. Profiles

* **Profiles:**  Isolated configurations (Separate Soul, Memory, and Tools).
* **Sub-Agents:**  Parallel copies of the  *active*  agent.
* **Example:**  A Research Agent can spin up two "workers" (sub-agents) to debate the pros and cons of an IPO simultaneously, then synthesize the results into the main thread.

#### 8\. High-Performance Workflows & Hardware

For users operating at the frontier, hardware like the  **RTX Spark**  (128GB Unified Memory) enables local deployment of 120B-parameter models.

* **Context:**  This hardware supports up to 1 million tokens of context locally.
* **Efficiency:**  Running high-tier models (like Qwen 37B or Llama 3 70B) on-device allows for "unmetered intelligence" without recurring API costs.

#### 9\. Troubleshooting & Maintenance

##### Common Fixes

Error,Recommended Fix
externally-managed-environment,Install via uv or create a virtual environment (python \-m venv venv).
command not found,Add \~/.local/bin to your PATH or reload your shell (source \~/.bashrc).
DeepSeek 400 Error,"Disable ""Thinking Mode"" during tool calls in the model settings."
Remote 401 / 4403 Error,Ensure the Host header matches the Remote URL and \--host 0.0.0.0 is bound.
Build stuck on Electron,Clear the zip cache: rm \-rf \~/Library/Caches/electron (Mac) or AppData/Local/electron/Cache (Win).

##### Uninstallation Levels

Accessible via  **Settings \> About \> Danger Zone** :

1. **Chat GUI Only:**  Removes the desktop wrapper; keeps the agent and data.
2. **GUI \+ Agent:**  Removes software; keeps configuration and secrets.
3. **Full Wipe:** Permanent removal of all local LexEdge data.

**Logs:** Access detailed logs from the app using **Settings -> Gateway -> Open Logs**.
