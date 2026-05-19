import { getVaultEntry } from './local-key-vault.js';
import { getVendor } from './vendor-registry.js';

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface ChatResult {
  text: string;
  provider: string;
  model: string;
  inputTokens?: number;
  outputTokens?: number;
}

export async function chatCompletion(opts: {
  provider: string;
  model: string;
  messages: ChatMessage[];
  label?: string;
}): Promise<ChatResult> {
  const vendor = getVendor(opts.provider);
  if (!vendor) {
    throw new Error(`Unknown provider: ${opts.provider}`);
  }

  if (vendor.keyStorageMode === 'NONE') {
    if (opts.provider === 'ollama') return chatOllama(opts.model, opts.messages);
    if (opts.provider === 'lm-studio') return chatOpenAiCompatible(opts.model, opts.messages, 'http://localhost:1234/v1');
    throw new Error(`Provider ${opts.provider} requires base URL configuration`);
  }

  const entry = getVaultEntry(opts.provider, opts.label ?? 'default');
  if (!entry?.apiKey) {
    throw new Error(
      `No API key for ${opts.provider}. Run: agent-runner-local add-key ${opts.provider}`
    );
  }

  if (opts.provider === 'anthropic') {
    return chatAnthropic(entry.apiKey, opts.model, opts.messages);
  }
  if (opts.provider === 'openai' || opts.provider === 'custom-openai-compatible') {
    const base = entry.baseUrl ?? 'https://api.openai.com/v1';
    return chatOpenAiCompatible(opts.model, opts.messages, base, entry.apiKey);
  }
  if (opts.provider === 'google-gemini') {
    return chatGemini(entry.apiKey, opts.model, opts.messages);
  }

  throw new Error(`Provider ${opts.provider} chat not implemented in this runner version`);
}

async function chatOpenAiCompatible(
  model: string,
  messages: ChatMessage[],
  baseUrl: string,
  apiKey?: string
): Promise<ChatResult> {
  const url = `${baseUrl.replace(/\/$/, '')}/chat/completions`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
    },
    body: JSON.stringify({ model, messages, temperature: 0.3 }),
  });
  const json = (await res.json()) as {
    error?: { message?: string };
    choices?: Array<{ message?: { content?: string } }>;
    usage?: { prompt_tokens?: number; completion_tokens?: number };
  };
  if (!res.ok) {
    throw new Error(json.error?.message ?? `OpenAI-compatible error ${res.status}`);
  }
  const text = json.choices?.[0]?.message?.content ?? '';
  return {
    text,
    provider: 'openai',
    model,
    inputTokens: json.usage?.prompt_tokens,
    outputTokens: json.usage?.completion_tokens,
  };
}

async function chatAnthropic(apiKey: string, model: string, messages: ChatMessage[]): Promise<ChatResult> {
  const system = messages.find((m) => m.role === 'system')?.content;
  const convo = messages.filter((m) => m.role !== 'system');
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model,
      max_tokens: 4096,
      system: system ?? undefined,
      messages: convo.map((m) => ({ role: m.role, content: m.content })),
    }),
  });
  const json = (await res.json()) as {
    error?: { message?: string };
    content?: Array<{ text?: string }>;
    usage?: { input_tokens?: number; output_tokens?: number };
  };
  if (!res.ok) {
    throw new Error(json.error?.message ?? `Anthropic error ${res.status}`);
  }
  const text = json.content?.map((c) => c.text ?? '').join('') ?? '';
  return {
    text,
    provider: 'anthropic',
    model,
    inputTokens: json.usage?.input_tokens,
    outputTokens: json.usage?.output_tokens,
  };
}

async function chatGemini(apiKey: string, model: string, messages: ChatMessage[]): Promise<ChatResult> {
  const prompt = messages.map((m) => `${m.role}: ${m.content}`).join('\n\n');
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }),
  });
  const json = (await res.json()) as {
    error?: { message?: string };
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
  };
  if (!res.ok) {
    throw new Error(json.error?.message ?? `Gemini error ${res.status}`);
  }
  const text = json.candidates?.[0]?.content?.parts?.map((p) => p.text ?? '').join('') ?? '';
  return { text, provider: 'google-gemini', model };
}

async function chatOllama(model: string, messages: ChatMessage[]): Promise<ChatResult> {
  const entry = getVaultEntry('ollama', 'default');
  const base = entry?.baseUrl ?? 'http://localhost:11434';
  const res = await fetch(`${base.replace(/\/$/, '')}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, messages, stream: false }),
  });
  const json = (await res.json()) as { message?: { content?: string }; error?: string };
  if (!res.ok) throw new Error(json.error ?? `Ollama error ${res.status}`);
  return { text: json.message?.content ?? '', provider: 'ollama', model };
}
