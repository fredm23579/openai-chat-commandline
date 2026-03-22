#!/usr/bin/env node
import 'dotenv/config';
import readline from 'readline';
import fs from 'fs';
import path from 'path';
import os from 'os';
import chalk from 'chalk';
import ora from 'ora';

import { PROVIDERS, createProvider }          from './lib/providers.js';
import { webSearch, buildSearchContext, isSearchAvailable } from './lib/search.js';
import { readFileOrUrl }                       from './lib/fileReader.js';
import { SessionHistory, listSessions, loadSession } from './lib/history.js';
import { printWelcome, selectProviderAndModel, selectSession, showHelp } from './lib/ui.js';

// ─── Paths ────────────────────────────────────────────────────────────────────

const CONFIG_DIR   = path.join(os.homedir(), '.ai-chat');
const HISTORY_FILE = path.join(CONFIG_DIR, 'prompt_history');
const SESSIONS_DIR = path.join(CONFIG_DIR, 'sessions');

fs.mkdirSync(CONFIG_DIR,   { recursive: true });
fs.mkdirSync(SESSIONS_DIR, { recursive: true });

// ─── Tab completion ───────────────────────────────────────────────────────────

const COMMANDS = [
  '/clear', '/save', '/history', '/model', '/system ',
  '/file ', '/url ', '/search ', '/tokens', '/help', '/exit', '/quit',
];

function completer(line) {
  const trimmed = line.trimStart();

  // Command completion
  if (trimmed.startsWith('/')) {
    const hits = COMMANDS.filter(c => c.startsWith(trimmed));
    return [hits.length ? hits : COMMANDS, line];
  }

  // File-path completion after /file or /url
  if (/^\/(file|url) /.test(trimmed)) {
    const prefix  = trimmed.slice(0, trimmed.indexOf(' ') + 1);
    const partial = trimmed.slice(prefix.length);
    try {
      const dir   = path.dirname(partial) || '.';
      const base  = path.basename(partial);
      const hits  = fs.readdirSync(dir)
        .filter(f => f.startsWith(base))
        .map(f => {
          const full = dir === '.' ? f : path.join(dir, f);
          return prefix + full + (fs.statSync(full).isDirectory() ? '/' : '');
        });
      return [hits, line];
    } catch { return [[], line]; }
  }

  return [[], line];
}

// ─── Streaming helper ─────────────────────────────────────────────────────────

