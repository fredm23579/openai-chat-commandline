import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

// ─── SessionHistory ───────────────────────────────────────────────────────────

export class SessionHistory {
  constructor(provider, model, sessionsDir, loaded = null) {
    this.sessionsDir = sessionsDir;
    this._attachments = [];   // pending files attached before next send

    if (loaded) {
      this.id       = loaded.id;
      this.created  = loaded.created;
      this.provider = loaded.provider;
      this.model    = loaded.model;
      this.messages = loaded.messages || [];
    } else {
      this.id       = crypto.randomUUID();
      this.created  = new Date().toISOString();
      this.provider = provider;
      this.model    = model;
      this.messages = [];
    }
  }

  /** Add a turn to permanent history. images = [{type,mimeType,data,name}] */
  addMessage(role, content, images = []) {
    this.messages.push({
      role,
      content,
      ...(images.length ? { images } : {}),
      ts: new Date().toISOString(),
    });
  }

  /** Queue a file/URL attachment to be sent with the next user message. */
  addAttachment(name, content) {
    this._attachments.push({ name, content });
  }

  /** Consume and return queued attachments (clears the queue). */
  flushAttachments() {
    const att = this._attachments;
    this._attachments = [];
    return att;
  }

  /** Return history suitable for passing to a provider (no timestamps). */
  getMessages() {
    return this.messages.map(m => ({
      role:    m.role,
      content: m.content,
      ...(m.images ? { images: m.images } : {}),
    }));
  }

  clearMessages() {
    this.messages    = [];
    this._attachments = [];
  }

  setModel(provider, model) {
    this.provider = provider;
    this.model    = model;
  }

  /** Rough token estimate (~4 chars / token). */
  estimateTokens() {
    const chars = this.messages.reduce((n, m) => n + m.content.length, 0);
    return Math.ceil(chars / 4);
  }

  title() {
    const first = this.messages.find(m => m.role === 'user');
    return first ? first.content.replace(/\n/g, ' ').slice(0, 60) : 'Untitled session';
  }

  /** Persist session to disk. Returns the file path. */
  async save() {
    const file = path.join(this.sessionsDir, `${this.id}.json`);
    fs.writeFileSync(file, JSON.stringify({
      id:           this.id,
      created:      this.created,
      updated:      new Date().toISOString(),
      provider:     this.provider,
      model:        this.model,
      title:        this.title(),
      messageCount: this.messages.length,
      messages:     this.messages,
    }, null, 2));
    return file;
  }
}

// ─── Session listing / loading ────────────────────────────────────────────────

export function listSessions(sessionsDir) {
  try {
    return fs.readdirSync(sessionsDir)
      .filter(f => f.endsWith('.json'))
      .map(f => {
        try {
          const d = JSON.parse(fs.readFileSync(path.join(sessionsDir, f), 'utf-8'));
          return {
            file:         f,
            id:           d.id,
            created:      d.created,
            updated:      d.updated || d.created,
            title:        d.title || 'Untitled',
            provider:     d.provider,
            model:        d.model,
            messageCount: d.messageCount || 0,
          };
        } catch { return null; }
      })
      .filter(Boolean)
      .sort((a, b) => new Date(b.updated) - new Date(a.updated));
  } catch { return []; }
}

export function loadSession(sessionInfo, sessionsDir) {
  try {
    return JSON.parse(fs.readFileSync(path.join(sessionsDir, sessionInfo.file), 'utf-8'));
  } catch { return null; }
}
