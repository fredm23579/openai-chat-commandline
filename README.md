# AI Chat — Universal Command-Line Assistant

A Node.js command-line chat application supporting **six AI providers**, **automatic web search with cited sources**, **file and URL attachments**, **Google Drive and Gmail integration**, **persistent session history**, **cross-session memory**, and **chat import from other AIs**.

---

## Features

### AI Providers

Select from six providers at startup (or set a default):

| Provider | Models | Notes |
|---|---|---|
| **OpenAI** | gpt-4o, gpt-4.1, o3-mini, … | Vision support, 1 M ctx |
| **Anthropic (Claude)** | claude-opus-4-6, claude-sonnet-4-6, … | Vision support, 200 k ctx |
| **Google Gemini** | gemini-2.0-flash, gemini-1.5-pro, … | Up to 2 M ctx, vision |
| **Perplexity** | sonar, sonar-pro, sonar-deep-research | Built-in real-time web search |
| **X AI (Grok)** | grok-3, grok-3-fast, grok-2-1212 | xAI flagship models |
| **Meta / Llama (Groq)** | llama-3.3-70b, llama-3.1-8b, mixtral | Fast open-weights inference |

### Automatic Web Search

Every prompt is searched via **Tavily** or **Brave Search** before the AI responds. Results are injected as context and cited sources (`[1]`, `[2]`, …) are printed below each reply.

### File & URL Attachments

Attach content to any message with `/file` or `/url`:

| Type | Details |
|---|---|
| Text / code | `.txt`, `.md`, `.js`, `.py`, `.json`, `.csv`, `.html`, and any UTF-8 file |
| PDF | `.pdf` — text extracted locally or from a URL |
| Word | `.docx` — text extracted via mammoth |
| PowerPoint | `.pptx` — slide text extracted |
| Images | `.jpg`, `.png`, `.gif`, `.webp` — passed to vision models |
| Audio | `.mp3`, `.wav`, `.m4a`, … — transcribed via OpenAI Whisper |
| URLs | Any `https://` page — text extracted |
| Google Docs | `docs.google.com/document/…` — exported as text (public or OAuth) |
| Google Sheets | `docs.google.com/spreadsheets/…` — exported as CSV |

### Google Drive & Gmail (OAuth2)

- `/gdrive <query>` — full-text search across your Drive; select a file to attach
- `/gdrive <file-id or URL>` — attach a specific Drive file directly
- `/gmail <query>` — search Gmail and multi-select emails to attach as context
- One-time OAuth2 browser consent; tokens cached automatically

### Persistent Session History

- Every conversation is saved to `~/.ai-chat/sessions/` as a JSON file
- `/history` — browse and reload any saved session
- `/context` — multi-select previous sessions as reference context for the current chat
- `/save` — force-save at any time; sessions also auto-save on exit

### Cross-Session Memory

- `/remember <fact>` — persist any fact about yourself across all future sessions
- `/memory` — list all stored memories
- `/forget <id>` — remove a specific memory
- Memories are automatically injected into every AI call

### Personalization

- `/config` — set your name, default provider/model, auto-search preference, and more
- Saved defaults skip the provider/model selection menus on startup

### Chat Import

`/import <file>` — import conversation history from:

- **ChatGPT** (`conversations.json` from Settings → Data export)
- **Claude.ai** (Claude conversation export JSON)
- **Gemini / Bard** (Google Takeout export)
- **Generic JSON** (`[{role, content}]` arrays)
- **Markdown** transcripts (`# User` / `# Assistant` headings)

Imported sessions are saved and available via `/history` or `/context`.

### REPL Quality of Life

- **Streaming output** — tokens appear live for all providers
- **↑/↓ prompt history** — persisted to `~/.ai-chat/prompt_history` across sessions
- **Tab completion** — commands and file paths
- **Ctrl-C** — auto-saves session and exits cleanly

---

## Prerequisites

- **Node.js v18.0+**
- **npm**
- At least one AI provider API key (see Configuration)

---

## Installation

```bash
git clone https://github.com/fredm23579/openai-chat-commandline.git
cd openai-chat-commandline
npm install
```

---

## Configuration

Copy the example env file and add your keys:

```bash
cp .env.example .env
```

Then edit `.env`. At minimum, set one AI provider key:

```env
# At least one provider required
OPENAI_API_KEY=sk-...
# ANTHROPIC_API_KEY=sk-ant-...
# GOOGLE_API_KEY=AI...
# PERPLEXITY_API_KEY=pplx-...
# XAI_API_KEY=xai-...
# GROQ_API_KEY=gsk_...

# Recommended: enables automatic web search
TAVILY_API_KEY=tvly-...
```

See `.env.example` for the full list including Brave Search and local model endpoints.

### Google Drive & Gmail (optional)

1. Go to [Google Cloud Console → Credentials](https://console.cloud.google.com/apis/credentials)
2. Create a project → enable **Google Drive API** and **Gmail API**
3. Create credential → **OAuth 2.0 Client ID → Desktop app** → Download JSON
4. Save the downloaded file as `~/.ai-chat/google-credentials.json`

On first use of `/gdrive` or `/gmail`, your browser will open for consent. Tokens are cached in `~/.ai-chat/google-tokens.json`.

### Custom / Local Models (optional)

Point the OpenAI client at any compatible server such as Ollama or LM Studio:

```env
OPENAI_BASE_URL=http://localhost:11434/v1
OPENAI_API_KEY=ollama   # any non-empty string
```

---

## Usage

```bash
node chat.js
# or
npm start
```

On startup you will be prompted to select a provider and model (or your saved defaults will be used). Then type any message to begin chatting.

---

## Commands

| Command | Description |
|---|---|
| `/help` | Show full command reference |
| `/clear` | Clear conversation, context, and system prompt |
| `/save` | Save current session immediately |
| `/history` | Browse and reload a saved session |
| `/context` | Multi-select previous sessions as reference context |
| `/model` | Switch provider / model mid-session |
| `/system <text>` | Set a system prompt |
| `/file <path>` | Attach a local file |
| `/url <url>` | Attach a URL or Google Doc |
| `/gdrive <query or id>` | Search or attach a Google Drive file |
| `/gmail <query>` | Search Gmail and attach emails |
| `/search <query>` | Manual web search (no AI call) |
| `/remember <fact>` | Persist a fact across all sessions |
| `/memory` | List stored memories |
| `/forget <id>` | Delete a memory |
| `/config` | Edit name, defaults, and settings |
| `/import <file>` | Import chat history from another AI |
| `/tokens` | Show estimated token count in context |
| `exit` / `quit` | Save session and exit |

---

## Data Storage

All user data lives in `~/.ai-chat/`:

```
~/.ai-chat/
├── sessions/          # saved conversation JSON files
├── memory.json        # persistent memories
├── config.json        # personalization settings
├── prompt_history     # readline ↑/↓ history
├── google-credentials.json   # Google OAuth2 client (user-provided)
└── google-tokens.json        # Google OAuth2 tokens (auto-generated)
```

---

## Adding Models & Providers

- **Add a model:** append to the `models` array for the relevant provider in `lib/providers.js`
- **Add a provider:** create a new class (or reuse `OpenAICompatibleProvider`) in `lib/providers.js` and detect its env key in `chat.js`

---

## License

MIT — see [LICENSE](LICENSE) for details.

## Contact

Questions or feedback: [motta@g.ucla.edu](mailto:motta@g.ucla.edu) or [open an issue](https://github.com/fredm23579/openai-chat-commandline/issues).
