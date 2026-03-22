import { select } from '@inquirer/prompts';
import chalk from 'chalk';
import { PROVIDERS } from './providers.js';

// ─── Welcome banner ───────────────────────────────────────────────────────────

export function printWelcome() {
  console.log(chalk.bold.cyan('\n╔══════════════════════════════════════════════╗'));
  console.log(chalk.bold.cyan('║   AI Chat  —  Multi-provider · Search · Files  ║'));
  console.log(chalk.bold.cyan('╚══════════════════════════════════════════════╝\n'));
}

// ─── Provider / model selection ───────────────────────────────────────────────

export async function selectProviderAndModel(availableProviders) {
  let chosenProvider;

  if (availableProviders.length === 1) {
    chosenProvider = availableProviders[0];
    console.log(chalk.gray(`Provider: ${PROVIDERS[chosenProvider].name}\n`));
  } else {
    chosenProvider = await select({
      message: 'Select AI provider:',
      choices: availableProviders.map(p => ({
        name:  PROVIDERS[p].name,
        value: p,
      })),
    });
  }

  const chosenModel = await select({
    message: `Select ${PROVIDERS[chosenProvider].name} model:`,
    choices: PROVIDERS[chosenProvider].models.map(m => ({
      name:  m.label,
      value: m.id,
    })),
  });

  return { provider: chosenProvider, model: chosenModel };
}

// ─── Session browser ──────────────────────────────────────────────────────────

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

// ─── Help text ────────────────────────────────────────────────────────────────

export function showHelp() {
  const col = (s, w) => s.padEnd(w);

  const commands = [
    ['/help',            'Show this help'],
    ['/clear',           'Clear conversation (start fresh)'],
    ['/save',            'Save session to disk now'],
    ['/history',         'Browse and reload a saved session'],
    ['/model',           'Switch provider / model mid-session'],
    ['/system <text>',   'Set a system prompt (persists until /clear)'],
    ['/file <path>',     'Attach a file (PDF, Word, PPTX, image, audio, text…)'],
    ['/url <url>',       'Attach a URL, Google Doc, or Google Sheet'],
    ['/search <query>',  'Run a manual web search and print results'],
    ['/tokens',          'Estimate tokens currently in context'],
    ['exit  /  quit',    'Save session and exit'],
  ];

  console.log(chalk.bold('\n  Commands'));
  console.log(chalk.dim('  ' + '─'.repeat(60)));
  for (const [cmd, desc] of commands) {
    console.log(`  ${chalk.cyan(col(cmd, 22))} ${desc}`);
  }

  console.log(chalk.bold('\n  Supported file types'));
  console.log(chalk.dim('  ' + '─'.repeat(60)));
  const types = [
    ['Text / code', '.txt  .md  .js  .py  .json  .csv  .html  … (any UTF-8)'],
    ['PDF',         '.pdf — text extracted via pdf-parse'],
    ['Word',        '.docx — text extracted via mammoth'],
    ['PowerPoint',  '.pptx — slide text extracted'],
    ['Images',      '.jpg  .jpeg  .png  .gif  .webp  (vision models)'],
    ['Audio',       '.mp3  .wav  .m4a  .ogg  … (transcribed via Whisper)'],
    ['URLs',        'https://… — page text extracted'],
    ['Google Docs', 'docs.google.com/document/… — exported as text'],
    ['Google Sheets','docs.google.com/spreadsheets/… — exported as CSV'],
  ];
  for (const [type, detail] of types) {
    console.log(`  ${chalk.yellow(col(type, 14))} ${chalk.dim(detail)}`);
  }

  console.log(chalk.bold('\n  Keyboard'));
  console.log(chalk.dim('  ' + '─'.repeat(60)));
  console.log(`  ${chalk.cyan('↑ / ↓')}          Browse prompt history`);
  console.log(`  ${chalk.cyan('Tab')}             Complete commands and file paths`);
  console.log();
}