async function streamResponse(provider, history, userMsg, systemPrompt, images) {
  const spinner = ora({ text: chalk.dim('Thinking…'), color: 'cyan' }).start();
  let first     = true;
  let full      = '';

  try {
    for await (const chunk of provider.stream(history, userMsg, systemPrompt, images)) {
      if (first) {
        spinner.stop();
        process.stdout.clearLine?.(0);
        process.stdout.cursorTo?.(0);
        process.stdout.write(chalk.yellow('AI: '));
        first = false;
      }
      process.stdout.write(chunk);
      full += chunk;
    }
  } catch (err) {
    spinner.stop();
    throw err;
  }

  if (!first) process.stdout.write('\n\n');
  return full;
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  printWelcome();

  // Detect which providers have keys
  const available = Object.keys(PROVIDERS).filter(p => {
    const key = PROVIDERS[p].envKey;
    // Google supports two env var names
    return process.env[key] || (p === 'google' && process.env.GEMINI_API_KEY);
  });

  if (!available.length) {
    console.error(chalk.red(
      'No API keys found.\n' +
      'Add at least one of OPENAI_API_KEY, ANTHROPIC_API_KEY, or GOOGLE_API_KEY to .env\n'
    ));
    process.exit(1);
  }

  // Select provider + model
  const { provider: providerName, model } = await selectProviderAndModel(available);
  let provider = createProvider(providerName, model);

  // Session
  let session     = new SessionHistory(providerName, model, SESSIONS_DIR);
  let systemPrompt = null;

  // Search availability notice
  const searchOn = isSearchAvailable();
  console.log(
    searchOn
      ? chalk.green(`\nUsing ${chalk.bold(providerName)} / ${chalk.bold(model)}  ·  web search ON`)
      : chalk.yellow(`\nUsing ${chalk.bold(providerName)} / ${chalk.bold(model)}  ·  web search OFF (add TAVILY_API_KEY)`)
  );
  console.log(chalk.dim('Type /help for commands.\n'));

  // Load and set up readline prompt history
  let promptHistory = [];
  try {
    if (fs.existsSync(HISTORY_FILE)) {
      promptHistory = fs.readFileSync(HISTORY_FILE, 'utf-8').split('\n').filter(Boolean).slice(-1000);
    }
  } catch { /* ignore */ }

  const rl = readline.createInterface({
    input:       process.stdin,
    output:      process.stdout,
    completer,
    terminal:    true,
    historySize: 1000,
  });

  // Pre-load saved history so ↑/↓ works from the start
  try { rl.history = [...promptHistory].reverse(); } catch { /* read-only on some versions */ }

  // Graceful Ctrl-C
  rl.on('SIGINT', async () => {
    console.log(chalk.dim('\n\nSaving session…'));
    await session.save();
    console.log(chalk.green('Session saved. Goodbye!\n'));
    rl.close();
    process.exit(0);
  });

  // ── REPL loop ──────────────────────────────────────────────────────────────

  const ask = () => new Promise(resolve => rl.question(chalk.cyan('You: '), resolve));

  while (true) {
    const raw     = await ask();
    const trimmed = raw.trim();
    if (!trimmed) continue;

    // Persist to prompt history file
    promptHistory.push(trimmed);
    try { fs.writeFileSync(HISTORY_FILE, promptHistory.slice(-1000).join('\n') + '\n'); } catch { /* ignore */ }

    // ── Built-in commands ────────────────────────────────────────────────────

    if (trimmed === '/help') { showHelp(); continue; }

    if (trimmed === 'exit' || trimmed === 'quit' || trimmed === '/exit' || trimmed === '/quit') {
      console.log(chalk.dim('Saving session…'));
      const file = await session.save();
      console.log(chalk.green(`Session saved → ${file}\nGoodbye!\n`));
      rl.close();
      break;
    }

    if (trimmed === '/clear') {
      session.clearMessages();
      systemPrompt = null;
      console.log(chalk.yellow('Conversation cleared.\n'));
      continue;
    }

    if (trimmed === '/save') {
      const file = await session.save();
      console.log(chalk.green(`Saved → ${file}\n`));
      continue;
    }

    if (trimmed === '/tokens') {
      console.log(chalk.dim(`~${session.estimateTokens()} tokens in context\n`));
      continue;
    }

    if (trimmed === '/history') {
      const sessions = listSessions(SESSIONS_DIR);
      if (!sessions.length) { console.log(chalk.dim('No saved sessions.\n')); continue; }
      const chosen = await selectSession(sessions);
      if (chosen) {
        const loaded = loadSession(chosen, SESSIONS_DIR);
        if (loaded) {
          session  = new SessionHistory(loaded.provider, loaded.model, SESSIONS_DIR, loaded);
          provider = createProvider(loaded.provider, loaded.model);
          console.log(chalk.green(`Loaded: ${loaded.title}  (${loaded.messageCount} messages)\n`));
        }
      }
      continue;
    }

    if (trimmed === '/model') {
      const { provider: newProvider, model: newModel } = await selectProviderAndModel(available);
      provider = createProvider(newProvider, newModel);
      session.setModel(newProvider, newModel);
      console.log(chalk.green(`Switched to ${newProvider} / ${newModel}\n`));
      continue;
    }

    if (trimmed.startsWith('/system ')) {
      systemPrompt = trimmed.slice(8).trim();
      console.log(chalk.green('System prompt set.\n'));
      continue;
    }

    if (trimmed.startsWith('/search ')) {
      const query   = trimmed.slice(8).trim();
      const spinner = ora('Searching…').start();
      try {
        const results = await webSearch(query);
        spinner.stop();
        console.log(chalk.bold.blue('\nSearch results:'));
        results.forEach((r, i) => {
          console.log(`\n  ${chalk.bold(`[${i + 1}]`)} ${r.title}`);
          console.log(chalk.dim(`       ${r.url}`));
          if (r.snippet) console.log(`       ${r.snippet.slice(0, 200)}`);
        });
        console.log();
      } catch (err) {
        spinner.stop();
        console.log(chalk.red(`Search error: ${err.message}\n`));
      }
      continue;
    }

    if (trimmed.startsWith('/file ') || trimmed.startsWith('/url ')) {
      const target  = trimmed.slice(trimmed.indexOf(' ') + 1).trim();
      const spinner = ora(`Reading ${path.basename(target)}…`).start();
      try {
        const content = await readFileOrUrl(target);
        spinner.stop();
        session.addAttachment(target, content);
        const size = typeof content === 'string' ? `${content.length.toLocaleString()} chars` : 'image';
        console.log(chalk.green(`Attached: ${path.basename(target)}  (${size})\n`));
      } catch (err) {
        spinner.stop();
        console.log(chalk.red(`Failed to read "${target}": ${err.message}\n`));
      }
      continue;
    }

    // ── Conversational message ────────────────────────────────────────────────

    // 1. Flush queued attachments
    const attachments = session.flushAttachments();
    const images      = attachments.filter(a => a.content?.type === 'image').map(a => a.content);
    const textAtts    = attachments.filter(a => typeof a.content === 'string');

    // 2. Build the full user message stored in history (includes file text, no search)
    let historyContent = trimmed;
    if (textAtts.length) {
      historyContent += textAtts
        .map(a => `\n\n[Attached: ${path.basename(a.name)}]\n${a.content}`)
        .join('');
    }

    // 3. Auto web search
    let searchContext = '';
    let sources       = [];

    if (searchOn) {
      const s = ora(chalk.dim('Searching web…')).start();
      try {
        const results = await webSearch(trimmed, 5);
        s.stop();
        if (results.length) {
          sources       = results.map(r => ({ title: r.title, url: r.url }));
          searchContext = buildSearchContext(results);
        }
      } catch { s.stop(); }
    }

    // 4. Call the AI (history = previous turns; full content sent to API)
    const prevHistory = session.getMessages();
    const apiContent  = historyContent + searchContext;

    let reply;
    try {
      reply = await streamResponse(provider, prevHistory, apiContent, systemPrompt, images);
    } catch (err) {
      console.log(chalk.red(`Error: ${err.message}\n`));
      continue;
    }

    // 5. Persist the clean turn (no search context in stored history)
    session.addMessage('user',      historyContent, images);
    session.addMessage('assistant', reply);

    // 6. Print source citations
    if (sources.length) {
      console.log(chalk.dim('─'.repeat(55)));
      console.log(chalk.bold.blue('Sources:'));
      sources.forEach((s, i) => {
        console.log(`  ${chalk.blue(`[${i + 1}]`)} ${s.title}`);
        console.log(chalk.dim(`       ${s.url}`));
      });
      console.log();
    }
  }
}

main().catch(err => {
  console.error(chalk.red('\nFatal error:'), err.message);
  process.exit(1);
});
