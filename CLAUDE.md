# CLAUDE.md — AI Assistant Guide

This file documents the codebase structure, conventions, and development workflows for AI assistants working in this repository.

## Project Overview

A Node.js command-line chat application supporting **multiple AI providers**, **automatic web search with cited sources**, **file and URL attachments** (PDF, Word, images, audio, …), **Google Drive and Gmail integration**, **persistent session history**, **cross-session memory**, **personalization**, **chat import from other AIs**, and an interactive REPL with prompt history and tab completion.

- **Author:** Fred Motta (motta@g.ucla.edu)
- **License:** MIT
- **Node.js minimum:** v18.0+
- **Module system:** ESM (`"type": "module"` in package.json)

---

## Repository Structure

```
openai-chat-commandline/
├── chat.js              # Main entry point — REPL loop, command handling, streaming
├── lib/
│   ├── providers.js     # AI provider abstraction (OpenAI, Anthropic, Google, Perplexity, Grok, Groq/Llama)
│   ├── search.js        # Web search (Tavily, Brave Search) + context injection
│   ├── fileReader.js    # File / URL reading (PDF, Word, PPTX, images, audio, URLs)
│   ├── google.js        # Google Drive + Gmail via OAuth2
│   ├── history.js       # Persistent session storage and management
│   ├── memory.js        # Cross-session persistent memory store
│   ├── config.js        # User preferences / personalization
│   ├── importer.js      # Import chat history from ChatGPT, Claude, Gemini exports
│   └── ui.js            # Inquirer menus, chalk styling, help text
├── package.json         # ESM project, dependencies, npm scripts
├── .env.example         # Template for all supported API keys
├── README.md            # User-facing documentation
└── LICENSE              # MIT license
```

User data is stored in `~/.ai-chat/`:
- `sessions/`            — conversation session JSON files
- `memory.json`          — persistent cross-session memories
- `config.json`          — user preferences
- `prompt_history`       — readline ↑/↓ history
- `google-credentials.json` — Google OAuth2 client credentials (user provides)
- `google-tokens.json`   — Google OAuth2 tokens (auto-generated on first auth)

---

## Tech Stack

| Layer | Technology |
|---|---|
| Runtime | Node.js v18+ (ESM) |
| OpenAI | `openai` ^4.85.0 |
| Anthropic | `@anthropic-ai/sdk` ^0.39.0 |
| Google AI | `@google/generative-ai` ^0.24.0 |
| Google APIs | `googleapis` ^144.0.0 (Drive + Gmail OAuth2) |
| CLI menus | `@inquirer/prompts` ^8.3.2 |
| Styling | `chalk` ^5, `ora` ^8 |
| PDF | `pdf-parse` ^1.1.1 |
| Word docs | `mammoth` ^1.8.0 |
| PowerPoint | `adm-zip` ^0.5.16 (zip/XML extraction) |
| HTML → text | `html-to-text` ^9 |
| HTTP | `node-fetch` ^3.3.2 |
| Browser open | `open` ^10.1.0 (OAuth2 flow) |
| Env vars | `dotenv` ^16.4.5 |
| Sessions | Node.js built-in `fs` + `crypto` |
| CLI I/O | Node.js built-in `readline` |

---

## Setup

1. Install dependencies:
   ```bash
   npm install
   ```

