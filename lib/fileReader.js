import fs from 'fs';
import path from 'path';
import os from 'os';
import { createRequire } from 'module';
import fetch from 'node-fetch';
import { htmlToText } from 'html-to-text';

const require = createRequire(import.meta.url);

// ─── Type maps ────────────────────────────────────────────────────────────────

const IMAGE_EXT = new Set(['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp']);
const AUDIO_EXT = new Set(['.mp3', '.mp4', '.wav', '.m4a', '.ogg', '.webm', '.flac']);
const MIME = {
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png',
  '.gif': 'image/gif',  '.webp': 'image/webp', '.bmp': 'image/bmp',
};

// ─── Local file readers ───────────────────────────────────────────────────────

function readImage(filePath) {
  const ext  = path.extname(filePath).toLowerCase();
  const data = fs.readFileSync(filePath).toString('base64');
  return { type: 'image', mimeType: MIME[ext] || 'image/jpeg', data, name: path.basename(filePath) };
}

async function readAudio(filePath) {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error('OPENAI_API_KEY is required for audio transcription (Whisper)');
  }
  const { default: OpenAI } = await import('openai');
  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const transcription = await client.audio.transcriptions.create({
    file:  fs.createReadStream(filePath),
    model: 'whisper-1',
  });
  return `[Audio transcription — ${path.basename(filePath)}]\n${transcription.text}`;
}

async function readPdf(filePath) {
  // Use lib path to skip the test-data side-effect on import
  const pdfParse = (await import('pdf-parse/lib/pdf-parse.js').catch(() => import('pdf-parse'))).default;
  const buffer = fs.readFileSync(filePath);
  const data   = await pdfParse(buffer);
  return `[PDF — ${path.basename(filePath)}, ${data.numpages} pages]\n\n${data.text}`;
}

async function readDocx(filePath) {
  const mammoth = require('mammoth');
  const result  = await mammoth.extractRawText({ path: filePath });
  return `[Word document — ${path.basename(filePath)}]\n\n${result.value}`;
}

async function readPptx(filePath) {
  let AdmZip;
  try { AdmZip = (await import('adm-zip')).default; }
  catch { throw new Error('adm-zip is required for PPTX reading. Run: npm install adm-zip'); }

  const zip     = new AdmZip(filePath);
  const entries = zip.getEntries()
    .filter(e => /^ppt\/slides\/slide\d+\.xml$/.test(e.entryName))
    .sort((a, b) => a.entryName.localeCompare(b.entryName));

  const slides = entries.map((e, i) => {
    const xml   = e.getData().toString('utf-8');
    const texts = [...xml.matchAll(/<a:t[^>]*>([^<]+)<\/a:t>/g)].map(m => m[1]);
    return `[Slide ${i + 1}]\n${texts.join(' ')}`;
  });

  return `[PowerPoint — ${path.basename(filePath)}, ${slides.length} slides]\n\n${slides.join('\n\n')}`;
}

// ─── URL reader ───────────────────────────────────────────────────────────────

async function readUrl(url) {
  // Google Docs → export as plain text
  const docsMatch = url.match(/docs\.google\.com\/document\/d\/([^/]+)/);
  if (docsMatch) {
    const exportUrl = `https://docs.google.com/document/d/${docsMatch[1]}/export?format=txt`;
    const res = await fetchWithTimeout(exportUrl);
    if (res.ok) return `[Google Doc — ${url}]\n\n${await res.text()}`;
  }

  // Google Sheets → export as CSV
  const sheetMatch = url.match(/docs\.google\.com\/spreadsheets\/d\/([^/]+)/);
  if (sheetMatch) {
    const exportUrl = `https://docs.google.com/spreadsheets/d/${sheetMatch[1]}/export?format=csv`;
    const res = await fetchWithTimeout(exportUrl);
    if (res.ok) return `[Google Sheet — ${url}]\n\n${await res.text()}`;
  }

  // Generic URL fetch
  const res = await fetchWithTimeout(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (compatible; ai-chat-cli/2.0)',
      Accept: 'text/html,application/xhtml+xml,text/plain,*/*',
    },
  });

  if (!res.ok) throw new Error(`HTTP ${res.status} — ${res.statusText}`);

  const contentType = res.headers.get('content-type') || '';

  if (contentType.includes('application/pdf')) {
    const pdfParse = (await import('pdf-parse/lib/pdf-parse.js').catch(() => import('pdf-parse'))).default;
    const buf  = Buffer.from(await res.arrayBuffer());
    const data = await pdfParse(buf);
    return `[PDF from ${url}, ${data.numpages} pages]\n\n${data.text}`;
  }

  if (contentType.includes('text/html')) {
    const html = await res.text();
    const text = htmlToText(html, {
      wordwrap: false,
      selectors: [
        { selector: 'script', format: 'skip' },
        { selector: 'style',  format: 'skip' },
        { selector: 'nav',    format: 'skip' },
        { selector: 'footer', format: 'skip' },
        { selector: 'a',      options: { ignoreHref: true } },
        { selector: 'img',    format: 'skip' },
      ],
    });
    // Cap at 60 k chars to avoid blowing the context window
    return `[Web page — ${url}]\n\n${text.slice(0, 60_000)}`;
  }

  return `[Content from ${url}]\n\n${(await res.text()).slice(0, 60_000)}`;
}

function fetchWithTimeout(url, options = {}, ms = 12_000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  return fetch(url, { ...options, signal: controller.signal }).finally(() => clearTimeout(timer));
}

// ─── Public dispatcher ────────────────────────────────────────────────────────

/**
 * Read a local file or remote URL and return either:
 *   • a string  (text content ready to inject)
 *   • an object { type: 'image', mimeType, data, name }  (for vision models)
 */
export async function readFileOrUrl(target) {
  // Expand ~ in file paths
  const expanded = target.startsWith('~/') ? path.join(os.homedir(), target.slice(2)) : target;

  if (expanded.startsWith('http://') || expanded.startsWith('https://')) {
    return readUrl(expanded);
  }

  const abs = path.resolve(expanded);
  if (!fs.existsSync(abs)) throw new Error(`File not found: ${expanded}`);

  const ext = path.extname(abs).toLowerCase();

  if (IMAGE_EXT.has(ext)) return readImage(abs);
  if (AUDIO_EXT.has(ext)) return readAudio(abs);

  switch (ext) {
    case '.pdf':  return readPdf(abs);
    case '.docx': return readDocx(abs);
    case '.pptx': return readPptx(abs);
    default:      return fs.readFileSync(abs, 'utf-8');
  }
}
