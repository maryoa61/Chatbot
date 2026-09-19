/* ============================================================
   Chatbot — Cloudflare Worker (API backend) v2.1
   ------------------------------------------------------------
   Phase 1: stateless routes (health, search, proxy)
   Phase 2: Telegram routes (KV-backed)
   Phase 3: Combo / Provider / Key Store + AI Adapter
   Phase 4: Vision Adapter + sub-pools (vision/audio) + auto-routing

   Secrets:
     GEMINI_API_KEY, OPENAI_API_KEY, ANTHROPIC_API_KEY,
     DEEPSEEK_API_KEY, GROQ_API_KEY, OPENROUTER_API_KEY,
     XAI_API_KEY, MISTRAL_API_KEY, TOGETHER_API_KEY,
     TELEGRAM_BOT_TOKEN, TELEGRAM_API_BASE_URL,
     TG_WEBHOOK_SECRET
   Bindings:
     CHATBOT_STATE (KV)
   ============================================================ */

const json = (obj, status = 200, cors = {}) =>
  new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json', ...cors },
  });

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'content-type, authorization, x-api-key, anthropic-version, x-goog-api-key',
  'Access-Control-Max-Age': '86400',
};

const trim = (v) => String(v || '').trim();
const envKey = (env, name, fallback = '') => trim(env[name] || fallback);
const now = () => Date.now();
const uid = (prefix = 'id') =>
  `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

/* ============================================================
   KV STORE
   ============================================================ */

async function kvGet(env, key, fallback = null) {
  const store = env.CHATBOT_STATE;
  if (!store) return fallback;
  try {
    const v = await store.get(key, 'json');
    return v === null || v === undefined ? fallback : v;
  } catch {
    return fallback;
  }
}

async function kvPut(env, key, value) {
  const store = env.CHATBOT_STATE;
  if (!store) throw new Error('CHATBOT_STATE KV binding is missing');
  await store.put(key, JSON.stringify(value));
}

async function kvDel(env, key) {
  const store = env.CHATBOT_STATE;
  if (!store) return;
  await store.delete(key);
}

async function kvListPush(env, indexKey, id) {
  const list = await kvGet(env, indexKey, []);
  if (!list.includes(id)) list.push(id);
  await kvPut(env, indexKey, list);
  return list;
}

async function kvListRemove(env, indexKey, id) {
  const list = await kvGet(env, indexKey, []);
  const next = list.filter((x) => x !== id);
  await kvPut(env, indexKey, next);
  return next;
}

/* ============================================================
   PROVIDER STORE
   ============================================================ */

const PROVIDER_TYPES = [
  'openai',
  'openai-compatible',
  'anthropic',
  'gemini',
  'openrouter',
  'deepseek',
  'groq',
  'xai',
  'mistral',
  'together',
  'cohere',
];

const PROVIDER_DEFAULT_BASE = {
  openai: 'https://api.openai.com/v1',
  'openai-compatible': '',
  anthropic: 'https://api.anthropic.com',
  gemini: 'https://generativelanguage.googleapis.com',
  openrouter: 'https://openrouter.ai/api/v1',
  deepseek: 'https://api.deepseek.com/v1',
  groq: 'https://api.groq.com/openai/v1',
  xai: 'https://api.x.ai/v1',
  mistral: 'https://api.mistral.ai/v1',
  together: 'https://api.together.xyz/v1',
  cohere: 'https://api.cohere.ai',
};

async function providerList(env) {
  const ids = await kvGet(env, 'provider:index', []);
  const out = [];
  for (const id of ids) {
    const p = await kvGet(env, `provider:${id}`);
    if (p) out.push(p);
  }
  return out;
}

async function providerGet(env, id) {
  return kvGet(env, `provider:${id}`);
}

async function providerSave(env, data) {
  const id = data.id || uid('prov');
  const existing = (await kvGet(env, `provider:${id}`)) || {};
  const type = data.type || existing.type || 'openai-compatible';
  if (!PROVIDER_TYPES.includes(type)) {
    throw new Error(`Unsupported provider type: ${type}`);
  }
  const next = {
    ...existing,
    ...data,
    id,
    type,
    baseUrl: data.baseUrl || existing.baseUrl || PROVIDER_DEFAULT_BASE[type] || '',
    models: data.models || existing.models || [],
    createdAt: existing.createdAt || now(),
    updatedAt: now(),
  };
  await kvPut(env, `provider:${id}`, next);
  await kvListPush(env, 'provider:index', id);
  return next;
}

async function providerDelete(env, id) {
  await kvDel(env, `provider:${id}`);
  await kvListRemove(env, 'provider:index', id);
}

/* ============================================================
   KEY STORE
   ============================================================ */

function maskKey(k) {
  if (!k) return '';
  const s = String(k);
  if (s.length <= 12) return s.slice(0, 4) + '...';
  return `${s.slice(0, 8)}...${s.slice(-6)}`;
}

async function keyList(env, { providerId } = {}) {
  const ids = await kvGet(env, 'key:index', []);
  const out = [];
  for (const id of ids) {
    const k = await kvGet(env, `key:${id}`);
    if (!k) continue;
    if (providerId && k.providerId !== providerId) continue;
    out.push({ ...k, apiKey: undefined, apiKeyMasked: maskKey(k.apiKey) });
  }
  return out;
}

async function keyListRaw(env, { providerId } = {}) {
  const ids = await kvGet(env, 'key:index', []);
  const out = [];
  for (const id of ids) {
    const k = await kvGet(env, `key:${id}`);
    if (!k) continue;
    if (providerId && k.providerId !== providerId) continue;
    out.push(k);
  }
  return out;
}

async function keyGet(env, id) {
  return kvGet(env, `key:${id}`);
}

async function keySave(env, data) {
  const id = data.id || uid('key');
  const existing = (await kvGet(env, `key:${id}`)) || {};
  const next = {
    ...existing,
    ...data,
    id,
    status: data.status || existing.status || 'active',
    cooldownUntil: data.cooldownUntil ?? existing.cooldownUntil ?? 0,
    lastUsed: existing.lastUsed || 0,
    failCount: existing.failCount || 0,
    successCount: existing.successCount || 0,
    createdAt: existing.createdAt || now(),
    updatedAt: now(),
  };
  await kvPut(env, `key:${id}`, next);
  await kvListPush(env, 'key:index', id);
  return next;
}

async function keyDelete(env, id) {
  await kvDel(env, `key:${id}`);
  await kvListRemove(env, 'key:index', id);
}

async function keyMarkSuccess(env, id) {
  const k = await keyGet(env, id);
  if (!k) return;
  k.successCount = (k.successCount || 0) + 1;
  k.lastUsed = now();
  k.status = 'active';
  k.cooldownUntil = 0;
  await kvPut(env, `key:${id}`, k);
}

async function keyMarkFail(env, id, cooldownMs = 60_000) {
  const k = await keyGet(env, id);
  if (!k) return;
  k.failCount = (k.failCount || 0) + 1;
  k.lastUsed = now();
  k.status = 'cooldown';
  k.cooldownUntil = now() + cooldownMs;
  await kvPut(env, `key:${id}`, k);
}

function isKeyUsable(k) {
  if (!k) return false;
  if (k.status === 'dead') return false;
  if (k.status === 'cooldown' && k.cooldownUntil > now()) return false;
  return true;
}

/* ============================================================
   COMBO STORE  (main / vision / audio sub-pools)
   ============================================================ */

const STRATEGIES = ['fallback', 'round-robin', 'fusion'];

async function comboList(env) {
  const ids = await kvGet(env, 'combo:index', []);
  const out = [];
  for (const id of ids) {
    const c = await kvGet(env, `combo:${id}`);
    if (c) out.push(c);
  }
  return out;
}

async function comboGet(env, id) {
  return kvGet(env, `combo:${id}`);
}

/* --- normalize a sub-pool (vision / audio) --- */
function normalizeSubPool(raw, fallback = {}) {
  const src = raw || {};
  const fb  = fallback || {};
  const strategy = src.strategy || fb.strategy || 'fallback';
  if (!STRATEGIES.includes(strategy)) {
    throw new Error(`Unsupported sub-pool strategy: ${strategy}`);
  }
  return {
    enabled:  src.enabled  ?? fb.enabled  ?? false,
    strategy,
    models:   Array.isArray(src.models) ? src.models
            : Array.isArray(fb.models) ? fb.models
            : [],
  };
}

async function comboSave(env, data) {
  const id = data.id || uid('combo');
  const existing = (await kvGet(env, `combo:${id}`)) || {};

  const strategy = data.strategy || existing.strategy || 'fallback';
  if (!STRATEGIES.includes(strategy)) {
    throw new Error(`Unsupported strategy: ${strategy}`);
  }

  const next = {
    ...existing,
    ...data,
    id,
    strategy,
    models: Array.isArray(data.models)   ? data.models
          : Array.isArray(existing.models) ? existing.models
          : [],

    // NEW: sub-pools
    vision: normalizeSubPool(data.vision, existing.vision),
    audio:  normalizeSubPool(data.audio,  existing.audio),

    endpoint: {
      requireKey: true,
      keyIds: [],
      ...(existing.endpoint || {}),
      ...(data.endpoint || {}),
    },
    createdAt: existing.createdAt || now(),
    updatedAt: now(),
  };

  await kvPut(env, `combo:${id}`, next);
  await kvListPush(env, 'combo:index', id);
  return next;
}

async function comboDelete(env, id) {
  const combo = await comboGet(env, id);
  if (combo?.endpoint?.keyIds?.length) {
    for (const kid of combo.endpoint.keyIds) {
      await kvDel(env, `epkey:${kid}`);
      await kvListRemove(env, 'epkey:index', kid);
    }
  }
  await kvDel(env, `combo:${id}`);
  await kvDel(env, `combo:${id}:cursor`);
  await kvDel(env, `combo:${id}:vision:cursor`);
  await kvDel(env, `combo:${id}:audio:cursor`);
  await kvListRemove(env, 'combo:index', id);
}

async function comboNextCursor(env, id, len) {
  const cur = Number(await kvGet(env, `combo:${id}:cursor`, 0)) || 0;
  const next = (cur + 1) % Math.max(len, 1);
  await kvPut(env, `combo:${id}:cursor`, next);
  return cur % Math.max(len, 1);
}

/* ============================================================
   ENDPOINT KEY STORE  (sk-...)
   ============================================================ */

const BASE62 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';

function randomBase62(len) {
  const bytes = new Uint8Array(len);
  crypto.getRandomValues(bytes);
  let out = '';
  for (let i = 0; i < len; i++) out += BASE62[bytes[i] % 62];
  return out;
}

function generateEndpointKey() {
  return `sk-${randomBase62(32)}`;
}

async function hashKey(str) {
  const data = new TextEncoder().encode(str);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

async function epKeyCreate(env, comboId, { label = '', isDefault = false } = {}) {
  const plain = generateEndpointKey();
  const hash = await hashKey(plain);
  const rec = {
    id: hash.slice(0, 16),
    comboId,
    keyHash: hash,
    label,
    isDefault,
    createdAt: now(),
    lastUsed: 0,
    revoked: false,
  };
  await kvPut(env, `epkey:${hash}`, rec);
  await kvListPush(env, 'epkey:index', hash);

  const combo = await comboGet(env, comboId);
  if (combo) {
    const keyIds = new Set(combo.endpoint?.keyIds || []);
    keyIds.add(hash);
    combo.endpoint = { ...(combo.endpoint || {}), keyIds: [...keyIds] };
    if (isDefault) combo.endpoint.defaultKeyId = hash;
    await kvPut(env, `combo:${comboId}`, combo);
  }
  return { ...rec, plain };
}

async function epKeyVerify(env, comboId, plain) {
  if (!plain) return null;
  const hash = await hashKey(plain);
  const rec = await kvGet(env, `epkey:${hash}`);
  if (!rec || rec.revoked) return null;
  if (rec.comboId !== comboId) return null;
  return rec;
}

async function epKeyTouch(env, hash) {
  const rec = await kvGet(env, `epkey:${hash}`);
  if (!rec) return;
  rec.lastUsed = now();
  await kvPut(env, `epkey:${hash}`, rec);
}

async function epKeyRevoke(env, hash) {
  const rec = await kvGet(env, `epkey:${hash}`);
  if (!rec) return false;
  rec.revoked = true;
  await kvPut(env, `epkey:${hash}`, rec);
  return true;
}

async function epKeyListForCombo(env, comboId) {
  const combo = await comboGet(env, comboId);
  if (!combo) return [];
  const out = [];
  for (const hash of combo.endpoint?.keyIds || []) {
    const rec = await kvGet(env, `epkey:${hash}`);
    if (rec) out.push({ ...rec, keyHash: undefined });
  }
  return out;
}

/* ============================================================
   INTERNAL MESSAGE FORMAT
   ------------------------------------------------------------
   {
     messages: [{ role, content }],
     model?, temperature?, max_tokens?, stream?, tools?
   }
   ============================================================ */

function normalizeIncomingOpenAI(body) {
  return {
    messages: body.messages || [],
    model: body.model,
    temperature: body.temperature,
    max_tokens: body.max_tokens ?? body.max_completion_tokens,
    stream: Boolean(body.stream),
    tools: body.tools,
  };
}

/* ============================================================
   VISION / INPUT DETECTION
   ============================================================ */

function parseDataUrl(url) {
  const m = String(url || '').match(/^data:([^;]+);base64,(.+)$/);
  if (!m) return null;
  return { mimeType: m[1], data: m[2] };
}

/**
 * Detects the input type of a request.
 * Returns 'vision' | 'audio' | 'main'.
 */
function detectInputType(messages) {
  for (const m of messages || []) {
    if (!Array.isArray(m.content)) continue;
    for (const part of m.content) {
      if (!part || typeof part !== 'object') continue;
      if (part.type === 'image_url' || part.type === 'image' || part.inline_data || part.file_data) {
        return 'vision';
      }
      if (part.type === 'input_audio' || part.type === 'audio') {
        return 'audio';
      }
    }
  }
  return 'main';
}

/**
 * Picks the right pool from a combo based on input type.
 * Falls back to main pool if the requested pool is disabled or empty.
 */
function pickPoolForInputType(combo, inputType) {
  if (inputType === 'vision' && combo.vision?.enabled && (combo.vision.models?.length || 0) > 0) {
    return {
      id: `${combo.id}:vision`,
      strategy: combo.vision.strategy || 'fallback',
      models: combo.vision.models,
      judgeModel: combo.judgeModel,
    };
  }
  if (inputType === 'audio' && combo.audio?.enabled && (combo.audio.models?.length || 0) > 0) {
    return {
      id: `${combo.id}:audio`,
      strategy: combo.audio.strategy || 'fallback',
      models: combo.audio.models,
      judgeModel: combo.judgeModel,
    };
  }
  return {
    id: combo.id,
    strategy: combo.strategy || 'fallback',
    models: combo.models || [],
    judgeModel: combo.judgeModel,
  };
}

/* ============================================================
   ADAPTERS
   ============================================================ */

/* --- OpenAI-compatible (openai, openrouter, deepseek, groq, xai,
       mistral, together, any custom baseUrl) --- */

async function callOpenAICompatible({ baseUrl, apiKey, model, req }) {
  let url = trim(baseUrl || 'https://api.openai.com/v1').replace(/\/+$/, '');
  if (!url.endsWith('/chat/completions')) url += '/chat/completions';

  const modelStr = String(model || 'gpt-4o-mini').toLowerCase();
  const isReasoning =
    modelStr.startsWith('o1') || modelStr.startsWith('o3') ||
    modelStr.includes('reasoner') || modelStr.includes('deepseek-r1');

  const payload = {
    model: model || 'gpt-4o-mini',
    messages: req.messages,
    stream: Boolean(req.stream),
  };
  if (isReasoning) {
    if (req.max_tokens) payload.max_completion_tokens = Number(req.max_tokens);
  } else {
    if (req.temperature != null) payload.temperature = Number(req.temperature);
    if (req.max_tokens) payload.max_tokens = Number(req.max_tokens);
  }
  if (req.tools) payload.tools = req.tools;

  const headers = { 'Content-Type': 'application/json' };
  if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`;
  if (url.includes('openrouter.ai')) {
    headers['HTTP-Referer'] = 'https://ai.studio';
    headers['X-Title'] = 'AI Connect Combo';
  }

  const upstream = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(payload),
  });

  if (!upstream.ok) {
    const errText = await upstream.text();
    let parsed = null;
    try { parsed = JSON.parse(errText); } catch { parsed = { message: errText }; }
    const msg = parsed?.error?.message || parsed?.message || `HTTP ${upstream.status}`;
    const err = new Error(msg);
    err.status = upstream.status;
    throw err;
  }

  return { upstream, kind: 'openai' };
}