2. Copy `.env.example` to `.env` and add your API keys:
   ```bash
   cp .env.example .env
   ```
   At minimum, set one of `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `GOOGLE_API_KEY`, `PERPLEXITY_API_KEY`, `XAI_API_KEY`, or `GROQ_API_KEY`.

3. (Recommended) Add a search key for automatic web search:
   ```
   TAVILY_API_KEY=tvly-...   # https://tavily.com — generous free tier
   ```

4. (Optional) Set up Google Drive + Gmail (see `lib/google.js` header for steps).

5. Run:
   ```bash
   node chat.js
   # or
   npm start
   ```

---

## Application Flow

```
startup
  ├─ load UserConfig (defaults, saved provider/model)
  ├─ load MemoryStore (~/.ai-chat/memory.json)
  ├─ detect available providers from env vars
  └─ selectProviderAndModel()      # inquirer list menus (skips if defaults saved)
       └─ REPL while-loop
            ├─ readline.question() with tab completion + history
            ├─ command handlers (see Commands section)
            └─ conversational input:
                 ├─ flushAttachments()        # pick up queued files/emails
                 ├─ build effectiveSystem     # user prompt + memory + context sessions
                 ├─ webSearch()               # auto-search (if key + autoSearch=true)
                 ├─ buildSearchContext()      # format results for injection
                 ├─ provider.stream()         # streaming response
                 ├─ session.addMessage()      # persist clean turn (no search ctx)
                 └─ print sources            # cited URLs below reply
```

---

## Key Module Details

### `lib/providers.js`

- **`PROVIDERS`** — catalogue of all available models per provider; used by the UI menu
- Provider classes: `OpenAIProvider`, `AnthropicProvider`, `GeminiProvider`, `OpenAICompatibleProvider`
- `OpenAICompatibleProvider` is reused for Perplexity, X AI (Grok), and Groq — all use OpenAI SDK with a custom `baseURL`
- Each provider exposes: `async *stream(history, userText, systemPrompt, images)` — async generator yielding text chunks
- **`createProvider(name, model)`** — factory
- `OPENAI_BASE_URL` env var supported for local / compatible endpoints (Ollama, LM Studio)

### `lib/search.js`

- **`webSearch(query, maxResults=5)`** — dispatches to Tavily (preferred) or Brave Search
- **`buildSearchContext(results)`** — returns a formatted string block injected into the AI prompt, instructing the model to cite sources with `[1]`, `[2]`, … notation
- **`isSearchAvailable()`** — returns `true` if any search key is configured
- Search results are appended to the **API call** but NOT stored in `SessionHistory`

### `lib/fileReader.js`

- **`readFileOrUrl(target)`** — single public function; dispatches by extension or URL pattern
- Returns either a string (text content) or `{ type: 'image', mimeType, data, name }` for image files
- Expands `~/` in paths; handles `http://` / `https://` URLs
- Google Docs and Sheets are fetched via their public export URLs (no OAuth required)
- Audio files are transcribed via OpenAI Whisper (requires `OPENAI_API_KEY`)
- URL fetches are capped at 60 000 chars

### `lib/google.js`

- **`searchDrive(query, maxResults)`** — full-text search across Google Drive
- **`readDriveFile(fileIdOrUrl)`** — read any Drive file (Docs→text, Sheets→CSV, Slides→text, PDF→text)
- **`searchGmail(query, maxResults)`** — search Gmail; returns `{ id, subject, from, date, snippet }`
- **`readGmailMessage(messageId)`** — fetch full email body as text
- **`isGoogleConfigured()`** — returns true if `~/.ai-chat/google-credentials.json` exists
- First-time OAuth2 flow opens browser, caches tokens in `~/.ai-chat/google-tokens.json`
- Tokens are auto-refreshed when near expiry

### `lib/memory.js`

- **`MemoryStore`** — persists to `~/.ai-chat/memory.json`
  - `add(content)` — store a fact, returns id
  - `remove(id)` — delete by id
  - `list()` — return all entries
  - `clear()` — wipe all memories
  - `asContext()` — format as system prompt block injected before every call

### `lib/config.js`

- **`UserConfig`** — persists to `~/.ai-chat/config.json`
  - Fields: `name`, `defaultProvider`, `defaultModel`, `autoSearch`, `autoSave`
  - `get(key)` / `set(key, value)` / `all()`
  - `systemAddition()` — returns personalisation text for system prompt

### `lib/importer.js`

- **`importChatFile(filePath)`** — detect format and import; returns array of session objects
- Supported formats: **ChatGPT** `conversations.json`, **Claude** export JSON, **Gemini/Bard** export, generic `{role,content}` JSON arrays, **Markdown** with `# User` / `# Assistant` headings
- Imported sessions are saved as regular session files (loadable via `/history` or `/context`)

