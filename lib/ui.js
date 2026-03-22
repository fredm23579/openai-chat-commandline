import { select, checkbox, input } from '@inquirer/prompts';
import chalk from 'chalk';
import { PROVIDERS } from './providers.js';

// ─── Welcome banner ───────────────────────────────────────────────────────────

export function printWelcome() {
  console.log(chalk.bold.cyan('\n╔══════════════════════════════════════════════╗'));
  console.log(chalk.bold.cyan('║   AI Chat  —  Multi-provider · Search · Files  ║'));
  console.log(chalk.bold.cyan('╚══════════════════════════════════════════════╝\n'));
}

// ─── Provider / model selection ───────────────────────────────────────────────

export async function selectProviderAndModel(availableProviders, cfg = null) {
  let chosenProvider;

  // Use saved default if set and still available
  const savedProvider = cfg?.get('defaultProvider');
  if (savedProvider && availableProviders.includes(savedProvider)) {
    chosenProvider = savedProvider;
    console.log(chalk.dim(`Provider: ${PROVIDERS[chosenProvider].name} (default)\n`));
  } else if (availableProviders.length === 1) {
    chosenProvider = availableProviders[0];
    console.log(chalk.dim(`Provider: ${PROVIDERS[chosenProvider].name}\n`));
  } else {
    chosenProvider = await select({
      message: 'Select AI provider:',
      choices: availableProviders.map(p => ({ name: PROVIDERS[p].name, value: p })),
    });
  }

  const savedModel = cfg?.get('defaultModel');
  const validModel = PROVIDERS[chosenProvider].models.find(m => m.id === savedModel);

  let chosenModel;
  if (validModel) {
    chosenModel = validModel.id;
    console.log(chalk.dim(`Model:    ${validModel.label} (default)\n`));
  } else {
    chosenModel = await select({
      message: `Select ${PROVIDERS[chosenProvider].name} model:`,
      choices: PROVIDERS[chosenProvider].models.map(m => ({ name: m.label, value: m.id })),
    });
  }

  return { provider: chosenProvider, model: chosenModel };
}

// ─── Session browser (single-select) ─────────────────────────────────────────

export async function selectSession(sessions) {
  const choices = sessions.slice(0, 25).map(s => {
    const date = new Date(s.updated).toLocaleString();
    return {
      name:  `${date}  ${chalk.bold(s.title.slice(0, 45).padEnd(45))}  [${s.provider}/${s.model}]  ${s.messageCount} msgs`,
      value: s,
    };
  });
  choices.push({ name: chalk.gray('← Cancel'), value: null });
  return select({ message: 'Load a saved session:', choices });
}

// ─── Context picker (multi-select) ───────────────────────────────────────────

export async function selectContextSessions(sessions) {
  if (!sessions.length) return [];
  const choices = sessions.slice(0, 25).map(s => {
    const date = new Date(s.updated).toLocaleString();
    return {
      name:    `${date}  ${s.title.slice(0, 50).padEnd(50)}  [${s.provider}/${s.model}]`,
      value:   s,
      checked: false,
    };
  });
  return checkbox({ message: 'Select sessions to add as reference context (Space to toggle):', choices });
}

// ─── Config editor ────────────────────────────────────────────────────────────

export async function editConfig(cfg, availableProviders) {
  const field = await select({
    message: 'Which setting do you want to change?',
    choices: [
      { name: `name            "${cfg.get('name') || '(not set)'}"`,            value: 'name'            },
      { name: `defaultProvider "${cfg.get('defaultProvider') || '(ask each time)'}"`, value: 'defaultProvider' },
      { name: `defaultModel    "${cfg.get('defaultModel') || '(ask each time)'}"`,    value: 'defaultModel'    },
      { name: `autoSearch      ${cfg.get('autoSearch')}`,                         value: 'autoSearch'      },
      { name: `autoSave        ${cfg.get('autoSave')}`,                           value: 'autoSave'        },
      { name: chalk.gray('← Cancel'),                                             value: null              },
    ],
  });
  if (!field) return;

  if (field === 'name') {
    const val = await input({ message: 'Your name:', default: cfg.get('name') });
    cfg.set('name', val.trim());
  } else if (field === 'defaultProvider') {
    const val = await select({
      message: 'Default provider (empty = ask each time):',
      choices: [
        { name: '(ask each time)', value: '' },
        ...availableProviders.map(p => ({ name: PROVIDERS[p].name, value: p })),
      ],
    });
    cfg.set('defaultProvider', val);
    cfg.set('defaultModel', ''); // reset model when provider changes
  } else if (field === 'defaultModel') {
    const provider = cfg.get('defaultProvider');
    if (!provider) { console.log(chalk.yellow('Set a defaultProvider first.\n')); return; }
    const val = await select({
      message: 'Default model:',
      choices: [
        { name: '(ask each time)', value: '' },
        ...PROVIDERS[provider].models.map(m => ({ name: m.label, value: m.id })),
      ],
    });
    cfg.set('defaultModel', val);
  } else if (field === 'autoSearch' || field === 'autoSave') {
    const val = await select({
      message: `${field}:`,
      choices: [{ name: 'true', value: true }, { name: 'false', value: false }],
    });
    cfg.set(field, val);
  }

  console.log(chalk.green(`✓ ${field} updated.\n`));
}