/* --- Anthropic --- */

/**
 * Convert OpenAI-style content (string | array of parts) to Anthropic blocks.
 */
function anthropicContentFromOpenAI(content) {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return String(content || '');
  return content.map((c) => {
    if (typeof c === 'string') return { type: 'text', text: c };
    if (c.type === 'text') return { type: 'text', text: c.text || '' };
    if (c.type === 'image_url') {
      const url = (c.image_url && (c.image_url.url || c.image_url)) || '';
      const parsed = parseDataUrl(url);
      if (parsed) {
        return {
          type: 'image',
          source: { type: 'base64', media_type: parsed.mimeType, data: parsed.data },
        };
      }
      return { type: 'image', source: { type: 'url', url } };
    }
    // already Anthropic native
    if (c.type === 'image' && c.source) return c;
    return { type: 'text', text: '' };
  });
}

async function callAnthropic({ baseUrl, apiKey, model, req }) {
  let url = trim(baseUrl || 'https://api.anthropic.com').replace(/\/+$/, '');
  if (!url.endsWith('/v1/messages')) url += '/v1/messages';

  // Split system from messages
  let system = '';
  const msgs = [];
  for (const m of req.messages || []) {
    if (m.role === 'system') {
      system += (typeof m.content === 'string' ? m.content : JSON.stringify(m.content)) + '\n';
    } else {
      msgs.push({
        role: m.role === 'assistant' ? 'assistant' : 'user',
        content: anthropicContentFromOpenAI(m.content),
      });
    }
  }

  const modelName = model || 'claude-3-5-sonnet-20241022';
  const payload = {
    model: modelName,
    messages: msgs,
    max_tokens: Number(req.max_tokens) || 4096,
    stream: Boolean(req.stream),
  };
  if (system.trim()) payload.system = system.trim();
  if (req.temperature != null) payload.temperature = Number(req.temperature);
  if (req.tools) payload.tools = req.tools;

  const upstream = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify(payload),
  });

  if (!upstream.ok) {
    const errText = await upstream.text();
    let parsed = null;
    try { parsed = JSON.parse(errText); } catch { parsed = { message: errText }; }
    const msg = parsed?.error?.message || parsed?.message || `HTTP ${upstream.status}`;
    const err = new Error(msg);
    err.status = upstream.status;
    throw err;
  }

  return { upstream, kind: 'anthropic' };
}

