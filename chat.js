#!/usr/bin/env node
import 'dotenv/config';
import readline from 'readline';
import fs from 'fs';
import path from 'path';
import os from 'os';
import chalk from 'chalk';
import ora from 'ora';

import { PROVIDERS, createProvider }                          from './lib/providers.js';
import { webSearch, buildSearchContext, isSearchAvailable }  from './lib/search.js';
import { readFileOrUrl }                                     from './lib/fileReader.js';
import { SessionHistory, listSessions, loadSession }        from './lib/history.js';
import { MemoryStore }                                       from './lib/memory.js';
import { UserConfig }                                        from './lib/config.js';
import { importChatFile }                                    from './lib/importer.js';
import {
  printWelcome, selectProviderAndModel, selectSession,
  selectContextSessions, editConfig, showHelp,
}                                                            from './lib/ui.js';
import { select, checkbox }                                  from '@inquirer/prompts';

// ─── Paths ────────────────────────────────────────────────────────────────────

const CONFIG_DIR   = path.join(os.homedir(), '.ai-chat');
const HISTORY_FILE = path.join(CONFIG_DIR, 'prompt_history');
const SESSIONS_DIR = path.join(CONFIG_DIR, 'sessions');

fs.mkdirSync(CONFIG_DIR,   { recursive: true });
fs.mkdirSync(SESSIONS_DIR, { recursive: true });

// ─── Tab completion ───────────────────────────────────────────────────────────

const COMMANDS = [
  '/clear', '/save', '/history', '/context', '/model', '/system ',
  '/file ', '/url ', '/gdrive ', '/gmail ', '/search ',
  '/remember ', '/memory', '/forget ',
  '/import ', '/config', '/tokens', '/help', '/exit', '/quit',
];

function completer(line) {
  const trimmed = line.trimStart();
  if (trimmed.startsWith('/')) {
    const hits = COMMANDS.filter(c => c.startsWith(trimmed));
    return [hits.length ? hits : COMMANDS, line];
  }
  if (/^\/(file|url|import) /.test(trimmed)) {
    const prefix  = trimmed.slice(0, trimmed.indexOf(' ') + 1);
    const partial = trimmed.slice(prefix.length);
    try {
      const dir  = path.dirname(partial) || '.';
      const base = path.basename(partial);
      const hits = fs.readdirSync(dir)
        .filter(f => f.startsWith(base))
        .map(f => {
          const full = dir === '.' ? f : path.join(dir, f);
          try { return prefix + full + (fs.statSync(full).isDirectory() ? '/' : ''); }
          catch { return prefix + full; }
        });
      return [hits, line];
    } catch { return [[], line]; }
  }
  return [[], line];
}

// ─── Streaming helper ─────────────────────────────────────────────────────────

async function streamResponse(provider, history, userMsg, systemPrompt, images) {
  const spinner = ora({ text: chalk.dim('Thinking…'), color: 'cyan' }).start();
  let first = true;
  let full  = '';
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
  } catch (err) { spinner.stop(); throw err; }
  if (!first) process.stdout.write('\n\n');
  return full;
}

// ─── Context sessions formatter ───────────────────────────────────────────────

