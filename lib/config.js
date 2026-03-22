import fs from 'fs';
import path from 'path';
import os from 'os';

const CONFIG_FILE = path.join(os.homedir(), '.ai-chat', 'config.json');

const DEFAULTS = {
  name:            '',          // user's preferred name
  defaultProvider: '',          // pre-select provider on startup
  defaultModel:    '',          // pre-select model on startup
  autoSearch:      true,        // run web search before every reply
  streamOutput:    true,        // stream tokens as they arrive
  autoSave:        true,        // save session on exit
};

// ─── UserConfig ───────────────────────────────────────────────────────────────

export class UserConfig {
  constructor() {
    this._data = this._load();
  }

  _load() {
    try {
      if (fs.existsSync(CONFIG_FILE)) {
        return { ...DEFAULTS, ...JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf-8')) };
      }
    } catch { /* ignore */ }
    return { ...DEFAULTS };
  }

  save() {
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(this._data, null, 2));
  }

  get(key)        { return this._data[key]; }
  set(key, value) { this._data[key] = value; this.save(); }
  all()           { return { ...this._data }; }

  /** Return a personalised greeting prefix for the system prompt. */
  systemAddition() {
    const name = this._data.name;
    return name ? `The user's name is ${name}. ` : '';
  }
}
