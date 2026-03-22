import OpenAI from 'openai';
import Anthropic from '@anthropic-ai/sdk';
import { GoogleGenerativeAI } from '@google/generative-ai';

// ─── Provider catalogue ───────────────────────────────────────────────────────

export const PROVIDERS = {
  openai: {
    name: 'OpenAI',
    envKey: 'OPENAI_API_KEY',
    models: [
      { id: 'gpt-4o',        label: 'GPT-4o          (128 k ctx)' },
      { id: 'gpt-4o-mini',   label: 'GPT-4o Mini     (128 k ctx)' },
      { id: 'gpt-4.1',       label: 'GPT-4.1         (1 M ctx)'   },
      { id: 'gpt-4.1-mini',  label: 'GPT-4.1 Mini    (1 M ctx)'   },
      { id: 'gpt-4.1-nano',  label: 'GPT-4.1 Nano    (1 M ctx)'   },
      { id: 'o3-mini',       label: 'o3-mini         (200 k ctx)' },
    ],
  },
  anthropic: {
    name: 'Anthropic (Claude)',
    envKey: 'ANTHROPIC_API_KEY',
    models: [
      { id: 'claude-opus-4-6',            label: 'Claude Opus 4.6         (200 k ctx)' },
      { id: 'claude-sonnet-4-6',          label: 'Claude Sonnet 4.6       (200 k ctx)' },
      { id: 'claude-haiku-4-5-20251001',  label: 'Claude Haiku 4.5        (200 k ctx)' },
      { id: 'claude-3-5-sonnet-20241022', label: 'Claude 3.5 Sonnet       (200 k ctx)' },
      { id: 'claude-3-5-haiku-20241022',  label: 'Claude 3.5 Haiku        (200 k ctx)' },
    ],
  },
  google: {
    name: 'Google Gemini',
    envKey: 'GOOGLE_API_KEY',
    models: [
      { id: 'gemini-2.0-flash',        label: 'Gemini 2.0 Flash        (1 M ctx)'  },
      { id: 'gemini-2.0-flash-lite',   label: 'Gemini 2.0 Flash Lite   (1 M ctx)'  },
      { id: 'gemini-1.5-pro',          label: 'Gemini 1.5 Pro          (2 M ctx)'  },
      { id: 'gemini-1.5-flash',        label: 'Gemini 1.5 Flash        (1 M ctx)'  },
    ],
  },
  perplexity: {
    name: 'Perplexity',
    envKey: 'PERPLEXITY_API_KEY',
    models: [
      { id: 'sonar',                label: 'Sonar                  (lightweight, web)' },
      { id: 'sonar-pro',            label: 'Sonar Pro              (advanced, web)'    },
      { id: 'sonar-reasoning',      label: 'Sonar Reasoning        (chain-of-thought)' },
      { id: 'sonar-deep-research',  label: 'Sonar Deep Research    (full research)'    },
    ],
  },
  xai: {
    name: 'X AI (Grok)',
    envKey: 'XAI_API_KEY',
    models: [
      { id: 'grok-3',       label: 'Grok 3          (flagship)'  },
      { id: 'grok-3-fast',  label: 'Grok 3 Fast     (speed)'     },
      { id: 'grok-2-1212',  label: 'Grok 2'                      },
      { id: 'grok-beta',    label: 'Grok Beta'                   },
    ],
  },
  groq: {
    name: 'Meta / Llama  (via Groq)',
    envKey: 'GROQ_API_KEY',
    models: [
      { id: 'llama-3.3-70b-versatile',  label: 'Llama 3.3 70B Versatile  (128 k ctx)' },
      { id: 'llama-3.1-70b-versatile',  label: 'Llama 3.1 70B Versatile  (128 k ctx)' },
      { id: 'llama-3.1-8b-instant',     label: 'Llama 3.1 8B Instant     (fast)'      },
      { id: 'mixtral-8x7b-32768',       label: 'Mixtral 8x7B             (32 k ctx)'  },
    ],
  },
};

// ─── Shared helpers ───────────────────────────────────────────────────────────

function oaiContent(text, images = []) {
  if (!images.length) return text;
  return [
    { type: 'text', text },
    ...images.map(img => ({
      type: 'image_url',
      image_url: { url: `data:${img.mimeType};base64,${img.data}` },
    })),
  ];
}

