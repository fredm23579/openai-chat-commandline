# CLAUDE.md — AI Assistant Guide

This file documents the codebase structure, conventions, and development workflows for AI assistants working in this repository.

## Project Overview

A Node.js command-line chat application supporting **multiple AI providers**, **automatic web search with cited sources**, **file and URL attachments** (PDF, Word, images, audio, …), **persistent session history**, and an interactive REPL with prompt history and tab completion.

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
│   ├── providers.js     # AI provider abstraction (OpenAI, Anthropic, Google Gemini)
│   ├── search.js        # Web search (Tavily, Brave Search) + context injection
│   ├── fileReader.js    # File / URL reading (PDF, Word, PPTX, images, audio, URLs)
│   ├── history.js       # Persistent session storage and management
│   └── ui.js            # Inquirer menus, chalk styling, help text
├── package.json         # ESM project, dependencies, npm scripts
├── .env.example         # Template for all supported API keys
├── README.md            # User-facing documentation
└── LICENSE              # MIT license
```

Sessions are stored in `~/.ai-chat/sessions/` (JSON files).
Prompt history is stored in `~/.ai-chat/prompt_history`.

---

## Tech Stack

| Layer | Technology |
|---|---|
| Runtime | Node.js v18+ (ESM) |
| OpenAI | `openai` ^4.85.0 |
| Anthropic | `@anthropic-ai/sdk` ^0.39.0 |
| Google | `@google/generative-ai` ^0.24.0 |
| CLI menus | `inquirer` ^10 (`@inquirer/prompts`) |
| Styling | `chalk` ^5, `ora` ^8 |
| PDF | `pdf-parse` ^1.1.1 |
| Word docs | `mammoth` ^1.8.0 |
| PowerPoint | `adm-zip` ^0.5.16 (zip/XML extraction) |
| HTML → text | `html-to-text` ^9 |
| HTTP | `node-fetch` ^3.3.2 |
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
   At minimum, set one of `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, or `GOOGLE_API_KEY`.

3. (Recommended) Add a search key for automatic web search:
   ```
   TAVILY_API_KEY=tvly-...   # https://tavily.com — generous free tier
   ```

4. Run:
   ```bash
   node chat.js
   # or
   npm start
   ```

---

## Application Flow

```
startup
  ├─ detect available providers from env vars
  └─ selectProviderAndModel()      # inquirer list menus
       └─ REPL while-loop
            ├─ readline.question() with tab completion + history
            ├─ command handlers (/help, /clear, /save, /history, /model, …)
            ├─ /file <path> → readFileOrUrl() → addAttachment()
            ├─ /url <url>  → readFileOrUrl() → addAttachment()
            └─ conversational input:
                 ├─ flushAttachments()        # pick up queued files
                 ├─ webSearch()               # auto-search (if key set)
                 ├─ buildSearchContext()      # format results for injection
                 ├─ provider.stream()         # streaming response
                 ├─ session.addMessage()      # persist clean turn
                 └─ print sources            # cited URLs below reply
```

---

## Key Module Details

### `lib/providers.js`

- **`PROVIDERS`** — catalogue of all available models per provider; used by the UI menu
- Each provider class (`OpenAIProvider`, `AnthropicProvider`, `GeminiProvider`) exposes:
  - `async *stream(history, userText, systemPrompt, images)` — async generator that yields text chunks
- **`createProvider(name, model)`** — factory; returns the correct provider instance
- `OPENAI_BASE_URL` env var supported for local / compatible endpoints (Ollama, LM Studio)
- Image attachments are passed as `[{ type: 'image', mimeType, data (base64), name }]` and translated to each provider's native vision format

### `lib/search.js`

- **`webSearch(query, maxResults=5)`** — dispatches to Tavily (preferred) or Brave Search
- **`buildSearchContext(results)`** — returns a formatted string block injected into the AI prompt, instructing the model to cite sources with `[1]`, `[2]`, … notation
- **`isSearchAvailable()`** — returns `true` if any search key is configured
- Search results are appended to the **API call** but NOT stored in `SessionHistory` (keeps history clean for future turns)

