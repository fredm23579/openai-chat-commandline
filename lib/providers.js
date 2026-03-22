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
    name: 'Anthropic',
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
      { id: 'gemini-2.0-flash',      label: 'Gemini 2.0 Flash      (1 M ctx)'  },
      { id: 'gemini-2.0-flash-lite', label: 'Gemini 2.0 Flash Lite (1 M ctx)'  },
      { id: 'gemini-1.5-pro',        label: 'Gemini 1.5 Pro        (2 M ctx)'  },
      { id: 'gemini-1.5-flash',      label: 'Gemini 1.5 Flash      (1 M ctx)'  },
    ],
  },
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Build an OpenAI-style content array when images are attached to a turn. */
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

/** Convert our internal history array to OpenAI messages. */
function toOaiMessages(history, userText, systemPrompt, images) {
  const msgs = [];
  if (systemPrompt) msgs.push({ role: 'system', content: systemPrompt });
  for (const m of history) {
    msgs.push({ role: m.role, content: oaiContent(m.content, m.images) });
  }
  msgs.push({ role: 'user', content: oaiContent(userText, images) });
  return msgs;
}

/** Convert our internal history to Anthropic messages. */
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
    ? [
        { type: 'text', text: userText },
        ...images.map(img => ({
          type: 'image',
          source: { type: 'base64', media_type: img.mimeType, data: img.data },
        })),
      ]
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
    const messages = toOaiMessages(history, userText, systemPrompt, images);
    const s = await this.client.chat.completions.create({ model: this.model, messages, stream: true });
    for await (const chunk of s) {
      const delta = chunk.choices[0]?.delta?.content;
      if (delta) yield delta;
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
      model: this.model,
      max_tokens: 8096,
      ...(system ? { system } : {}),
      messages,
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

    const chat = genModel.startChat({ history: chatHistory });

    const parts = [{ text: userText }];
    for (const img of images) {
      parts.push({ inlineData: { mimeType: img.mimeType, data: img.data } });
    }

    const result = await chat.sendMessageStream(parts);
    for await (const chunk of result.stream) {
      yield chunk.text();
    }
  }
}

// ─── Factory ──────────────────────────────────────────────────────────────────

export function createProvider(providerName, model) {
  switch (providerName) {
    case 'openai':    return new OpenAIProvider(model);
    case 'anthropic': return new AnthropicProvider(model);
    case 'google':    return new GeminiProvider(model);
    default: throw new Error(`Unknown provider: ${providerName}`);
  }
}
