/**
 * lib/google.js — Google Drive + Gmail integration via OAuth2
 *
 * SETUP (one-time):
 *  1. Go to https://console.cloud.google.com/apis/credentials
 *  2. Create a project → enable "Google Drive API" and "Gmail API"
 *  3. Create credentials → OAuth 2.0 → Desktop app → Download JSON
 *  4. Save the downloaded file as:  ~/.ai-chat/google-credentials.json
 *  5. On first use this module will open your browser for consent.
 *     Tokens are cached in ~/.ai-chat/google-tokens.json.
 */

import fs from 'fs';
import path from 'path';
import os from 'os';
import readline from 'readline';

const CONFIG_DIR  = path.join(os.homedir(), '.ai-chat');
const CREDS_PATH  = path.join(CONFIG_DIR, 'google-credentials.json');
const TOKEN_PATH  = path.join(CONFIG_DIR, 'google-tokens.json');

const SCOPES = [
  'https://www.googleapis.com/auth/drive.readonly',
  'https://www.googleapis.com/auth/gmail.readonly',
];

// ─── Auth ─────────────────────────────────────────────────────────────────────

async function getAuthClient() {
  if (!fs.existsSync(CREDS_PATH)) {
    throw new Error(
      `Google credentials not found.\n` +
      `Please download OAuth2 credentials from Google Cloud Console and save to:\n` +
      `  ${CREDS_PATH}\n\n` +
      `Steps:\n` +
      `  1. https://console.cloud.google.com/apis/credentials\n` +
      `  2. Create project → enable Drive API + Gmail API\n` +
      `  3. Create credential → OAuth 2.0 Client ID → Desktop app\n` +
      `  4. Download JSON → save as ${CREDS_PATH}`
    );
  }

  const { google } = await import('googleapis');
  const creds      = JSON.parse(fs.readFileSync(CREDS_PATH, 'utf-8'));
  const { client_id, client_secret, redirect_uris } = creds.installed || creds.web;
  const auth = new google.auth.OAuth2(client_id, client_secret, redirect_uris[0]);

  if (fs.existsSync(TOKEN_PATH)) {
    const token = JSON.parse(fs.readFileSync(TOKEN_PATH, 'utf-8'));
    auth.setCredentials(token);
    // Refresh if within 5 min of expiry
    if (token.expiry_date && token.expiry_date - Date.now() < 300_000) {
      const { credentials } = await auth.refreshAccessToken();
      auth.setCredentials(credentials);
      fs.writeFileSync(TOKEN_PATH, JSON.stringify(credentials));
    }
    return { auth, google };
  }

  // First-time OAuth2 consent flow
  const authUrl = auth.generateAuthUrl({ access_type: 'offline', scope: SCOPES });
  console.log('\n\x1b[36mAuthorize Google access by visiting:\x1b[0m\n', authUrl);

  // Try to open browser automatically
  try {
    const { default: open } = await import('open');
    await open(authUrl);
  } catch { /* headless — user must copy URL manually */ }

  const code = await new Promise(resolve => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question('\nPaste the authorization code here: ', ans => { rl.close(); resolve(ans.trim()); });
  });

  const { tokens } = await auth.getToken(code);
  auth.setCredentials(tokens);
  fs.writeFileSync(TOKEN_PATH, JSON.stringify(tokens));
  console.log('\x1b[32m✓ Google authorization saved.\x1b[0m\n');

  return { auth, google };
}

// ─── Google Drive ─────────────────────────────────────────────────────────────

/**
 * Search Google Drive for files matching `query`.
 * Returns an array of { id, name, mimeType, modifiedTime, webViewLink }.
 */
