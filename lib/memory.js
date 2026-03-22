import fs from 'fs';
import path from 'path';
import os from 'os';

const MEMORY_FILE = path.join(os.homedir(), '.ai-chat', 'memory.json');

// ─── MemoryStore ──────────────────────────────────────────────────────────────

export class MemoryStore {
  constructor() {
    this._entries = this._load();
  }

  _load() {
    try {
      if (fs.existsSync(MEMORY_FILE)) {
        return JSON.parse(fs.readFileSync(MEMORY_FILE, 'utf-8'));
      }
    } catch { /* ignore */ }
    return [];
  }

  _save() {
    fs.writeFileSync(MEMORY_FILE, JSON.stringify(this._entries, null, 2));
  }

  /** Add a memory. Returns the generated id. */
  add(content, tags = []) {
    const entry = {
      id:      Date.now().toString(36) + Math.random().toString(36).slice(2, 5),
      content: content.trim(),
      tags,
      created: new Date().toISOString(),
    };
    this._entries.push(entry);
    this._save();
    return entry.id;
  }

  /** Remove a memory by id. Returns true if found and removed. */
  remove(id) {
    const before = this._entries.length;
    this._entries = this._entries.filter(e => e.id !== id);
    if (this._entries.length < before) { this._save(); return true; }
    return false;
  }

  /** Return a copy of all entries. */
  list() { return [...this._entries]; }

  /** Wipe everything. */
  clear() { this._entries = []; this._save(); }

  /**
   * Format memories as a system prompt block to inject before each call.
   * Returns an empty string if there are no memories.
   */
  asContext() {
    if (!this._entries.length) return '';
    return (
      '\n\n[Persistent memory about the user:\n' +
      this._entries.map(e => `• ${e.content}`).join('\n') +
      ']'
    );
  }
}
