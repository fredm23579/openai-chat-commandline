/**
 * lib/importer.js — Import conversation history from other AI platforms.
 *
 * Supported formats:
 *  - ChatGPT  (conversations.json from Settings → Data export)
 *  - Claude   (claude_conversations.json or conversations.json from Claude export)
 *  - Gemini   (Takeout/Gemini/MyActivity.json or Bard export format)
 *  - Generic  (plain JSON array [{role,content}] or [{speaker,text}])
 *  - Markdown (# User / # Assistant headings)
 */

import fs from 'fs';
import path from 'path';

// ─── ChatGPT ──────────────────────────────────────────────────────────────────

function importChatGPT(data) {
  const convs = Array.isArray(data) ? data : [data];
  const sessions = [];

  for (const conv of convs) {
    const mapping = conv.mapping || {};
    if (!Object.keys(mapping).length) continue;

    // Walk from current_node back to root to get the active branch
    const branch = [];
    let cur = conv.current_node;
    while (cur && mapping[cur]) {
      branch.unshift(cur);
      cur = mapping[cur].parent;
    }

    const messages = [];
    for (const nodeId of branch) {
      const node = mapping[nodeId];
      if (!node?.message) continue;
      const { author, content, create_time } = node.message;
      const role = author?.role;
      if (role !== 'user' && role !== 'assistant') continue;

      let text = '';
      if (content?.content_type === 'text' && Array.isArray(content.parts)) {
        text = content.parts.filter(p => typeof p === 'string').join('');
      } else if (typeof content?.text === 'string') {
        text = content.text;
      }
      if (!text.trim()) continue;

      messages.push({
        role,
        content: text.trim(),
        ts: create_time ? new Date(create_time * 1000).toISOString() : new Date().toISOString(),
      });
    }

    if (messages.length) {
      sessions.push({
        title:    conv.title || 'Imported ChatGPT conversation',
        created:  conv.create_time ? new Date(conv.create_time * 1000).toISOString() : new Date().toISOString(),
        provider: 'openai',
        model:    'gpt-4',
        messages,
      });
    }
  }

  return sessions;
}

// ─── Claude.ai ────────────────────────────────────────────────────────────────

function importClaude(data) {
  const convs = Array.isArray(data) ? data : (data.conversations || [data]);
  const sessions = [];

  for (const conv of convs) {
    const rawMsgs = conv.chat_messages || conv.messages || [];
    const messages = rawMsgs
      .filter(m => m.text?.trim() || m.content?.trim())
      .map(m => ({
        role:    (m.sender === 'human' || m.role === 'user') ? 'user' : 'assistant',
        content: (m.text || m.content || '').trim(),
        ts:      m.created_at || conv.created_at || new Date().toISOString(),
      }))
      .filter(m => m.content);

    if (messages.length) {
      sessions.push({
        title:    conv.name || conv.title || 'Imported Claude conversation',
        created:  conv.created_at || new Date().toISOString(),
        provider: 'anthropic',
        model:    'claude-3-5-sonnet-20241022',
        messages,
      });
    }
  }

  return sessions;
}

// ─── Gemini / Bard ────────────────────────────────────────────────────────────

function importGemini(data) {
  // Google Takeout format: { conversations: [{ turns: [{userText, modelText}] }] }
  const convs = Array.isArray(data)
    ? data
    : (data.conversations || data.Bard_conversations || []);

  const sessions = [];

  for (const conv of convs) {
    const messages = [];
    for (const turn of (conv.turns || conv.messages || [])) {
      const userText  = turn.userText  || turn.user  || (turn.role === 'user'      ? turn.text : null);
      const modelText = turn.modelText || turn.model || (turn.role === 'assistant' ? turn.text : null);
      if (userText?.trim())  messages.push({ role: 'user',      content: userText.trim(),  ts: new Date().toISOString() });
      if (modelText?.trim()) messages.push({ role: 'assistant', content: modelText.trim(), ts: new Date().toISOString() });
    }

    if (messages.length) {
      sessions.push({
        title:    conv.title || 'Imported Gemini conversation',
        created:  conv.createTime || conv.create_time || new Date().toISOString(),
        provider: 'google',
        model:    'gemini-1.5-pro',
        messages,
      });
    }
  }

  return sessions;
}