export async function searchDrive(query, maxResults = 10) {
  const { auth, google } = await getAuthClient();
  const drive = google.drive({ version: 'v3', auth });
  const safe  = query.replace(/'/g, "\\'");
  const res   = await drive.files.list({
    q:         `fullText contains '${safe}' and trashed=false`,
    pageSize:  maxResults,
    fields:    'files(id,name,mimeType,modifiedTime,webViewLink)',
    orderBy:   'modifiedTime desc',
  });
  return res.data.files || [];
}

/**
 * Read a Google Drive file by its ID or a drive URL.
 * Returns a text string ready for injection into the prompt.
 */
export async function readDriveFile(fileIdOrUrl) {
  const { auth, google } = await getAuthClient();
  const drive = google.drive({ version: 'v3', auth });

  let fileId = fileIdOrUrl;
  const m = fileIdOrUrl.match(/\/d\/([^/?#]+)/);
  if (m) fileId = m[1];

  const meta = await drive.files.get({ fileId, fields: 'name,mimeType' });
  const { name, mimeType } = meta.data;

  // Google Workspace formats → export as text
  const exportMap = {
    'application/vnd.google-apps.document':     'text/plain',
    'application/vnd.google-apps.spreadsheet':  'text/csv',
    'application/vnd.google-apps.presentation': 'text/plain',
    'application/vnd.google-apps.drawing':      'image/svg+xml',
  };
  const exportMime = exportMap[mimeType];

  if (exportMime) {
    const res = await drive.files.export({ fileId, mimeType: exportMime }, { responseType: 'text' });
    const typeLabel = {
      'application/vnd.google-apps.document':     'Google Doc',
      'application/vnd.google-apps.spreadsheet':  'Google Sheet',
      'application/vnd.google-apps.presentation': 'Google Slides',
    }[mimeType] || 'Google file';
    return `[${typeLabel}: ${name}]\n\n${res.data}`;
  }

  if (mimeType === 'application/pdf') {
    const res    = await drive.files.get({ fileId, alt: 'media' }, { responseType: 'arraybuffer' });
    const buffer = Buffer.from(res.data);
    const parse  = (await import('pdf-parse/lib/pdf-parse.js').catch(() => import('pdf-parse'))).default;
    const data   = await parse(buffer);
    return `[Google Drive PDF: ${name}]\n\n${data.text}`;
  }

  // Fallback: download as text
  const res = await drive.files.get({ fileId, alt: 'media' }, { responseType: 'text' });
  return `[Google Drive: ${name}]\n\n${res.data}`;
}

// ─── Gmail ────────────────────────────────────────────────────────────────────

/**
 * Search Gmail. Returns array of { id, subject, from, date, snippet }.
 */
export async function searchGmail(query, maxResults = 10) {
  const { auth, google } = await getAuthClient();
  const gmail = google.gmail({ version: 'v1', auth });

  const list = await gmail.users.messages.list({ userId: 'me', q: query, maxResults });
  if (!list.data.messages?.length) return [];

  const results = await Promise.all(list.data.messages.map(async ({ id }) => {
    const msg = await gmail.users.messages.get({
      userId: 'me', id, format: 'metadata',
      metadataHeaders: ['Subject', 'From', 'Date'],
    });
    const hdrs = Object.fromEntries((msg.data.payload.headers || []).map(h => [h.name, h.value]));
    return { id, subject: hdrs.Subject || '(no subject)', from: hdrs.From || '', date: hdrs.Date || '', snippet: msg.data.snippet || '' };
  }));

  return results;
}

/**
 * Read the full text of a Gmail message by its message ID.
 */
export async function readGmailMessage(messageId) {
  const { auth, google } = await getAuthClient();
  const gmail = google.gmail({ version: 'v1', auth });

  const msg  = await gmail.users.messages.get({ userId: 'me', id: messageId, format: 'full' });
  const hdrs = Object.fromEntries((msg.data.payload.headers || []).map(h => [h.name, h.value]));

  let body = '';
  const extractText = part => {
    if (part.mimeType === 'text/plain' && part.body?.data) {
      body += Buffer.from(part.body.data, 'base64').toString('utf-8') + '\n';
    } else if (part.parts) part.parts.forEach(extractText);
  };
  extractText(msg.data.payload);
  if (!body && msg.data.payload.body?.data) {
    body = Buffer.from(msg.data.payload.body.data, 'base64').toString('utf-8');
  }

  return [
    '[Gmail Message]',
    `Subject: ${hdrs.Subject || '(no subject)'}`,
    `From:    ${hdrs.From    || ''}`,
    `Date:    ${hdrs.Date    || ''}`,
    '',
    (body.trim() || msg.data.snippet || '(no content)'),
  ].join('\n');
}

/** Returns true if google-credentials.json is present. */
export function isGoogleConfigured() {
  return fs.existsSync(CREDS_PATH);
}