### `lib/fileReader.js`

- **`readFileOrUrl(target)`** — single public function; dispatches by extension or URL pattern
- Returns either a string (text content) or `{ type: 'image', mimeType, data, name }` for image files
- Expands `~/` in paths; handles `http://` / `https://` URLs
- Google Docs and Sheets are fetched via their public export URLs (no OAuth required)
- Audio files are transcribed via OpenAI Whisper (requires `OPENAI_API_KEY`)
- URL fetches are capped at 60 000 chars to avoid blowing the context window

### `lib/history.js`

- **`SessionHistory`** — stores messages in memory, persists to `~/.ai-chat/sessions/<uuid>.json`
  - `addMessage(role, content, images)` — adds a turn; images are stored in the JSON
  - `addAttachment(name, content)` / `flushAttachments()` — pending file queue
  - `getMessages()` — returns history array for passing to providers
  - `estimateTokens()` — rough token count (~4 chars per token)
  - `save()` — writes JSON and returns file path
- **`listSessions(dir)`** — returns metadata array sorted by last-updated date
- **`loadSession(info, dir)`** — reads and parses a session file

### `lib/ui.js`

- **`printWelcome()`** — banner
- **`selectProviderAndModel(available)`** — runs two `@inquirer/prompts` `select` calls
- **`selectSession(sessions)`** — paginated session browser (up to 25 sessions)
- **`showHelp()`** — formatted command and file-type reference

### `chat.js`

- Module-level constants: `CONFIG_DIR`, `HISTORY_FILE`, `SESSIONS_DIR`, `COMMANDS`
- `completer(line)` — readline tab-completion for commands and file paths
- `streamResponse(provider, history, userMsg, systemPrompt, images)` — drives the async generator, clears the spinner on first chunk, writes tokens to stdout, returns full string
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

To add a model, append to the `models` array inside `PROVIDERS` in `lib/providers.js`.

---

## Runtime Commands

| Input | Effect |
|---|---|
| `/help` | Print command reference |
| `/clear` | Clear conversation history and system prompt |
| `/save` | Save current session to disk immediately |
| `/history` | Browse saved sessions; select one to load |
| `/model` | Switch provider / model mid-session |
| `/system <text>` | Set a system prompt (persists until `/clear`) |
| `/file <path>` | Attach a local file to the next message |
| `/url <url>` | Attach a URL / Google Doc to the next message |
| `/search <query>` | Run a standalone web search (prints results, no AI call) |
| `/tokens` | Show estimated token count in context |
| `exit` / `quit` | Auto-save and exit |

---

## Environment Variables

| Variable | Required | Description |
|---|---|---|
| `OPENAI_API_KEY` | One of these | OpenAI models |
| `ANTHROPIC_API_KEY` | One of these | Anthropic Claude models |
| `GOOGLE_API_KEY` / `GEMINI_API_KEY` | One of these | Google Gemini models |
| `OPENAI_BASE_URL` | No | Custom OpenAI-compatible endpoint (Ollama, LM Studio) |
| `TAVILY_API_KEY` | No | Tavily web search (recommended) |
| `BRAVE_API_KEY` | No | Brave Search (alternative to Tavily) |

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

- **Add a new AI provider:** Create a new class in `lib/providers.js`, add it to `PROVIDERS` and the `createProvider` switch, then detect its env key in `chat.js`
- **Add a new model:** Append to the `models` array in the relevant provider entry inside `PROVIDERS`
- **Add a new file type:** Add a case in `readFileOrUrl()` in `lib/fileReader.js`
- **Add a new command:** Add a handler block in the REPL loop in `chat.js` before the conversational-message section
- **Change search behavior:** Edit `lib/search.js` — modify `buildSearchContext()` to change what's injected into the prompt
- **Change session storage location:** Update `CONFIG_DIR` constant in `chat.js`

---

## What Does NOT Exist (avoid adding unless asked)

- No TypeScript — keep plain JavaScript
- No test framework
- No linter / formatter config (ESLint, Prettier)
- No CI/CD
- No React / Express / other frameworks
- No database — sessions are plain JSON files