// ─── Help text ────────────────────────────────────────────────────────────────

export function showHelp() {
  const col = (s, w) => s.padEnd(w);

  const commands = [
    ['── Conversation ─────────────────────────────────────────────────────────', ''],
    ['/help',                   'Show this help'],
    ['/clear',                  'Clear conversation (start fresh)'],
    ['/save',                   'Save session to disk now'],
    ['/tokens',                 'Estimate tokens currently in context'],
    ['/model',                  'Switch provider / model mid-session'],
    ['/system <text>',          'Set or replace the system prompt'],
    ['exit  /  quit',           'Save session and exit'],
    ['── Sessions & Context ──────────────────────────────────────────────────', ''],
    ['/history',                'Browse and reload a saved session'],
    ['/context',                'Pick previous sessions as reference context'],
    ['── Memory & Personalization ────────────────────────────────────────────', ''],
    ['/remember <fact>',        'Store a persistent fact about you'],
    ['/memory',                 'List all stored memories'],
    ['/forget <id>',            'Delete a specific memory by id'],
    ['/config',                 'Edit name, default provider/model, and settings'],
    ['── Files & Web ─────────────────────────────────────────────────────────', ''],
    ['/file <path>',            'Attach a file (PDF, Word, PPTX, image, audio…)'],
    ['/url <url>',              'Attach a URL, Google Doc, or Google Sheet'],
    ['/gdrive <query|id>',      'Search or attach a Google Drive file'],
    ['/gmail <query>',          'Search Gmail and attach selected emails'],
    ['/search <query>',         'Run a manual web search and print results'],
    ['── Import ──────────────────────────────────────────────────────────────', ''],
    ['/import <file>',          'Import chat history (ChatGPT / Claude / Gemini / JSON / Markdown)'],
  ];

  console.log(chalk.bold('\n  Commands'));
  for (const [cmd, desc] of commands) {
    if (!desc) { console.log(chalk.dim('\n  ' + cmd)); continue; }
    console.log(`  ${chalk.cyan(col(cmd, 24))} ${desc}`);
  }

  console.log(chalk.bold('\n  Supported file types'));
  console.log(chalk.dim('  ' + '─'.repeat(70)));
  const types = [
    ['Text / code',    '.txt  .md  .js  .py  .json  .csv  .html  … (any UTF-8)'],
    ['PDF',            '.pdf — text extracted (local or URL)'],
    ['Word',           '.docx — text extracted via mammoth'],
    ['PowerPoint',     '.pptx — slide text extracted'],
    ['Images',         '.jpg  .jpeg  .png  .gif  .webp  (vision models)'],
    ['Audio',          '.mp3  .wav  .m4a  .ogg  … (transcribed via Whisper)'],
    ['URLs',           'https://… — page text extracted'],
    ['Google Docs',    'docs.google.com/document/… (public export or /gdrive OAuth)'],
    ['Google Sheets',  'docs.google.com/spreadsheets/… (public export or /gdrive OAuth)'],
    ['Google Drive',   '/gdrive — any Drive file via OAuth2 (requires credentials)'],
    ['Gmail',          '/gmail — search & attach emails (requires credentials)'],
  ];
  for (const [type, detail] of types) {
    console.log(`  ${chalk.yellow(col(type, 16))} ${chalk.dim(detail)}`);
  }

  console.log(chalk.bold('\n  Keyboard'));
  console.log(chalk.dim('  ' + '─'.repeat(70)));
  console.log(`  ${chalk.cyan('↑ / ↓')}          Browse prompt history`);
  console.log(`  ${chalk.cyan('Tab')}             Complete commands and file paths`);
  console.log();
}