/* --- Gemini --- */

/**
 * Convert OpenAI-style content into Gemini parts.
 * Handles text, image_url (data URLs), and native Gemini parts.
 */
function geminiContentsFromMessages(messages) {
  const contents = [];
  for (const m of messages || []) {
    if (m.role === 'system') continue;
    const role = m.role === 'assistant' ? 'model' : 'user';

    let parts;
    if (typeof m.content === 'string') {
      parts = [{ text: m.content }];
    } else if (Array.isArray(m.content)) {
      parts = m.content.map((c) => {
        if (typeof c === 'string') return { text: c };
        if (c.type === 'text') return { text: c.text || '' };
        if (c.type === 'image_url') {
          const url = (c.image_url && (c.image_url.url || c.image_url)) || '';
          const parsed = parseDataUrl(url);
          if (parsed) {
            return { inline_data: { mime_type: parsed.mimeType, data: parsed.data } };
          }
          return { text: `[image at ${url}]` };
        }
        // native gemini
        if (c.inline_data || c.file_data) return c;
        return { text: '' };
      });
    } else {
      parts = [{ text: String(m.content || '') }];
    }

    contents.push({ role, parts });
  }
  return contents;
}

async function callGemini({ baseUrl, apiKey, model, req }) {
  const base = trim(baseUrl || 'https://generativelanguage.googleapis.com').replace(/\/+$/, '');
  let modelToUse = model || 'gemini-2.5-flash';

  const contents = geminiContentsFromMessages(req.messages);
  const body = { contents };

  const sys = (req.messages || [])
    .filter((m) => m.role === 'system')
    .map((m) => (typeof m.content === 'string' ? m.content : ''))
    .join('\n').trim();
  if (sys) body.systemInstruction = { parts: [{ text: sys }] };

  if (req.temperature != null) {
    body.generationConfig = { ...(body.generationConfig || {}), temperature: Number(req.temperature) };
  }
  if (req.max_tokens) {
    body.generationConfig = { ...(body.generationConfig || {}), maxOutputTokens: Number(req.max_tokens) };
  }

  const method = req.stream ? 'streamGenerateContent' : 'generateContent';
  const url = `${base}/v1beta/models/${modelToUse}:${method}?key=${encodeURIComponent(apiKey)}${req.stream ? '&alt=sse' : ''}`;

  const upstream = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!upstream.ok) {
    const errText = await upstream.text();
    let parsed = null;
    try { parsed = JSON.parse(errText); } catch { parsed = { message: errText }; }
    const msg = parsed?.error?.message || parsed?.message || `HTTP ${upstream.status}`;
    const err = new Error(msg);
    err.status = upstream.status;
    throw err;
  }

  return { upstream, kind: 'gemini' };
}

/* --- Dispatcher --- */

async function callProvider({ provider, apiKey, model, req }) {
  const type = provider.type || 'openai-compatible';
  if (type === 'anthropic') {
    return callAnthropic({ baseUrl: provider.baseUrl, apiKey, model, req });
  }
  if (type === 'gemini') {
    return callGemini({ baseUrl: provider.baseUrl, apiKey, model, req });
  }
  return callOpenAICompatible({ baseUrl: provider.baseUrl, apiKey, model, req });
}

/* ============================================================
   RESPONSE CONVERTERS (to OpenAI shape)
   ============================================================ */

async function convertNonStreamToOpenAI({ upstream, kind, model }) {
  const raw = await upstream.json();

  if (kind === 'openai') return raw;

  if (kind === 'anthropic') {
    const text = (raw.content || []).map((c) => c.text || '').join('');
    return {
      id: raw.id || uid('chatcmpl'),
      object: 'chat.completion',
      created: Math.floor(now() / 1000),
      model: raw.model || model,
      choices: [{
        index: 0,
        message: { role: 'assistant', content: text },
        finish_reason: raw.stop_reason || 'stop',
      }],
      usage: raw.usage ? {
        prompt_tokens: raw.usage.input_tokens || 0,
        completion_tokens: raw.usage.output_tokens || 0,
        total_tokens: (raw.usage.input_tokens || 0) + (raw.usage.output_tokens || 0),
      } : undefined,
    };
  }

  if (kind === 'gemini') {
    const cand = raw.candidates?.[0];
    const text = (cand?.content?.parts || []).map((p) => p.text || '').join('');
    return {
      id: uid('chatcmpl'),
      object: 'chat.completion',
      created: Math.floor(now() / 1000),
      model,
      choices: [{
        index: 0,
        message: { role: 'assistant', content: text },
        finish_reason: cand?.finishReason || 'stop',
      }],
      usage: raw.usageMetadata ? {
        prompt_tokens: raw.usageMetadata.promptTokenCount || 0,
        completion_tokens: raw.usageMetadata.candidatesTokenCount || 0,
        total_tokens: raw.usageMetadata.totalTokenCount || 0,
      } : undefined,
    };
  }

  return raw;
}

/* --- Streaming: SSE transformation per provider --- */

function sseTransform(upstream, kind, model) {
  const { readable, writable } = new TransformStream();
  const writer = writable.getWriter();
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();

  const id = uid('chatcmpl');
  const created = Math.floor(now() / 1000);

  const sendChunk = async (delta, finish = null) => {
    const chunk = {
      id,
      object: 'chat.completion.chunk',
      created,
      model,
      choices: [{ index: 0, delta, finish_reason: finish }],
    };
    try {
      await writer.write(encoder.encode(`data: ${JSON.stringify(chunk)}\n\n`));
    } catch { /* client disconnected */ }
  };

  (async () => {
    const reader = upstream.body.getReader();
    let buf = '';
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split('\n');
        buf = lines.pop() || '';
        for (const line of lines) {
          const l = line.trim();
          if (!l.startsWith('data:')) continue;
          const data = l.slice(5).trim();
          if (data === '[DONE]') continue;
          let parsed;
          try { parsed = JSON.parse(data); } catch { continue; }

          if (kind === 'openai') {
            const delta = parsed.choices?.[0]?.delta;
            const finish = parsed.choices?.[0]?.finish_reason || null;
            if (delta || finish) await sendChunk(delta || {}, finish);
          } else if (kind === 'anthropic') {
            if (parsed.type === 'content_block_delta' && parsed.delta?.text) {
              await sendChunk({ content: parsed.delta.text });
            } else if (parsed.type === 'message_stop') {
              await sendChunk({}, 'stop');
            }
          } else if (kind === 'gemini') {
            const t = (parsed.candidates?.[0]?.content?.parts || []).map((p) => p.text || '').join('');
            if (t) await sendChunk({ content: t });
            const fr = parsed.candidates?.[0]?.finishReason;
            if (fr) await sendChunk({}, fr.toLowerCase());
          }
        }
      }
      await writer.write(encoder.encode('data: [DONE]\n\n'));
    } catch (e) {
      try {
        await writer.write(encoder.encode(`data: ${JSON.stringify({ error: e.message })}\n\n`));
      } catch {}
    } finally {
      try { await writer.close(); } catch {}
    }
  })();

  return readable;
}