### `lib/history.js`

- **`SessionHistory`** — stores messages in memory, persists to `~/.ai-chat/sessions/<uuid>.json`
  - `addMessage(role, content, images)` / `addAttachment(name, content)` / `flushAttachments()`
  - `getMessages()` — returns history array for providers
  - `estimateTokens()` — rough count (~4 chars per token)
  - `save()` — writes JSON and returns file path
- **`listSessions(dir)`** / **`loadSession(info, dir)`**

### `lib/ui.js`

- **`printWelcome()`** — banner
- **`selectProviderAndModel(available, cfg)`** — respects saved defaults from `UserConfig`
- **`selectSession(sessions)`** — single-select session browser
- **`selectContextSessions(sessions)`** — multi-select (checkbox) for reference context
- **`editConfig(cfg, available)`** — interactive config editor
- **`showHelp()`** — full command and file-type reference

### `chat.js`

- Module-level constants: `CONFIG_DIR`, `HISTORY_FILE`, `SESSIONS_DIR`, `COMMANDS`
- `completer(line)` — readline tab-completion for commands and file paths
- `streamResponse(...)` — drives the async generator, clears spinner on first chunk
- `buildContextBlock(sessions)` — formats previous sessions as reference text
- REPL loop uses `await ask()` (Promise wrapper around `rl.question`) — no recursion
- Ctrl-C (`SIGINT`) auto-saves the session before exiting

---

## Available Providers & Models

### OpenAI (`OPENAI_API_KEY`)
| Model | Context |
|---|---|
| `gpt-4o` | 128 k |
| `gpt-4o-mini` | 128 k |
| `gpt-4.1` | 1 M |
| `gpt-4.1-mini` | 1 M |
| `gpt-4.1-nano` | 1 M |
| `o3-mini` | 200 k |

### Anthropic (`ANTHROPIC_API_KEY`)
| Model | Context |
|---|---|
| `claude-opus-4-6` | 200 k |
| `claude-sonnet-4-6` | 200 k |
| `claude-haiku-4-5-20251001` | 200 k |
| `claude-3-5-sonnet-20241022` | 200 k |
| `claude-3-5-haiku-20241022` | 200 k |

### Google Gemini (`GOOGLE_API_KEY` or `GEMINI_API_KEY`)
| Model | Context |
|---|---|
| `gemini-2.0-flash` | 1 M |
| `gemini-2.0-flash-lite` | 1 M |
| `gemini-1.5-pro` | 2 M |
| `gemini-1.5-flash` | 1 M |

### Perplexity (`PERPLEXITY_API_KEY`)
Perplexity models include built-in real-time web search — they return citations even without `TAVILY_API_KEY`.
| Model | Notes |
|---|---|
| `sonar` | Lightweight, fast |
| `sonar-pro` | Advanced reasoning + search |
| `sonar-reasoning` | Chain-of-thought |
| `sonar-deep-research` | Full research synthesis |

### X AI / Grok (`XAI_API_KEY`)
| Model | Notes |
|---|---|
| `grok-3` | Flagship |
| `grok-3-fast` | Speed-optimised |
| `grok-2-1212` | Stable |
| `grok-beta` | Latest beta |

### Meta / Llama via Groq (`GROQ_API_KEY`)
Groq provides extremely fast inference for open-source Llama models.
| Model | Context |
|---|---|
| `llama-3.3-70b-versatile` | 128 k |
| `llama-3.1-70b-versatile` | 128 k |
| `llama-3.1-8b-instant` | Fast |
| `mixtral-8x7b-32768` | 32 k |

To add a model, append to the `models` array inside `PROVIDERS` in `lib/providers.js`.

---

## Runtime Commands