// ─── Generic JSON ─────────────────────────────────────────────────────────────

function importGenericJson(data) {
  const arr = Array.isArray(data) ? data : [];
  if (!arr.length) return [];

  // Already in our format?
  if (arr[0]?.role && arr[0]?.content) {
    return [{
      title:    'Imported conversation',
      created:  new Date().toISOString(),
      provider: 'openai',
      model:    'gpt-4',
      messages: arr.map(m => ({ role: m.role, content: m.content, ts: m.ts || new Date().toISOString() })),
    }];
  }

  // {speaker/sender, text/content} pairs
  if (arr[0]?.speaker || arr[0]?.sender) {
    const messages = arr
      .filter(m => m.text || m.content)
      .map(m => ({
        role:    (m.speaker || m.sender || '').toLowerCase().includes('user') ? 'user' : 'assistant',
        content: (m.text || m.content || '').trim(),
        ts:      m.timestamp || new Date().toISOString(),
      }));
    return messages.length
      ? [{ title: 'Imported conversation', created: new Date().toISOString(), provider: 'openai', model: 'gpt-4', messages }]
      : [];
  }

  return [];
}

// ─── Markdown ─────────────────────────────────────────────────────────────────

function importMarkdown(text) {
  const messages = [];
  let currentRole = null;
  let currentLines = [];

  const flush = () => {
    if (currentRole && currentLines.length) {
      const content = currentLines.join('\n').trim();
      if (content) messages.push({ role: currentRole, content, ts: new Date().toISOString() });
    }
    currentLines = [];
  };

  for (const line of text.split('\n')) {
    const lower = line.toLowerCase().trim();
    if (/^#+\s*(user|human|you)\s*:?$/i.test(lower) || lower === '**user:**') {
      flush(); currentRole = 'user';
    } else if (/^#+\s*(assistant|ai|claude|gpt|gemini|model|bot)\s*:?$/i.test(lower) || lower === '**assistant:**') {
      flush(); currentRole = 'assistant';
    } else if (currentRole) {
      currentLines.push(line);
    }
  }
  flush();

  return messages.length
    ? [{ title: 'Imported markdown conversation', created: new Date().toISOString(), provider: 'openai', model: 'gpt-4', messages }]
    : [];
}

// ─── Detect format and dispatch ───────────────────────────────────────────────

/**
 * Import a chat file from any supported platform.
 *
 * @param {string} filePath  Path to the export file.
 * @returns {Array}  Array of session objects { title, created, provider, model, messages }.
 */
export function importChatFile(filePath) {
  const ext  = path.extname(filePath).toLowerCase();
  const text = fs.readFileSync(filePath, 'utf-8');

  if (ext === '.md' || ext === '.txt') return importMarkdown(text);

  let data;
  try { data = JSON.parse(text); } catch {
    // Not valid JSON — try markdown parse
    return importMarkdown(text);
  }

  const filename = path.basename(filePath).toLowerCase();

  // Sniff by filename
  if (filename.includes('chatgpt') || filename === 'conversations.json') {
    // ChatGPT exports are arrays with `mapping` keys
    const arr = Array.isArray(data) ? data : [];
    if (arr[0]?.mapping) return importChatGPT(data);
  }

  if (filename.includes('claude')) return importClaude(data);
  if (filename.includes('gemini') || filename.includes('bard')) return importGemini(data);

  // Sniff by structure
  const arr = Array.isArray(data) ? data : [];
  if (arr[0]?.mapping)               return importChatGPT(data);
  if (arr[0]?.chat_messages)         return importClaude(data);
  if (arr[0]?.turns)                 return importGemini(data);
  if (data.conversations)            return importGemini(data);

  // Last resort
  return importGenericJson(data);
}