/**
 * Wrap a non-stream JSON chat.completion into a proper SSE stream.
 * Used by fusion when the client requested streaming.
 */
function jsonToSse(completion) {
  const id = completion.id || uid('chatcmpl');
  const created = completion.created || Math.floor(now() / 1000);
  const model = completion.model || 'combo';
  const text = completion.choices?.[0]?.message?.content || '';
  const finish = completion.choices?.[0]?.finish_reason || 'stop';

  const chunk1 = {
    id, object: 'chat.completion.chunk', created, model,
    choices: [{ index: 0, delta: { role: 'assistant', content: text }, finish_reason: null }],
  };
  const chunk2 = {
    id, object: 'chat.completion.chunk', created, model,
    choices: [{ index: 0, delta: {}, finish_reason: finish }],
  };

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode(`data: ${JSON.stringify(chunk1)}\n\n`));
      controller.enqueue(encoder.encode(`data: ${JSON.stringify(chunk2)}\n\n`));
      controller.enqueue(encoder.encode('data: [DONE]\n\n'));
      controller.close();
    },
  });
  return stream;
}

/* ============================================================
   COMBO RUNNER
   ============================================================ */

async function resolveKeyForModel(env, model, cursor) {
  const provider = await providerGet(env, model.providerId);
  if (!provider) throw new Error(`Provider not found: ${model.providerId}`);

  let keys = await keyListRaw(env, { providerId: provider.id });
  keys = keys.filter(isKeyUsable);
  if (model.keyIds?.length) {
    keys = keys.filter((k) => model.keyIds.includes(k.id));
  }
  if (keys.length === 0) {
    return { provider, key: null };
  }
  const pick = keys[cursor % keys.length];
  return { provider, key: pick };
}

async function runCombo(env, combo, req) {
  const strategy = combo.strategy || 'fallback';
  const models = combo.models || [];
  if (models.length === 0) {
    throw new Error('Combo has no models in this pool');
  }

  if (strategy === 'fallback')    return runFallback(env, combo, req, models);
  if (strategy === 'round-robin') return runRoundRobin(env, combo, req, models);
  if (strategy === 'fusion')      return runFusion(env, combo, req, models);
  throw new Error(`Unknown strategy: ${strategy}`);
}

async function runFallback(env, combo, req, models) {
  let lastErr = null;
  for (let i = 0; i < models.length; i++) {
    const m = models[i];
    let usedKey = null;
    try {
      const { provider, key } = await resolveKeyForModel(env, m, 0);
      usedKey = key;
      const apiKey = key?.apiKey || keyFromEnvForProvider(env, provider);
      const result = await callProvider({
        provider,
        apiKey,
        model: m.modelName,
        req,
      });
      if (key?.id) await keyMarkSuccess(env, key.id);
      return { result, provider, key, model: m.modelName };
    } catch (e) {
      lastErr = e;
      if (usedKey?.id) {
        const cd = e.status === 429 ? 10 * 60_000 : 60_000;
        try { await keyMarkFail(env, usedKey.id, cd); } catch {}
      }
      // try next model
    }
  }
  throw lastErr || new Error('All models failed');
}

async function runRoundRobin(env, combo, req, models) {
  const start = await comboNextCursor(env, combo.id, models.length);
  const ordered = [];
  for (let i = 0; i < models.length; i++) {
    ordered.push(models[(start + i) % models.length]);
  }
  return runFallback(env, combo, req, ordered);
}