function toOaiMessages(history, userText, systemPrompt, images) {
  const msgs = [];
  if (systemPrompt) msgs.push({ role: 'system', content: systemPrompt });
  for (const m of history) {
    msgs.push({ role: m.role, content: oaiContent(m.content, m.images) });
  }
  msgs.push({ role: 'user', content: oaiContent(userText, images) });
  return msgs;
}

function toAnthropicMessages(history, userText, systemPrompt, images) {
  const msgs = [];
  for (const m of history) {
    if (m.images?.length && m.role === 'user') {
      msgs.push({
        role: 'user',
        content: [
          { type: 'text', text: m.content },
          ...m.images.map(img => ({
            type: 'image',
            source: { type: 'base64', media_type: img.mimeType, data: img.data },
          })),
        ],
      });
    } else {
      msgs.push({ role: m.role, content: m.content });
    }
  }
  const userContent = images.length
    ? [{ type: 'text', text: userText },
       ...images.map(img => ({ type: 'image', source: { type: 'base64', media_type: img.mimeType, data: img.data } }))]
    : userText;
  msgs.push({ role: 'user', content: userContent });
  return { system: systemPrompt || undefined, messages: msgs };
}

// ─── OpenAI provider ─────────────────────────────────────────────────────────

class OpenAIProvider {
  constructor(model) {
    this.model = model;
    this.client = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
      ...(process.env.OPENAI_BASE_URL ? { baseURL: process.env.OPENAI_BASE_URL } : {}),
    });
  }
  async *stream(history, userText, systemPrompt, images = []) {
    const s = await this.client.chat.completions.create({
      model: this.model,
      messages: toOaiMessages(history, userText, systemPrompt, images),
      stream: true,
    });
    for await (const chunk of s) {
      const d = chunk.choices[0]?.delta?.content;
      if (d) yield d;
    }
  }
}

// ─── OpenAI-compatible provider (Perplexity, Grok, Groq) ─────────────────────

class OpenAICompatibleProvider {
  constructor(model, apiKey, baseURL) {
    this.model = model;
    this.client = new OpenAI({ apiKey, baseURL });
  }
  async *stream(history, userText, systemPrompt, images = []) {
    const s = await this.client.chat.completions.create({
      model: this.model,
      messages: toOaiMessages(history, userText, systemPrompt, images),
      stream: true,
    });
    for await (const chunk of s) {
      const d = chunk.choices[0]?.delta?.content;
      if (d) yield d;
    }
  }
}

// ─── Anthropic provider ───────────────────────────────────────────────────────

class AnthropicProvider {
  constructor(model) {
    this.model = model;
    this.client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  }
  async *stream(history, userText, systemPrompt, images = []) {
    const { system, messages } = toAnthropicMessages(history, userText, systemPrompt, images);
    const s = this.client.messages.stream({
      model: this.model, max_tokens: 8096,
      ...(system ? { system } : {}), messages,
    });
    for await (const event of s) {
      if (event.type === 'content_block_delta' && event.delta?.type === 'text_delta') {
        yield event.delta.text;
      }
    }
  }
}

// ─── Google Gemini provider ───────────────────────────────────────────────────

class GeminiProvider {
  constructor(model) {
    this.model = model;
    this.genAI = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY);
  }
  async *stream(history, userText, systemPrompt, images = []) {
    const genModel = this.genAI.getGenerativeModel({
      model: this.model,
      ...(systemPrompt ? { systemInstruction: systemPrompt } : {}),
    });
    const chatHistory = history.map(m => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: m.content }],
    }));
    const chat  = genModel.startChat({ history: chatHistory });
    const parts = [{ text: userText }, ...images.map(img => ({ inlineData: { mimeType: img.mimeType, data: img.data } }))];
    const result = await chat.sendMessageStream(parts);
    for await (const chunk of result.stream) yield chunk.text();
  }
}

// ─── Factory ──────────────────────────────────────────────────────────────────

export function createProvider(name, model) {
  switch (name) {
    case 'openai':     return new OpenAIProvider(model);
    case 'anthropic':  return new AnthropicProvider(model);
    case 'google':     return new GeminiProvider(model);
    case 'perplexity': return new OpenAICompatibleProvider(model, process.env.PERPLEXITY_API_KEY, 'https://api.perplexity.ai');
    case 'xai':        return new OpenAICompatibleProvider(model, process.env.XAI_API_KEY,        'https://api.x.ai/v1');
    case 'groq':       return new OpenAICompatibleProvider(model, process.env.GROQ_API_KEY,       'https://api.groq.com/openai/v1');
    default: throw new Error(`Unknown provider: ${name}`);
  }
}