function buildContextBlock(sessions) {
  if (!sessions.length) return '';
  return sessions.map(s => {
    const msgs = (s.messages || [])
      .slice(-40)           // last 40 messages per session
      .map(m => `${m.role === 'user' ? 'User' : 'AI'}: ${m.content.slice(0, 1000)}`)
      .join('\n');
    return `[Reference session — "${s.title}" (${new Date(s.created).toLocaleDateString()})]\n${msgs}`;
  }).join('\n\n---\n\n');
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  printWelcome();

  const cfg    = new UserConfig();
  const memory = new MemoryStore();

  // Detect which providers have keys
  const available = Object.keys(PROVIDERS).filter(p => {
    const key = PROVIDERS[p].envKey;
    return process.env[key] || (p === 'google' && process.env.GEMINI_API_KEY);
  });

  if (!available.length) {
    console.error(chalk.red(
      'No API keys found.\n' +
      'Add at least one of OPENAI_API_KEY, ANTHROPIC_API_KEY, GOOGLE_API_KEY,\n' +
      'PERPLEXITY_API_KEY, XAI_API_KEY, or GROQ_API_KEY to .env\n'
    ));
    process.exit(1);
  }

  // Greet by name if configured
  const userName = cfg.get('name');
  if (userName) console.log(chalk.bold(`Welcome back, ${userName}!`));
  const memCount = memory.list().length;
  if (memCount) {
    console.log(chalk.dim(`  ${memCount} persistent memories loaded.\n`));
  }

  // Select provider + model (respects saved defaults)
  const { provider: providerName, model } = await selectProviderAndModel(available, cfg);
  let provider = createProvider(providerName, model);

  // Session
  let session          = new SessionHistory(providerName, model, SESSIONS_DIR);
  let systemPrompt     = null;
  let contextSessions  = [];   // previous sessions loaded as reference context
  let memoryCtx        = memory.asContext();   // cached; rebuilt on /remember, /forget
  let contextBlock     = '';                   // cached; rebuilt on /context, /clear

  const searchOn = isSearchAvailable() && cfg.get('autoSearch');
  console.log(
    searchOn
      ? chalk.green(`\nUsing ${chalk.bold(providerName)} / ${chalk.bold(model)}  ·  web search ON`)
      : chalk.yellow(`\nUsing ${chalk.bold(providerName)} / ${chalk.bold(model)}  ·  web search OFF`)
  );
  if (!searchOn && !process.env.TAVILY_API_KEY && !process.env.BRAVE_API_KEY) {
    console.log(chalk.dim('  (Add TAVILY_API_KEY to .env to enable auto web search)'));
  }
  console.log(chalk.dim('  Type /help for all commands.\n'));

  // Load readline prompt history
  let promptHistory = [];
  try {
    promptHistory = fs.readFileSync(HISTORY_FILE, 'utf-8').split('\n').filter(Boolean).slice(-1000);
  } catch { /* ignore */ }

  const rl = readline.createInterface({
    input: process.stdin, output: process.stdout,
    completer, terminal: true, historySize: 1000,
  });
  try { rl.history = [...promptHistory].reverse(); } catch { /* read-only on some Node versions */ }

  rl.on('SIGINT', async () => {
    console.log(chalk.dim('\n\nSaving session…'));
    await session.save();
    console.log(chalk.green('Session saved. Goodbye!\n'));
    rl.close();
    process.exit(0);
  });

  const ask = () => new Promise(resolve => rl.question(chalk.cyan('You: '), resolve));

  // ── REPL loop ──────────────────────────────────────────────────────────────

  while (true) {
    const raw     = await ask();
    const trimmed = raw.trim();
    if (!trimmed) continue;

    // Persist to readline history file
    promptHistory.push(trimmed);
    if (promptHistory.length > 1000) promptHistory = promptHistory.slice(-1000);
    try { fs.writeFileSync(HISTORY_FILE, promptHistory.join('\n') + '\n'); } catch { /* ignore */ }

    // ── Commands ─────────────────────────────────────────────────────────────

    if (trimmed === '/help') { showHelp(); continue; }

    if (trimmed === 'exit' || trimmed === 'quit' || trimmed === '/exit' || trimmed === '/quit') {
      if (cfg.get('autoSave')) {
        console.log(chalk.dim('Saving session…'));
        const file = await session.save();
        console.log(chalk.green(`Saved → ${file}`));
      }
      console.log(chalk.green('Goodbye!\n'));
      rl.close();
      break;
    }

    if (trimmed === '/clear') {
      session.clearMessages();
      systemPrompt    = null;
      contextSessions = [];
      contextBlock    = '';
      console.log(chalk.yellow('Conversation, context, and system prompt cleared.\n'));
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

    // ── Memory commands ───────────────────────────────────────────────────────

    if (trimmed.startsWith('/remember ')) {
      const fact = trimmed.slice(10).trim();
      const id   = memory.add(fact);
      memoryCtx  = memory.asContext();
      console.log(chalk.green(`Memory saved (id: ${id}): ${fact}\n`));
      continue;
    }

    if (trimmed === '/memory') {
      const entries = memory.list();
      if (!entries.length) { console.log(chalk.dim('No memories stored.\n')); continue; }
      console.log(chalk.bold('\nStored memories:'));
      for (const e of entries) {
        console.log(`  ${chalk.cyan(e.id)}  ${e.content}`);
      }
      console.log();
      continue;
    }

    if (trimmed.startsWith('/forget ')) {
      const id  = trimmed.slice(8).trim();
      const ok  = memory.remove(id);
      if (ok) memoryCtx = memory.asContext();
      console.log(ok ? chalk.green(`Removed memory ${id}\n`) : chalk.red(`Memory "${id}" not found.\n`));
      continue;
    }

    // ── Config ────────────────────────────────────────────────────────────────

    if (trimmed === '/config') {
      await editConfig(cfg, available);
      continue;
    }

    // ── Session commands ──────────────────────────────────────────────────────

    if (trimmed === '/history') {
      const sessions = listSessions(SESSIONS_DIR);
      if (!sessions.length) { console.log(chalk.dim('No saved sessions.\n')); continue; }
      const chosen = await selectSession(sessions);
      if (chosen) {
        const loaded = loadSession(chosen, SESSIONS_DIR);
        if (loaded) {
          session  = new SessionHistory(loaded.provider, loaded.model, SESSIONS_DIR, loaded);
          provider = createProvider(loaded.provider, loaded.model);
          console.log(chalk.green(`Loaded: "${loaded.title}" (${loaded.messageCount} messages)\n`));
        }
      }
      continue;
    }

    if (trimmed === '/context') {
      const sessions = listSessions(SESSIONS_DIR);
      if (!sessions.length) { console.log(chalk.dim('No saved sessions to use as context.\n')); continue; }
      const chosen = await selectContextSessions(sessions);
      contextSessions = chosen
        .map(s => loadSession(s, SESSIONS_DIR))
        .filter(Boolean);
      contextBlock = buildContextBlock(contextSessions);
      if (contextSessions.length) {
        console.log(chalk.green(`${contextSessions.length} session(s) loaded as reference context.\n`));
      } else {
        console.log(chalk.dim('No context sessions selected.\n'));
      }
      continue;
    }

    if (trimmed === '/model') {
      const { provider: np, model: nm } = await selectProviderAndModel(available, cfg);
      provider = createProvider(np, nm);
      session.setModel(np, nm);
      console.log(chalk.green(`Switched to ${np} / ${nm}\n`));
      continue;
    }

    if (trimmed.startsWith('/system ')) {
      systemPrompt = trimmed.slice(8).trim();
      console.log(chalk.green('System prompt set.\n'));
      continue;
    }

    // ── Web search (manual) ───────────────────────────────────────────────────

    if (trimmed.startsWith('/search ')) {
      const query = trimmed.slice(8).trim();
      const sp    = ora('Searching…').start();
      try {
        const results = await webSearch(query);
        sp.stop();
        console.log(chalk.bold.blue('\nSearch results:'));
        results.forEach((r, i) => {
          console.log(`\n  ${chalk.bold(`[${i + 1}]`)} ${r.title}`);
          console.log(chalk.dim(`       ${r.url}`));
          if (r.snippet) console.log(`       ${r.snippet.slice(0, 200)}`);
        });
        console.log();
      } catch (err) { sp.stop(); console.log(chalk.red(`Search error: ${err.message}\n`)); }
      continue;
    }

    // ── File / URL attachment ─────────────────────────────────────────────────

    if (trimmed.startsWith('/file ') || trimmed.startsWith('/url ')) {
      const target = trimmed.slice(trimmed.indexOf(' ') + 1).trim();
      const sp     = ora(`Reading ${path.basename(target)}…`).start();
      try {
        const content = await readFileOrUrl(target);
        sp.stop();
        session.addAttachment(target, content);
        const size = typeof content === 'string' ? `${content.length.toLocaleString()} chars` : 'image';
        console.log(chalk.green(`Attached: ${path.basename(target)}  (${size})\n`));
      } catch (err) { sp.stop(); console.log(chalk.red(`Failed: ${err.message}\n`)); }
      continue;
    }

    // ── Google Drive ──────────────────────────────────────────────────────────

    if (trimmed.startsWith('/gdrive ')) {
      const arg = trimmed.slice(8).trim();
      const { searchDrive, readDriveFile } = await import('./lib/google.js');

      // If arg looks like a file ID or URL, read directly; otherwise search
      const isIdOrUrl = arg.startsWith('http') || /^[a-zA-Z0-9_-]{20,}$/.test(arg);
      if (isIdOrUrl) {
        const sp = ora('Reading from Google Drive…').start();
        try {
          const content = await readDriveFile(arg);
          sp.stop();
          session.addAttachment(arg, content);
          console.log(chalk.green(`Attached Google Drive file (${content.length.toLocaleString()} chars)\n`));
        } catch (err) { sp.stop(); console.log(chalk.red(`Drive error: ${err.message}\n`)); }
      } else {
        const sp = ora('Searching Google Drive…').start();
        try {
          const files = await searchDrive(arg, 10);
          sp.stop();
          if (!files.length) { console.log(chalk.dim('No files found.\n')); continue; }
          const choices = files.map(f => ({
            name:  `${f.name}  ${chalk.dim(f.mimeType)}`,
            value: f.id,
          }));
          choices.push({ name: chalk.gray('← Cancel'), value: null });
          const chosen = await select({ message: 'Select a file to attach:', choices });
          if (chosen) {
            const sp2 = ora('Reading…').start();
            try {
              const content = await readDriveFile(chosen);
              sp2.stop();
              session.addAttachment(chosen, content);
              console.log(chalk.green(`Attached (${content.length.toLocaleString()} chars)\n`));
            } catch (err) { sp2.stop(); console.log(chalk.red(`Error: ${err.message}\n`)); }
          }
        } catch (err) { sp.stop(); console.log(chalk.red(`Drive error: ${err.message}\n`)); }
      }
      continue;
    }

    // ── Gmail ─────────────────────────────────────────────────────────────────

    if (trimmed.startsWith('/gmail ')) {
      const query = trimmed.slice(7).trim();
      const { searchGmail, readGmailMessage } = await import('./lib/google.js');
      const sp = ora('Searching Gmail…').start();
      try {
        const msgs = await searchGmail(query, 10);
        sp.stop();
        if (!msgs.length) { console.log(chalk.dim('No messages found.\n')); continue; }
        const choices = msgs.map(m => ({
          name:    `${m.date.slice(0, 16).padEnd(18)}  ${m.from.slice(0, 25).padEnd(27)}  ${m.subject}`,
          value:   m.id,
          checked: false,
        }));
        const chosen = await checkbox({ message: 'Select emails to attach (Space to toggle):', choices });
        for (const id of chosen) {
          const sp2 = ora('Reading email…').start();
          try {
            const content = await readGmailMessage(id);
            sp2.stop();
            session.addAttachment(`gmail:${id}`, content);
            const subj = msgs.find(m => m.id === id)?.subject || id;
            console.log(chalk.green(`Attached: "${subj}"\n`));
          } catch (err) { sp2.stop(); console.log(chalk.red(`Error: ${err.message}\n`)); }
        }
      } catch (err) { sp.stop(); console.log(chalk.red(`Gmail error: ${err.message}\n`)); }
      continue;
    }

    // ── Import ────────────────────────────────────────────────────────────────

    if (trimmed.startsWith('/import ')) {
      const filePath = trimmed.slice(8).trim();
      const sp = ora('Importing…').start();
      try {
        const imported = importChatFile(filePath);
        sp.stop();
        if (!imported.length) { console.log(chalk.yellow('No conversations found in that file.\n')); continue; }
        console.log(chalk.green(`Found ${imported.length} conversation(s).`));

        // Save each as a session
        let saved = 0;
        for (const conv of imported) {
          const s = new SessionHistory(conv.provider, conv.model, SESSIONS_DIR);
          s.created  = conv.created;
          s.messages = conv.messages;
          await s.save();
          saved++;
        }
        console.log(chalk.green(`✓ ${saved} session(s) saved to ${SESSIONS_DIR}\n`));
        console.log(chalk.dim('Use /history to load them or /context to use them as reference.\n'));
      } catch (err) { sp.stop(); console.log(chalk.red(`Import error: ${err.message}\n`)); }
      continue;
    }

    // ── Conversational message ────────────────────────────────────────────────

    // 1. Flush queued attachments
    const attachments = session.flushAttachments();
    const images      = attachments.filter(a => a.content?.type === 'image').map(a => a.content);
    const textAtts    = attachments.filter(a => typeof a.content === 'string');

    // 2. Build stored message content (file text but no search context)
    let historyContent = trimmed;
    if (textAtts.length) {
      historyContent += textAtts.map(a => `\n\n[Attached: ${path.basename(a.name)}]\n${a.content}`).join('');
    }

    // 3. Build effective system prompt (user-set + cached memory + cached context)
    const personalization = cfg.systemAddition();
    let effectiveSystem = '';
    if (personalization) effectiveSystem += personalization;
    if (systemPrompt)    effectiveSystem += systemPrompt;
    if (memoryCtx)       effectiveSystem += memoryCtx;
    if (contextBlock)    effectiveSystem += '\n\n[Reference context from previous sessions:\n' + contextBlock + '\n]';

    // 4. Auto web search
    let searchContext = '';
    let sources       = [];
    if (searchOn) {
      const sp = ora(chalk.dim('Searching web…')).start();
      try {
        const results = await webSearch(trimmed, 5);
        sp.stop();
        if (results.length) {
          sources       = results.map(r => ({ title: r.title, url: r.url }));
          searchContext = buildSearchContext(results);
        }
      } catch { sp.stop(); }
    }

    // 5. Call AI (previous turns in history; current turn = historyContent + search)
    const prevHistory = session.getMessages();
    const apiContent  = historyContent + searchContext;

    let reply;
    try {
      reply = await streamResponse(
        provider, prevHistory, apiContent,
        effectiveSystem || null, images,
      );
    } catch (err) {
      console.log(chalk.red(`Error: ${err.message}\n`));
      continue;
    }

    // 6. Persist clean turn (no search context stored)
    session.addMessage('user',      historyContent, images);
    session.addMessage('assistant', reply);

    // 7. Print source citations
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