| Input | Effect |
|---|---|
| `/help` | Print command reference |
| `/clear` | Clear conversation, context sessions, and system prompt |
| `/save` | Save current session to disk immediately |
| `/tokens` | Show estimated token count in context |
| `/model` | Switch provider / model mid-session |
| `/system <text>` | Set a system prompt (persists until `/clear`) |
| `/history` | Browse saved sessions; select one to load |
| `/context` | Multi-select previous sessions as reference context |
| `/remember <fact>` | Persist a fact about yourself across all sessions |
| `/memory` | List all stored memories |
| `/forget <id>` | Delete a specific memory |
| `/config` | Edit name, default provider/model, and other settings |
| `/file <path>` | Attach a local file (PDF, Word, PPTX, image, audio, text…) |
| `/url <url>` | Attach a URL, Google Doc, or Google Sheet |
| `/gdrive <query or id>` | Search or attach a file from Google Drive (OAuth2) |
| `/gmail <query>` | Search Gmail and attach selected emails (OAuth2) |
| `/search <query>` | Manual web search (prints results, no AI call) |
| `/import <file>` | Import chat history (ChatGPT / Claude / Gemini / JSON / Markdown) |
| `exit` / `quit` | Auto-save and exit |

---

## Environment Variables

| Variable | Required | Description |
|---|---|---|
| `OPENAI_API_KEY` | One of these | OpenAI models |
| `ANTHROPIC_API_KEY` | One of these | Anthropic Claude models |
| `GOOGLE_API_KEY` / `GEMINI_API_KEY` | One of these | Google Gemini models |
| `PERPLEXITY_API_KEY` | One of these | Perplexity Sonar models (built-in web search) |
| `XAI_API_KEY` | One of these | X AI Grok models |
| `GROQ_API_KEY` | One of these | Meta Llama models via Groq |
| `OPENAI_BASE_URL` | No | Custom OpenAI-compatible endpoint (Ollama, LM Studio) |
| `TAVILY_API_KEY` | No | Tavily web search (recommended) |
| `BRAVE_API_KEY` | No | Brave Search (alternative to Tavily) |

Google Drive + Gmail use OAuth2 — no env vars, just `~/.ai-chat/google-credentials.json`.

---

## Code Conventions

- **ESM** throughout — `import` / `export`, no `require` (except inside `fileReader.js` where CJS-only packages like `mammoth` use `createRequire`)
- **`const`** by default; `let` only when reassignment is needed
- **Named async functions** for top-level logic; arrow functions for short callbacks
- **`camelCase`** for variables/functions; **`UPPER_SNAKE_CASE`** for module-level constants
- **Async generators** (`async *`) for streaming — all providers expose a `stream()` method
- **No tests**, **no linter**, **no formatter** — keep consistent with existing style
- **No comments** unless logic is non-obvious

---

## npm Scripts

```bash
npm start     # node chat.js
npm test      # exits with error (no tests configured)
```

---

## Making Changes

- **Add a new AI provider:** Create a new class (or reuse `OpenAICompatibleProvider`) in `lib/providers.js`, add it to `PROVIDERS` and `createProvider`, then detect its env key in `chat.js`
- **Add a new model:** Append to the `models` array in the relevant provider entry inside `PROVIDERS`
- **Add a new file type:** Add a case in `readFileOrUrl()` in `lib/fileReader.js`
- **Add a new command:** Add a handler block in the REPL loop in `chat.js` before the conversational-message section; add it to the `COMMANDS` array and `showHelp()`
- **Change search behavior:** Edit `lib/search.js` — modify `buildSearchContext()` to change what's injected into the prompt
- **Change session storage location:** Update `CONFIG_DIR` constant in `chat.js`
- **Add a new import format:** Add a parser function in `lib/importer.js` and extend the dispatch logic in `importChatFile()`

---

## What Does NOT Exist (avoid adding unless asked)

- No TypeScript — keep plain JavaScript
- No test framework
- No linter / formatter config (ESLint, Prettier)
- No CI/CD
- No React / Express / other frameworks
- No database — sessions are plain JSON files
- No NotebookLM integration — NotebookLM has no public API; users can export notebooks and attach via `/file`
- No Sora integration — Sora is a video-generation model, not a chat model
- No Meta AI direct integration — Llama 3 via Groq provides equivalent open-weights capability