async function runFusion(env, combo, req, models) {
  const judgeModelId = combo.judgeModel;
  const panel = models.filter((m) => !judgeModelId || JSON.stringify(m) !== JSON.stringify(judgeModelId));

  const responses = await Promise.allSettled(
    panel.map(async (m) => {
      const { provider, key } = await resolveKeyForModel(env, m, 0);
      const apiKey = key?.apiKey || keyFromEnvForProvider(env, provider);
      const r = await callProvider({ provider, apiKey, model: m.modelName, req: { ...req, stream: false } });
      const openai = await convertNonStreamToOpenAI({ upstream: r.upstream, kind: r.kind, model: m.modelName });
      const text = openai.choices?.[0]?.message?.content || '';
      return { model: m.modelName, text };
    })
  );

  const candidates = responses
    .filter((r) => r.status === 'fulfilled')
    .map((r) => r.value)
    .filter((c) => c.text);

  if (candidates.length === 0) throw new Error('Fusion: all panel models failed');

  const wrap = (text, model) => ({
    upstream: new Response(JSON.stringify({
      id: uid('chatcmpl'),
      object: 'chat.completion',
      created: Math.floor(now() / 1000),
      model,
      choices: [{ index: 0, message: { role: 'assistant', content: text }, finish_reason: 'stop' }],
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }),
    kind: 'openai',
  });

  if (candidates.length === 1) {
    return { result: wrap(candidates[0].text, candidates[0].model), provider: null, key: null, model: candidates[0].model };
  }

  if (judgeModelId) {
    const judgeReq = {
      messages: [
        {
          role: 'system',
          content:
            'You are a judge. Given a user question and several candidate answers, choose the single best answer. Reply with ONLY the full text of the best answer, nothing else.',
        },
        {
          role: 'user',
          content:
            `Question:\n${JSON.stringify(req.messages)}\n\nCandidates:\n` +
            candidates.map((c, i) => `--- Candidate ${i + 1} (${c.model}) ---\n${c.text}`).join('\n\n'),
        },
      ],
      temperature: 0,
      stream: false,
    };
    try {
      const { provider, key } = await resolveKeyForModel(env, judgeModelId, 0);
      const apiKey = key?.apiKey || keyFromEnvForProvider(env, provider);
      const r = await callProvider({ provider, apiKey, model: judgeModelId.modelName, req: judgeReq });
      const judged = await convertNonStreamToOpenAI({ upstream: r.upstream, kind: r.kind, model: judgeModelId.modelName });
      return {
        result: {
          upstream: new Response(JSON.stringify(judged), { status: 200, headers: { 'Content-Type': 'application/json' } }),
          kind: 'openai',
        },
        provider, key, model: 'fusion-judge',
      };
    } catch { /* fall through to longest answer */ }
  }

  candidates.sort((a, b) => b.text.length - a.text.length);
  const best = candidates[0];
  return { result: wrap(best.text, best.model), provider: null, key: null, model: best.model };
}

function keyFromEnvForProvider(env, provider) {
  const t = provider.type;
  const map = {
    openai: 'OPENAI_API_KEY',
    anthropic: 'ANTHROPIC_API_KEY',
    gemini: 'GEMINI_API_KEY',
    openrouter: 'OPENROUTER_API_KEY',
    deepseek: 'DEEPSEEK_API_KEY',
    groq: 'GROQ_API_KEY',
    xai: 'XAI_API_KEY',
    mistral: 'MISTRAL_API_KEY',
    together: 'TOGETHER_API_KEY',
  };
  const name = map[t];
  return name ? envKey(env, name) : '';
}

/* ============================================================
   ROUTE HANDLERS: PROVIDERS / KEYS / COMBOS
   ============================================================ */

async function handleProvidersList(env) {
  return json({ providers: await providerList(env) }, 200, CORS);
}

async function handleProviderGet(env, id) {
  const p = await providerGet(env, id);
  if (!p) return json({ error: 'not found' }, 404, CORS);
  return json({ provider: p }, 200, CORS);
}

async function handleProviderCreate(req, env) {
  const body = await req.json().catch(() => ({}));
  try {
    const p = await providerSave(env, body);
    return json({ provider: p }, 200, CORS);
  } catch (e) {
    return json({ error: e.message }, 400, CORS);
  }
}

async function handleProviderUpdate(req, env, id) {
  const body = await req.json().catch(() => ({}));
  const existing = await providerGet(env, id);
  if (!existing) return json({ error: 'not found' }, 404, CORS);
  try {
    const p = await providerSave(env, { ...existing, ...body, id });
    return json({ provider: p }, 200, CORS);
  } catch (e) {
    return json({ error: e.message }, 400, CORS);
  }
}

async function handleProviderDelete(env, id) {
  await providerDelete(env, id);
  return json({ ok: true }, 200, CORS);
}

async function handleKeysList(req, env) {
  const url = new URL(req.url);
  const providerId = url.searchParams.get('providerId') || undefined;
  return json({ keys: await keyList(env, { providerId }) }, 200, CORS);
}

async function handleKeyCreate(req, env) {
  const body = await req.json().catch(() => ({}));
  if (!body.providerId) return json({ error: 'providerId is required' }, 400, CORS);
  if (!body.apiKey) return json({ error: 'apiKey is required' }, 400, CORS);
  const k = await keySave(env, body);
  return json({ key: { ...k, apiKey: undefined, apiKeyMasked: maskKey(k.apiKey) } }, 200, CORS);
}

async function handleKeyUpdate(req, env, id) {
  const body = await req.json().catch(() => ({}));
  const existing = await keyGet(env, id);
  if (!existing) return json({ error: 'not found' }, 404, CORS);
  const k = await keySave(env, { ...existing, ...body, id });
  return json({ key: { ...k, apiKey: undefined, apiKeyMasked: maskKey(k.apiKey) } }, 200, CORS);
}

async function handleKeyDelete(env, id) {
  await keyDelete(env, id);
  return json({ ok: true }, 200, CORS);
}

async function handleCombosList(env) {
  return json({ combos: await comboList(env) }, 200, CORS);
}

async function handleComboGet(env, id) {
  const c = await comboGet(env, id);
  if (!c) return json({ error: 'not found' }, 404, CORS);
  return json({ combo: c }, 200, CORS);
}

async function handleComboCreate(req, env) {
  const body = await req.json().catch(() => ({}));
  try {
    const c = await comboSave(env, body);
    return json({ combo: c }, 200, CORS);
  } catch (e) {
    return json({ error: e.message }, 400, CORS);
  }
}

async function handleComboUpdate(req, env, id) {
  const body = await req.json().catch(() => ({}));
  const existing = await comboGet(env, id);
  if (!existing) return json({ error: 'not found' }, 404, CORS);
  try {
    const c = await comboSave(env, { ...existing, ...body, id });
    return json({ combo: c }, 200, CORS);
  } catch (e) {
    return json({ error: e.message }, 400, CORS);
  }
}

async function handleComboDelete(env, id) {
  await comboDelete(env, id);
  return json({ ok: true }, 200, CORS);
}

/* ---------- Endpoint Keys ---------- */

async function handleEpKeyCreate(req, env, comboId) {
  const body = await req.json().catch(() => ({}));
  const combo = await comboGet(env, comboId);
  if (!combo) return json({ error: 'combo not found' }, 404, CORS);
  const created = await epKeyCreate(env, comboId, {
    label: body.label || '',
    isDefault: Boolean(body.isDefault),
  });
  return json({
    ok: true,
    key: {
      id: created.id,
      label: created.label,
      isDefault: created.isDefault,
      plain: created.plain,
      baseUrl: endpointBaseUrl(req, comboId),
    },
  }, 200, CORS);
}

async function handleEpKeyList(req, env, comboId) {
  const list = await epKeyListForCombo(env, comboId);
  return json({
    keys: list,
    baseUrl: endpointBaseUrl(req, comboId),
  }, 200, CORS);
}

async function handleEpKeyRevoke(env, hash) {
  const ok = await epKeyRevoke(env, hash);
  return json({ ok }, ok ? 200 : 404, CORS);
}

function endpointBaseUrl(req, comboId) {
  const u = new URL(req.url);
  return `${u.protocol}//${u.host}/c/${comboId}/v1`;
}

/* ============================================================
   ENDPOINT ROUTER  /c/:comboId/v1/chat/completions
   ============================================================ */

function extractBearer(req) {
  const auth = req.headers.get('authorization') || '';
  const m = auth.match(/^Bearer\s+(.+)$/i);
  if (m) return m[1].trim();
  const x = req.headers.get('x-api-key') || req.headers.get('x-goog-api-key');
  return x ? x.trim() : '';
}

async function handleComboEndpoint(req, env, comboId, subPath) {
  const combo = await comboGet(env, comboId);
  if (!combo) return json({ error: { message: 'Combo not found', type: 'invalid_request_error' } }, 404, CORS);

  // Auth
  if (combo.endpoint?.requireKey !== false) {
    const key = extractBearer(req);
    if (!key) {
      return json({ error: { message: 'Missing API key', type: 'invalid_request_error', code: 'missing_api_key' } }, 401, CORS);
    }
    const rec = await epKeyVerify(env, comboId, key);
    if (!rec) {
      return json({ error: { message: 'Invalid API key', type: 'invalid_request_error', code: 'invalid_api_key' } }, 401, CORS);
    }
    await epKeyTouch(env, rec.keyHash);
  }

  // Only chat/completions is supported for now
  if (!subPath.endsWith('/chat/completions')) {
    if (subPath.endsWith('/models')) {
      const allModels = [
        ...(combo.models || []),
        ...(combo.vision?.models || []),
        ...(combo.audio?.models || []),
      ];
      const seen = new Set();
      const data = [];
      for (const m of allModels) {
        const id = m.modelName || `model-${data.length}`;
        if (seen.has(id)) continue;
        seen.add(id);
        data.push({ id, object: 'model', owned_by: m.providerId || 'combo' });
      }
      return json({ object: 'list', data }, 200, CORS);
    }
    return json({ error: { message: `Unsupported endpoint: ${subPath}` } }, 404, CORS);
  }

  const body = await req.json().catch(() => ({}));
  const internal = normalizeIncomingOpenAI(body);

  // NEW: detect input type & route to the right pool
  const inputType = detectInputType(internal.messages);
  const activePool = pickPoolForInputType(combo, inputType);

  try {
    const { result } = await runCombo(env, activePool, internal);

    if (internal.stream) {
      const ct = result.upstream.headers.get('content-type') || '';
      if (ct.includes('application/json')) {
        // fusion or already-wrapped result → convert to SSE
        const data = await result.upstream.json();
        const stream = jsonToSse(data);
        return new Response(stream, {
          status: 200,
          headers: {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            Connection: 'keep-alive',
            ...CORS,
          },
        });
      }
      const stream = sseTransform(result.upstream, result.kind, internal.model || 'combo');
      return new Response(stream, {
        status: 200,
        headers: {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          Connection: 'keep-alive',
          ...CORS,
        },
      });
    }

    const openai = await convertNonStreamToOpenAI({
      upstream: result.upstream,
      kind: result.kind,
      model: internal.model || 'combo',
    });
    return json(openai, 200, CORS);
  } catch (e) {
    return json(
      { error: { message: e.message || 'Combo failed', type: 'server_error' } },
      e.status || 500,
      CORS
    );
  }
}

/* ============================================================
   LEGACY ROUTES (phase 1+2)
   ============================================================ */

function geminiContents(input) {
  if (typeof input === 'string') return [{ parts: [{ text: input }] }];
  return input;
}

async function geminiGenerate({ env, model, contents, systemInstruction, enableSearch }) {
  const key = envKey(env, 'GEMINI_API_KEY');
  if (!key) throw new Error('GEMINI_API_KEY is not configured on this Worker');
  let modelToUse = model || 'gemini-2.5-flash';
  const body = { contents: geminiContents(contents) };
  if (systemInstruction) body.systemInstruction = { parts: [{ text: systemInstruction }] };
  if (enableSearch) body.tools = [{ googleSearch: {} }];

  const call = async (m) => {
    const r = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${m}:generateContent?key=${key}`,
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }
    );
    const data = await r.json().catch(() => ({}));
    if (!r.ok) {
      const msg = data?.error?.message || `Gemini API error ${r.status}`;
      const err = new Error(msg);
      err.status = r.status;
      throw err;
    }
    return data;
  };

  try {
    return await call(modelToUse);
  } catch (e) {
    if (modelToUse !== 'gemini-2.5-flash' && /404|not found|no longer available/i.test(e.message || '')) {
      return await call('gemini-2.5-flash');
    }
    throw e;
  }
}

function geminiText(data) {
  const parts = data?.candidates?.[0]?.content?.parts || [];
  return parts.map((p) => p.text || '').join('');
}

function geminiWebSources(data) {
  const chunks = data?.candidates?.[0]?.groundingMetadata?.groundingChunks || [];
  return chunks
    .filter((c) => c.web?.uri && c.web?.title)
    .map((c) => ({ title: c.web.title, url: c.web.uri }));
}

async function handleSearch(req, env) {
  const { query } = await req.json().catch(() => ({}));
  if (!query || typeof query !== 'string') {
    return json({ error: 'Search query is required' }, 400, CORS);
  }
  const results = [];

  if (envKey(env, 'GEMINI_API_KEY')) {
    try {
      const data = await geminiGenerate({
        env,
        model: 'gemini-2.5-flash',
        contents: `Search the web and provide relevant information and sources for: "${query}"`,
        enableSearch: true,
      });
      const text = geminiText(data).slice(0, 180);
      for (const s of geminiWebSources(data)) {
        results.push({ title: s.title, snippet: text, url: s.url });
      }
    } catch {}
  }

  if (results.length === 0) {
    try {
      const response = await fetch(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`, {
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'fa,en-US,en;q=0.9',
        },
      });
      if (response.ok) {
        const html = await response.text();
        const blocks = html.split('<div class="result results_links');
        for (let i = 1; i < Math.min(blocks.length, 7); i++) {
          const block = blocks[i];
          const titleMatch = block.match(/<a[^>]+class="result__a"[^>]*>([\s\S]*?)<\/a>/);
          const snippetMatch = block.match(/<a[^>]+class="result__snippet"[^>]*>([\s\S]*?)<\/a>/);
          if (titleMatch) {
            let url = '';
            const hrefMatch = block.match(/href="([^"]+)"/);
            if (hrefMatch) {
              const uddg = hrefMatch[1].match(/uddg=([^&]+)/);
              url = uddg ? decodeURIComponent(uddg[1]) : hrefMatch[1];
            }
            const cleanTitle = titleMatch[1].replace(/<[^>]*>/g, '').trim();
            const cleanSnippet = snippetMatch ? snippetMatch[1].replace(/<[^>]*>/g, '').trim() : '';
            if (cleanTitle && url && !url.includes('duckduckgo.com')) {
              results.push({ title: cleanTitle, snippet: cleanSnippet, url: url.startsWith('//') ? 'https:' + url : url });
            }
          }
        }
      }
    } catch {}
  }

  if (results.length === 0) {
    try {
      const wikiRes = await fetch(
        `https://fa.wikipedia.org/w/api.php?action=opensearch&search=${encodeURIComponent(query)}&limit=5&format=json`
      );
      if (wikiRes.ok) {
        const [, titles = [], snippets = [], urls = []] = await wikiRes.json();
        for (let i = 0; i < titles.length; i++) {
          if (titles[i] && urls[i]) {
            results.push({ title: titles[i], snippet: snippets[i] || titles[i], url: urls[i] });
          }
        }
      }
    } catch {}
  }

  return json({ results }, 200, CORS);
}

