# CLAUDE.md — AI Assistant Guide

This file documents the codebase structure, conventions, and development workflows for this project.

## Project Overview

A minimal Node.js command-line chat application that provides an interactive multi-turn conversation interface using the OpenAI API. Users select a model at startup and then chat in a terminal REPL loop.

- **Author:** Fred Motta (motta@g.ucla.edu)
- **License:** MIT
- **Node.js minimum:** v14.0+

---

## Repository Structure

```
openai-chat-commandline/
├── chat.js          # Entire application — all logic lives here
├── package.json     # Project metadata, dependencies, npm scripts
├── README.md        # User-facing documentation
├── LICENSE          # MIT license
└── .env             # NOT in repo — must be created locally (see Setup)
```

This is a single-file application. All functionality is in `chat.js` (93 lines).

---

## Tech Stack

| Layer | Technology |
|---|---|
| Runtime | Node.js (v14+) |
| AI API | OpenAI (`openai` ^4.33.0) |
| HTTP | `node-fetch` ^3.3.2 |
| Env vars | `dotenv` ^16.4.5 |
| CLI I/O | Node.js built-in `readline` module |

No build step, no transpilation, no framework. Plain CommonJS modules (`require`).

---

## Setup

1. Install dependencies:
   ```bash
   npm install
   ```

2. Create a `.env` file in the project root:
   ```
   OPENAI_API_KEY=sk-...your-key-here...
   ```

3. Run:
   ```bash
   node chat.js
   # or
   npm run
   ```

---

## Application Flow

```
startup
  └─ selectModel()       # prompts user to pick a model (1–6), defaults to gpt-4o
       └─ chat()          # enters the REPL loop
            ├─ reads user input via readline
            ├─ "exit" / "quit" → closes readline and exits
            ├─ "/clear"  → resets conversationHistory[], loops back
            ├─ empty input → loops back silently
            └─ any other input → getResponse() → prints AI reply → loops back
```

---

## Key Code Details (`chat.js`)

### Constants
- `MODELS` — ordered list of available model IDs (array, line 14–21)
- `conversationHistory` — module-level array holding the full message history for the session
- `selectedModel` — mutable `let`, set during `selectModel()`

### Functions

| Function | Description |
|---|---|
| `getResponse(userInput)` | Pushes user message onto history, calls `openai.chat.completions.create`, appends assistant reply. On error, pops the failed user message and returns a fallback string. |
| `selectModel()` | Returns a Promise; uses `readline.question` to let the user pick a model by number. Invalid or empty input defaults to `MODELS[0]` (`gpt-4o`). |
| `chat()` | Async REPL function; calls itself recursively to maintain the loop. |

### Error Handling
- API errors are caught in `getResponse`, logged via `console.error`, and the failed user message is removed from `conversationHistory` so the next turn is not corrupted.
- No process crash on API failure — the chat loop continues.

---

## Available Models

Defined in `MODELS` array in `chat.js`:
1. `gpt-4o` (default)
2. `gpt-4o-mini`
3. `gpt-4.1`
4. `gpt-4.1-mini`
5. `gpt-4.1-nano`
6. `o3-mini`

To add a new model, append its ID to the `MODELS` array.

---

## Runtime Commands (in-chat)

| Input | Effect |
|---|---|
| `exit` or `quit` | Ends the session |
| `/clear` | Clears `conversationHistory` and continues chatting |
| Empty / whitespace | Ignored, prompts again |

---

## Code Conventions

- **Style:** Modern JavaScript (ES2017+), CommonJS (`require`)
- **Variables:** `const` by default; `let` only for `selectedModel` which is reassigned
- **Functions:** Named async functions; arrow functions for callbacks
- **Naming:** `camelCase` for variables/functions, `UPPER_SNAKE_CASE` for module-level constants
- **No linting or formatting tools** are configured — keep code style consistent with existing file
- **No comments** unless logic is non-obvious; code is intentionally self-documenting
- **No tests** — the test script is a placeholder that exits with an error

---

## npm Scripts

```bash
npm run       # runs: node chat.js
npm test      # exits with error (no tests configured)
```

---

## What Does NOT Exist (avoid adding unless asked)

- No TypeScript — keep plain JavaScript
- No test framework — do not add one unless explicitly requested
- No linter/formatter config — do not add ESLint/Prettier unless explicitly requested
- No CI/CD — no GitHub Actions or similar
- No system prompt / assistant persona — the OpenAI API is called with only the raw conversation history

---

## Environment Variables

| Variable | Required | Description |
|---|---|---|
| `OPENAI_API_KEY` | Yes | OpenAI API key, loaded from `.env` via `dotenv` |

The `.env` file is not committed to the repository. Never commit API keys.

---

## Making Changes

- **Modifying models:** Edit the `MODELS` array in `chat.js`
- **Changing default model:** Change `MODELS[0]` or the fallback in `selectModel()`
- **Adding commands:** Add new `if` branches in the `chat()` function before the `getResponse()` call
- **Changing API behavior:** Edit `getResponse()` — e.g., add `temperature`, `max_tokens`, or `system` message to the API call
- **Dependency updates:** Edit `package.json` and run `npm install`