async function handleProxyOpenAI(req, env) {
  const { baseUrl, apiKey, model, messages, temperature = 0.7, max_tokens, stream = false } =
    await req.json().catch(() => ({}));

  const isLocal = Boolean(baseUrl && (baseUrl.includes('localhost') || baseUrl.includes('127.0.0.1') || baseUrl.includes(':11434')));

  let keyToUse = trim(apiKey);
  if (!keyToUse && !isLocal) {
    const u = String(baseUrl || '').toLowerCase();
    if (u.includes('deepseek.com')) keyToUse = envKey(env, 'DEEPSEEK_API_KEY');
    else if (u.includes('groq.com')) keyToUse = envKey(env, 'GROQ_API_KEY');
    else if (u.includes('openrouter.ai')) keyToUse = envKey(env, 'OPENROUTER_API_KEY');
    else if (u.includes('x.ai')) keyToUse = envKey(env, 'XAI_API_KEY');
    else if (u.includes('mistral.ai')) keyToUse = envKey(env, 'MISTRAL_API_KEY');
    else if (u.includes('together.xyz')) keyToUse = envKey(env, 'TOGETHER_API_KEY');
    else if (u.includes('openai.com') || !baseUrl) keyToUse = envKey(env, 'OPENAI_API_KEY');
  }
  if (!keyToUse && !isLocal) {
    return json({ error: 'کلید API برای این سرویس دهنده تنظیم نشده است.' }, 400, CORS);
  }

  let targetUrl = trim(baseUrl || 'https://api.openai.com/v1').replace(/\/+$/, '');
  if (!targetUrl.endsWith('/chat/completions')) targetUrl += '/chat/completions';

  try {
    const modelStr = String(model || 'gpt-4o-mini').toLowerCase();
    const isReasoning =
      modelStr.startsWith('o1') || modelStr.startsWith('o3') || modelStr.includes('reasoner') || modelStr.includes('deepseek-r1');
    const payload = { model: model || 'gpt-4o-mini', messages, stream: Boolean(stream) };
    if (isReasoning) {
      if (max_tokens) payload.max_completion_tokens = Number(max_tokens);
    } else {
      payload.temperature = Number(temperature) ?? 0.7;
      if (max_tokens) payload.max_tokens = Number(max_tokens);
    }
    const headers = { 'Content-Type': 'application/json' };
    if (keyToUse) headers['Authorization'] = `Bearer ${keyToUse}`;
    if (targetUrl.includes('openrouter.ai')) {
      headers['HTTP-Referer'] = 'https://ai.studio';
      headers['X-Title'] = 'Telegram AI Agent Hub';
    }

    const upstream = await fetch(targetUrl, { method: 'POST', headers, body: JSON.stringify(payload) });
    if (!upstream.ok) {
      const errText = await upstream.text();
      let parsed = null;
      try { parsed = JSON.parse(errText); } catch { parsed = { message: errText }; }
      return json({ error: parsed?.error?.message || parsed?.message || `خطای API: ${upstream.statusText}`, status: upstream.status }, upstream.status, CORS);
    }
    if (stream) {
      return new Response(upstream.body, {
        headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive', ...CORS },
      });
    }
    return json(await upstream.json(), 200, CORS);
  } catch (e) {
    return json({ error: e.message || 'خطا در برقراری ارتباط با سرویس هوش مصنوعی' }, 500, CORS);
  }
}

async function handleProxyAnthropic(req, env) {
  const { baseUrl, apiKey, model, messages, system, temperature = 0.7, max_tokens = 4096, stream = false } =
    await req.json().catch(() => ({}));
  const keyToUse = trim(apiKey || env.ANTHROPIC_API_KEY);
  if (!keyToUse) {
    return json({ error: 'کلید API آنتروپیک الزامی است' }, 400, CORS);
  }
  let targetUrl = trim(baseUrl || 'https://api.anthropic.com').replace(/\/+$/, '');
  if (!targetUrl.endsWith('/v1/messages')) targetUrl += '/v1/messages';

  try {
    const payload = {
      model: model || 'claude-3-5-sonnet-20241022',
      messages,
      max_tokens: Number(max_tokens) || 4096,
      stream: Boolean(stream),
    };
    payload.temperature = Number(temperature) || 0.7;
    if (system) payload.system = system;

    const upstream = await fetch(targetUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': keyToUse, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify(payload),
    });
    if (!upstream.ok) {
      const errText = await upstream.text();
      let parsed = null;
      try { parsed = JSON.parse(errText); } catch { parsed = { message: errText }; }
      return json({ error: parsed?.error?.message || parsed?.message || `خطای Anthropic: ${upstream.statusText}`, status: upstream.status }, upstream.status, CORS);
    }
    if (stream) {
      return new Response(upstream.body, {
        headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive', ...CORS },
      });
    }
    return json(await upstream.json(), 200, CORS);
  } catch (e) {
    return json({ error: e.message || 'خطا در ارتباط با آنتروپیک' }, 500, CORS);
  }
}

async function handleProxyGemini(req, env) {
  const { apiKey, model = 'gemini-2.5-pro', contents, systemInstruction, enableSearch = false } =
    await req.json().catch(() => ({}));
  const keyToUse = trim(apiKey || env.GEMINI_API_KEY);
  if (!keyToUse) {
    return json({ error: 'کلید API گوگل جمینای تنظیم نشده است' }, 400, CORS);
  }
  try {
    const data = await geminiGenerate({
      env: { ...env, GEMINI_API_KEY: keyToUse },
      model,
      contents,
      systemInstruction,
      enableSearch,
    });
    return json({ text: geminiText(data), webSources: geminiWebSources(data).map((s) => ({ title: s.title, url: s.url })) }, 200, CORS);
  } catch (e) {
    return json({ error: e.message || 'خطا در برقراری ارتباط با Google Gemini' }, e.status || 500, CORS);
  }
}

function handleConfigStatus(env) {
  const has = (n) => Boolean(trim(env[n]));
  return json(
    {
      hasGeminiKey: has('GEMINI_API_KEY'),
      hasOpenAIKey: has('OPENAI_API_KEY'),
      hasAnthropicKey: has('ANTHROPIC_API_KEY'),
      hasDeepSeekKey: has('DEEPSEEK_API_KEY'),
      hasGroqKey: has('GROQ_API_KEY'),
      hasOpenRouterKey: has('OPENROUTER_API_KEY'),
      hasXAIKey: has('XAI_API_KEY'),
      hasMistralKey: has('MISTRAL_API_KEY'),
      hasTogetherKey: has('TOGETHER_API_KEY'),
    },
    200,
    CORS
  );
}

/* ============================================================
   TELEGRAM (phase 2)
   ============================================================ */

const TG_DEFAULTS = {
  botToken: '',
  customApiUrl: '',
  botInfo: null,
  defaultAgentId: 'gemini-pro',
  enabled: false,
  autoReply: true,
  systemPrompt: 'شما یک ربات هوش مصنوعی تلگرام هستید. به تمام پرسش‌ها با زبان فارسی سلیس، شیوا و راهنما پاسخ دهید.',
};

const memFallback = { config: null, logs: [], lastUpdateId: 0 };

function kvStore(env) {
  return env.CHATBOT_STATE || null;
}

async function tgLoadConfig(env) {
  const store = kvStore(env);
  let cfg = null;
  if (store) {
    try { cfg = await store.get('tg:config', 'json'); } catch { cfg = null; }
  } else if (memFallback.config) {
    cfg = memFallback.config;
  }
  return {
    ...TG_DEFAULTS,
    botToken: trim(env.TELEGRAM_BOT_TOKEN),
    customApiUrl: trim(env.TELEGRAM_API_BASE_URL),
    ...(cfg || {}),
  };
}

async function tgSaveConfig(env, patch) {
  const current = await tgLoadConfig(env);
  const next = { ...current };
  if (typeof patch.botToken === 'string') next.botToken = trim(patch.botToken);
  if (typeof patch.customApiUrl === 'string') next.customApiUrl = trim(patch.customApiUrl);
  if (typeof patch.defaultAgentId === 'string') next.defaultAgentId = patch.defaultAgentId;
  if (typeof patch.enabled === 'boolean') next.enabled = patch.enabled;
  if (typeof patch.autoReply === 'boolean') next.autoReply = patch.autoReply;
  if (typeof patch.systemPrompt === 'string') next.systemPrompt = patch.systemPrompt;
  if (patch.botInfo !== undefined) next.botInfo = patch.botInfo;
  const store = kvStore(env);
  if (store) {
    await store.put('tg:config', JSON.stringify(next));
  } else {
    memFallback.config = next;
  }
  return next;
}

async function tgGetLogs(env, limit = 40) {
  const store = kvStore(env);
  if (store) {
    try {
      const logs = (await store.get('tg:logs', 'json')) || [];
      return logs.slice(-limit);
    } catch { return []; }
  }
  return memFallback.logs.slice(-limit);
}

async function tgPushLogs(env, entries) {
  const store = kvStore(env);
  if (store) {
    const logs = await tgGetLogs(env, 1000);
    logs.push(...entries);
    await store.put('tg:logs', JSON.stringify(logs.slice(-100)));
  } else {
    memFallback.logs.push(...entries);
    memFallback.logs = memFallback.logs.slice(-100);
  }
}

async function tgClearLogs(env) {
  const store = kvStore(env);
  if (store) await store.put('tg:logs', JSON.stringify([]));
  else memFallback.logs = [];
}

async function tgGetLastUpdateId(env) {
  const store = kvStore(env);
  if (store) {
    const v = await store.get('tg:lastUpdateId');
    return Number(v) || 0;
  }
  return memFallback.lastUpdateId;
}

async function tgSetLastUpdateId(env, id) {
  const store = kvStore(env);
  if (store) await store.put('tg:lastUpdateId', String(id));
  else memFallback.lastUpdateId = id;
}

function tgApiBase(cfg, overrideUrl) {
  const url = trim(overrideUrl || cfg.customApiUrl).replace(/\/+$/, '');
  return url || 'https://api.telegram.org';
}

async function tgAIReply(env, userPrompt, systemInstruction) {
  if (!envKey(env, 'GEMINI_API_KEY')) {
    return 'کلید سرویس هوش مصنوعی (GEMINI_API_KEY) روی سرور فعال نیست.';
  }
  try {
    const data = await geminiGenerate({
      env,
      model: 'gemini-2.5-flash',
      contents: userPrompt,
      systemInstruction:
        systemInstruction || 'شما ربات هوشمند تلگرام هستید. به زبان فارسی صمیمی، دقیق و کوتاه پاسخ دهید.',
    });
    return geminiText(data) || 'پاسخی از هوش مصنوعی دریافت نشد.';
  } catch (e) {
    return `متأسفانه در پاسخ هوش مصنوعی خطایی رخ داد: ${e.message || 'خطای ناشناخته'}`;
  }
}

function tgFromUser(msg) {
  if (msg.from?.username) return `@${msg.from.username}`;
  return `${msg.from?.first_name || ''} ${msg.from?.last_name || ''}`.trim() || 'کاربر تلگرام';
}

async function handleTelegramTest(req, env) {
  const { botToken, customApiUrl } = await req.json().catch(() => ({}));
  const cfg = await tgLoadConfig(env);
  const tokenToUse = trim(botToken || cfg.botToken);
  const apiBase = tgApiBase(cfg, customApiUrl);
  if (!tokenToUse) {
    return json({ ok: false, error: 'توکن ربات تلگرام الزامی است.' }, 400, CORS);
  }
  try {
    const tgRes = await fetch(`${apiBase}/bot${tokenToUse}/getMe`);
    const data = await tgRes.json();
    if (data.ok) {
      const patch = { botToken: tokenToUse, botInfo: data.result };
      if (customApiUrl !== undefined) patch.customApiUrl = trim(customApiUrl);
      await tgSaveConfig(env, patch);
      return json({
        ok: true,
        result: data.result,
        message: `اتصال به ربات ${data.result.first_name} (@${data.result.username || 'بدون یوزرنیم'}) با موفقیت برقرار شد.`,
      }, 200, CORS);
    }
    return json({ ok: false, error: data.description || 'توکن نامعتبر است.' }, 400, CORS);
  } catch (e) {
    return json({ ok: false, error: `عدم امکان برقراری ارتباط با ${apiBase}: ${e.message}` }, 500, CORS);
  }
}

async function handleTelegramStatus(env) {
  const cfg = await tgLoadConfig(env);
  return json({
    config: {
      botToken: cfg.botToken ? `${cfg.botToken.slice(0, 10)}...` : '',
      hasToken: Boolean(cfg.botToken),
      customApiUrl: cfg.customApiUrl || '',
      botInfo: cfg.botInfo || null,
      enabled: cfg.enabled,
      autoReply: cfg.autoReply,
      defaultAgentId: cfg.defaultAgentId || 'gemini-pro',
    },
    logs: await tgGetLogs(env, 30),
  }, 200, CORS);
}

async function handleTelegramConfig(req, env) {
  const body = await req.json().catch(() => ({}));
  const next = await tgSaveConfig(env, body);
  return json({ ok: true, message: 'تنظیمات ذخیره شد.', config: next }, 200, CORS);
}

async function handleTelegramSend(req, env) {
  const { botToken, customApiUrl, chatId, text, parseMode } = await req.json().catch(() => ({}));
  const cfg = await tgLoadConfig(env);
  const tokenToUse = trim(botToken || cfg.botToken);
  const apiBase = tgApiBase(cfg, customApiUrl);
  if (!tokenToUse) return json({ ok: false, error: 'توکن ربات تنظیم نشده است.' }, 400, CORS);
  if (!chatId || !text) return json({ ok: false, error: 'chatId و text الزامی است.' }, 400, CORS);
  try {
    const payload = { chat_id: chatId, text: String(text) };
    if (parseMode) payload.parse_mode = parseMode;
    const tgRes = await fetch(`${apiBase}/bot${tokenToUse}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await tgRes.json();
    if (data.ok) return json({ ok: true, result: data.result }, 200, CORS);
    return json({ ok: false, error: data.description || 'خطا در ارسال' }, 400, CORS);
  } catch (e) {
    return json({ ok: false, error: e.message }, 500, CORS);
  }
}

async function processTelegramMessage(env, msg, { autoReply, systemPrompt } = {}) {
  const chatId = msg.chat?.id;
  const userText = msg.text;
  if (!chatId || !userText) return null;
  const cfg = await tgLoadConfig(env);
  const logEntry = {
    id: `msg-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    timestamp: msg.date ? msg.date * 1000 : Date.now(),
    from: tgFromUser(msg),
    text: userText,
    chatId,
    status: 'received',
  };
  const shouldReply = (autoReply ?? cfg.autoReply) && cfg.botToken;
  if (shouldReply) {
    const reply = await tgAIReply(env, userText, systemPrompt || cfg.systemPrompt);
    logEntry.reply = reply;
    logEntry.status = 'replied';
    try {
      await fetch(`${tgApiBase(cfg)}/bot${cfg.botToken}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: chatId, text: reply }),
      });
    } catch {
      logEntry.status = 'error';
    }
  }
  await tgPushLogs(env, [logEntry]);
  return logEntry;
}

async function handleTelegramWebhook(req, env, ctx) {
  if (envKey(env, 'TG_WEBHOOK_SECRET')) {
    const got = req.headers.get('X-Telegram-Bot-Api-Secret-Token') || '';
    if (got !== trim(env.TG_WEBHOOK_SECRET)) {
      return json({ ok: false, error: 'unauthorized' }, 401, CORS);
    }
  }
  const update = await req.json().catch(() => null);
  if (update?.message && ctx?.waitUntil) {
    ctx.waitUntil(processTelegramMessage(env, update.message).catch(() => null));
  } else if (update?.message) {
    await processTelegramMessage(env, update.message).catch(() => null);
  }
  return json({ ok: true }, 200, CORS);
}

async function handleTelegramPoll(req, env) {
  const { botToken, customApiUrl, autoReply = true, systemPrompt } = await req.json().catch(() => ({}));
  const cfg = await tgLoadConfig(env);
  const tokenToUse = trim(botToken || cfg.botToken);
  const apiBase = tgApiBase(cfg, customApiUrl);
  if (!tokenToUse) return json({ ok: false, error: 'توکن ربات الزامی است.' }, 400, CORS);
  try {
    const lastId = await tgGetLastUpdateId(env);
    const tgRes = await fetch(`${apiBase}/bot${tokenToUse}/getUpdates?offset=${lastId + 1}&limit=10&timeout=0`);
    const data = await tgRes.json();
    if (!data.ok) return json({ ok: false, error: data.description || 'خطا در دریافت پیام‌ها' }, 400, CORS);
    const processed = [];
    for (const update of data.result || []) {
      if (update.update_id > lastId) await tgSetLastUpdateId(env, update.update_id);
      if (update.message?.text) {
        const entry = await processTelegramMessage(env, update.message, { autoReply, systemPrompt });
        if (entry) processed.push(entry);
      }
    }
    return json({ ok: true, newMessagesCount: processed.length, messages: processed, allLogs: await tgGetLogs(env, 25) }, 200, CORS);
  } catch (e) {
    return json({ ok: false, error: e.message }, 500, CORS);
  }
}

/* ============================================================
   MAIN FETCH
   ============================================================ */

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, '') || '/';

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS });
    }

    /* ---------- Combo Endpoint: /c/:comboId/v1/... ---------- */
    const comboMatch = path.match(/^\/c\/([^/]+)\/v1(\/.*)?$/);
    if (comboMatch) {
      const comboId = decodeURIComponent(comboMatch[1]);
      const sub = comboMatch[2] || '';
      return handleComboEndpoint(request, env, comboId, `/v1${sub}`);
    }

    /* ---------- Management API ---------- */

    if (path === '/api/health' || path === '/health') {
      return json({ status: 'ok', timestamp: new Date().toISOString(), service: 'chatbot-api' }, 200, CORS);
    }

    if (path === '/api/config/status' && request.method === 'GET') {
      return handleConfigStatus(env);
    }

    if (path === '/api/search' && request.method === 'POST') return handleSearch(request, env);
    if (path === '/api/proxy/openai' && request.method === 'POST') return handleProxyOpenAI(request, env);
    if (path === '/api/proxy/anthropic' && request.method === 'POST') return handleProxyAnthropic(request, env);
    if (path === '/api/proxy/gemini' && request.method === 'POST') return handleProxyGemini(request, env);

    /* ---------- Providers ---------- */
    if (path === '/api/providers' && request.method === 'GET') return handleProvidersList(env);
    if (path === '/api/providers' && request.method === 'POST') return handleProviderCreate(request, env);
    {
      const m = path.match(/^\/api\/providers\/([^/]+)$/);
      if (m) {
        const id = decodeURIComponent(m[1]);
        if (request.method === 'GET') return handleProviderGet(env, id);
        if (request.method === 'PUT') return handleProviderUpdate(request, env, id);
        if (request.method === 'DELETE') return handleProviderDelete(env, id);
      }
    }

    /* ---------- Keys ---------- */
    if (path === '/api/keys' && request.method === 'GET') return handleKeysList(request, env);
    if (path === '/api/keys' && request.method === 'POST') return handleKeyCreate(request, env);
    {
      const m = path.match(/^\/api\/keys\/([^/]+)$/);
      if (m) {
        const id = decodeURIComponent(m[1]);
        if (request.method === 'PUT') return handleKeyUpdate(request, env, id);
        if (request.method === 'DELETE') return handleKeyDelete(env, id);
      }
    }

    /* ---------- Combos ---------- */
    if (path === '/api/combos' && request.method === 'GET') return handleCombosList(env);
    if (path === '/api/combos' && request.method === 'POST') return handleComboCreate(request, env);
    {
      const m = path.match(/^\/api\/combos\/([^/]+)$/);
      if (m) {
        const id = decodeURIComponent(m[1]);
        if (request.method === 'GET') return handleComboGet(env, id);
        if (request.method === 'PUT') return handleComboUpdate(request, env, id);
        if (request.method === 'DELETE') return handleComboDelete(env, id);
      }
    }

    /* ---------- Endpoint Keys per combo ---------- */
    {
      const m = path.match(/^\/api\/combos\/([^/]+)\/endpoint\/keys$/);
      if (m) {
        const comboId = decodeURIComponent(m[1]);
        if (request.method === 'GET') return handleEpKeyList(request, env, comboId);
        if (request.method === 'POST') return handleEpKeyCreate(request, env, comboId);
      }
    }
    {
      const m = path.match(/^\/api\/endpoint-keys\/([^/]+)\/revoke$/);
      if (m && request.method === 'POST') {
        return handleEpKeyRevoke(env, decodeURIComponent(m[1]));
      }
    }

    /* ---------- Telegram ---------- */
    if (path === '/api/telegram/test' && request.method === 'POST') return handleTelegramTest(request, env);
    if (path === '/api/telegram/status' && request.method === 'GET') return handleTelegramStatus(env);
    if (path === '/api/telegram/config' && request.method === 'POST') return handleTelegramConfig(request, env);
    if (path === '/api/telegram/send' && request.method === 'POST') return handleTelegramSend(request, env);
    if (path === '/api/telegram/webhook' && request.method === 'POST') return handleTelegramWebhook(request, env, ctx);
    if (path === '/api/telegram/poll' && request.method === 'POST') return handleTelegramPoll(request, env);
    if (path === '/api/telegram/logs' && request.method === 'GET') {
      return json({ logs: await tgGetLogs(env, 40) }, 200, CORS);
    }
    if (path === '/api/telegram/logs/clear' && request.method === 'POST') {
      await tgClearLogs(env);
      return json({ ok: true, message: 'لاگ‌ها پاک شد.' }, 200, CORS);
    }

    return json({ error: 'not found' }, 404, CORS);
  },
};
