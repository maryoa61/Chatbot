/* ============================================================
   Chatbot — Cloudflare Worker (API backend) v1.1 — PHASE 1+2
   ------------------------------------------------------------
   Port of the Express server (server.ts), minus static file serving
   (frontend deploys to Pages / any static host).

   Phase 1 (stateless):
     GET  /api/health          → { status: "ok", ... }
     GET  /api/config/status   → which server keys are set
     POST /api/search          → Gemini grounding → DDG → Wikipedia
     POST /api/proxy/openai    → OpenAI-compatible chat (streaming OK)
     POST /api/proxy/anthropic → Anthropic messages (streaming OK)
     POST /api/proxy/gemini    → Gemini generateContent (REST, no SDK)

   Phase 2 (Telegram — needs KV binding CHATBOT_STATE for persistence
   across isolates; without it, state lives in isolate memory only):
     POST /api/telegram/test, GET /api/telegram/status,
     POST /api/telegram/config, POST /api/telegram/send,
     POST /api/telegram/webhook, POST /api/telegram/poll,
     GET  /api/telegram/logs, POST /api/telegram/logs/clear

   Server-side keys come from Worker Secrets (same names as the old
   .env). Per-request keys in the JSON body still take precedence,
   exactly like the Express version.

   Secrets (all optional — set what you use):
     GEMINI_API_KEY, OPENAI_API_KEY, ANTHROPIC_API_KEY,
     DEEPSEEK_API_KEY, GROQ_API_KEY, OPENROUTER_API_KEY,
     XAI_API_KEY, MISTRAL_API_KEY, TOGETHER_API_KEY,
     TELEGRAM_BOT_TOKEN, TELEGRAM_API_BASE_URL,
     TG_WEBHOOK_SECRET (optional — Telegram secret_token check)
   ============================================================ */

const json = (obj, status = 200, cors = {}) =>
  new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json', ...cors },
  });

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'content-type, authorization, x-api-key',
  'Access-Control-Max-Age': '86400',
};

const trim = (v) => String(v || '').trim();
const envKey = (env, name, fallback = '') => trim(env[name] || fallback);

/* ---------------- Gemini REST helpers (no SDK needed) ---------------- */

function geminiContents(input) {
  if (typeof input === 'string') return [{ parts: [{ text: input }] }];
  return input;
}

async function geminiGenerate({ env, model, contents, systemInstruction, enableSearch }) {
  const key = envKey(env, 'GEMINI_API_KEY');
  if (!key) throw new Error('GEMINI_API_KEY is not configured on this Worker');
  let modelToUse = model || 'gemini-3.6-flash';
  if (['gemini-2.5-flash', 'gemini-2.5-pro', 'gemini-pro'].includes(modelToUse)) {
    modelToUse = 'gemini-3.6-flash';
  }
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
    if (modelToUse !== 'gemini-3.6-flash' && /404|not found|no longer available/i.test(e.message || '')) {
      return await call('gemini-3.6-flash');
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

/* ---------------- route handlers ---------------- */

async function handleSearch(req, env) {
  const { query } = await req.json().catch(() => ({}));
  if (!query || typeof query !== 'string') {
    return json({ error: 'Search query is required' }, 400, CORS);
  }
  const results = [];

  // 1. Gemini Google-Search grounding
  if (envKey(env, 'GEMINI_API_KEY')) {
    try {
      const data = await geminiGenerate({
        env,
        model: 'gemini-3.6-flash',
        contents: `Search the web and provide relevant information and sources for: "${query}"`,
        enableSearch: true,
      });
      const text = geminiText(data).slice(0, 180);
      for (const s of geminiWebSources(data)) {
        results.push({ title: s.title, snippet: text, url: s.url });
      }
    } catch {
      // fall through to DDG
    }
  }

  // 2. DuckDuckGo HTML search
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
    } catch {
      // fall through to Wikipedia
    }
  }

  // 3. Wikipedia (fa) fallback
  if (results.length === 0) {
    try {
      const wikiRes = await fetch(
        `https://fa.wikipedia.org/w/api.php?action=opensearch&search=${encodeURIComponent(query)}&limit=5&format=json`
      );
      if (wikiRes.ok) {
        const [ , titles = [], snippets = [], urls = [] ] = await wikiRes.json();
        for (let i = 0; i < titles.length; i++) {
          if (titles[i] && urls[i]) {
            results.push({ title: titles[i], snippet: snippets[i] || titles[i], url: urls[i] });
          }
        }
      }
    } catch {
      // ignore
    }
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
    return json({ error: 'کلید API برای این سرویس دهنده تنظیم نشده است. لطفاً در تنظیمات عامل کلید API را وارد کنید.' }, 400, CORS);
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
    return json({ error: 'کلید API آنتروپیک (Anthropic API Key) الزامی است' }, 400, CORS);
  }
  let targetUrl = trim(baseUrl || 'https://api.anthropic.com').replace(/\/+$/, '');
  if (!targetUrl.endsWith('/v1/messages')) targetUrl += '/v1/messages';

  try {
    const modelName = model || 'claude-3-7-sonnet-20250219';
    const isReasoning = modelName.includes('3-7') || modelName.includes('claude-3.7');
    const payload = {
      model: modelName,
      messages,
      max_tokens: Number(max_tokens) || (isReasoning ? 8192 : 4096),
      stream: Boolean(stream),
    };
    if (isReasoning) {
      payload.thinking = { type: 'enabled', budget_tokens: 2048 };
    } else {
      payload.temperature = Number(temperature) || 0.7;
    }
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
  // NOTE: custom baseUrl from the Express version is dropped — Workers
  // call Google directly via REST. Server key injected as env.
  const keyToUse = trim(apiKey || env.GEMINI_API_KEY);
  if (!keyToUse) {
    return json({ error: 'کلید API گوگل جمینای (Google Gemini API Key) تنظیم نشده است' }, 400, CORS);
  }
  try {
    const data = await geminiGenerate({
      env: { ...env, GEMINI_API_KEY: keyToUse },
      model,
      contents: typeof contents === 'string' ? contents : contents,
      systemInstruction,
      enableSearch,
    });
    return json({ text: geminiText(data), webSources: geminiWebSources(data).map((s) => ({ title: s.title, url: s.url })) }, 200, CORS);
  } catch (e) {
    return json({ error: e.message || 'خطا در برقراری ارتباط با سرویس Google Gemini' }, e.status || 500, CORS);
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
    },
    200,
    CORS
  );
}

/* ---------------- Telegram (phase 2 — KV-backed state) ---------------- */

const TG_DEFAULTS = {
  botToken: '',
  customApiUrl: '',
  botInfo: null,
  defaultAgentId: 'gemini-pro',
  enabled: false,
  autoReply: true,
  systemPrompt: 'شما یک ربات هوش مصنوعی تلگرام هستید. به تمام پرسش‌ها با زبان فارسی سلیس، شیوا و راهنما پاسخ دهید.',
};

// Isolate-memory fallback when KV is not bound.
const memFallback = { config: null, logs: [], lastUpdateId: 0 };

function kv(env) {
  return env.CHATBOT_STATE || null;
}

async function tgLoadConfig(env) {
  const store = kv(env);
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
  const store = kv(env);
  if (store) {
    await store.put('tg:config', JSON.stringify(next));
  } else {
    memFallback.config = next;
  }
  return next;
}

async function tgGetLogs(env, limit = 40) {
  const store = kv(env);
  if (store) {
    try {
      const logs = (await store.get('tg:logs', 'json')) || [];
      return logs.slice(-limit);
    } catch { return []; }
  }
  return memFallback.logs.slice(-limit);
}

async function tgPushLogs(env, entries) {
  const store = kv(env);
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
  const store = kv(env);
  if (store) await store.put('tg:logs', JSON.stringify([]));
  else memFallback.logs = [];
}

async function tgGetLastUpdateId(env) {
  const store = kv(env);
  if (store) {
    const v = await store.get('tg:lastUpdateId');
    return Number(v) || 0;
  }
  return memFallback.lastUpdateId;
}

async function tgSetLastUpdateId(env, id) {
  const store = kv(env);
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
      model: 'gemini-3.6-flash',
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
    return json({ ok: false, error: 'توکن ربات تلگرام (Bot Token) الزامی است. لطفاً توکن دریافتی از @BotFather را وارد کنید.' }, 400, CORS);
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
    return json({ ok: false, error: data.description || 'توکن وارد شده معتبر نمی‌باشد یا تلگرام اجازه دسترسی نداد.' }, 400, CORS);
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
  return json({ ok: true, message: 'تنظیمات ربات تلگرام ذخیره شد.', config: next }, 200, CORS);
}

async function handleTelegramSend(req, env) {
  const { botToken, customApiUrl, chatId, text, parseMode } = await req.json().catch(() => ({}));
  const cfg = await tgLoadConfig(env);
  const tokenToUse = trim(botToken || cfg.botToken);
  const apiBase = tgApiBase(cfg, customApiUrl);
  if (!tokenToUse) {
    return json({ ok: false, error: 'توکن ربات تلگرام تنظیم نشده است.' }, 400, CORS);
  }
  if (!chatId || !text) {
    return json({ ok: false, error: 'شناسه چت (chatId) و متن پیام (text) الزامی است.' }, 400, CORS);
  }
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
    return json({ ok: false, error: data.description || 'خطا در ارسال پیام به تلگرام' }, 400, CORS);
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
  // Optional shared-secret check (Telegram secret_token header)
  if (envKey(env, 'TG_WEBHOOK_SECRET')) {
    const got = req.headers.get('X-Telegram-Bot-Api-Secret-Token') || '';
    if (got !== trim(env.TG_WEBHOOK_SECRET)) {
      return json({ ok: false, error: 'unauthorized' }, 401, CORS);
    }
  }
  const update = await req.json().catch(() => null);
  // Always ack fast; do the AI work in the background.
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
  if (!tokenToUse) {
    return json({ ok: false, error: 'توکن ربات الزامی است.' }, 400, CORS);
  }
  try {
    const lastId = await tgGetLastUpdateId(env);
    const tgRes = await fetch(`${apiBase}/bot${tokenToUse}/getUpdates?offset=${lastId + 1}&limit=10&timeout=0`);
    const data = await tgRes.json();
    if (!data.ok) {
      return json({ ok: false, error: data.description || 'خطا در دریافت پیام‌ها از تلگرام' }, 400, CORS);
    }
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

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, '') || '/';

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS });
    }

    if (path === '/api/health' || path === '/health') {
      return json({ status: 'ok', timestamp: new Date().toISOString(), service: 'chatbot-api' }, 200, CORS);
    }
    if (path === '/api/config/status' && request.method === 'GET') {
      return handleConfigStatus(env);
    }
    if (path === '/api/search' && request.method === 'POST') {
      return handleSearch(request, env);
    }
    if (path === '/api/proxy/openai' && request.method === 'POST') {
      return handleProxyOpenAI(request, env);
    }
    if (path === '/api/proxy/anthropic' && request.method === 'POST') {
      return handleProxyAnthropic(request, env);
    }
    if (path === '/api/proxy/gemini' && request.method === 'POST') {
      return handleProxyGemini(request, env);
    }
    if (path === '/api/telegram/test' && request.method === 'POST') {
      return handleTelegramTest(request, env);
    }
    if (path === '/api/telegram/status' && request.method === 'GET') {
      return handleTelegramStatus(env);
    }
    if (path === '/api/telegram/config' && request.method === 'POST') {
      return handleTelegramConfig(request, env);
    }
    if (path === '/api/telegram/send' && request.method === 'POST') {
      return handleTelegramSend(request, env);
    }
    if (path === '/api/telegram/webhook' && request.method === 'POST') {
      return handleTelegramWebhook(request, env, ctx);
    }
    if (path === '/api/telegram/poll' && request.method === 'POST') {
      return handleTelegramPoll(request, env);
    }
    if (path === '/api/telegram/logs' && request.method === 'GET') {
      return json({ logs: await tgGetLogs(env, 40) }, 200, CORS);
    }
    if (path === '/api/telegram/logs/clear' && request.method === 'POST') {
      await tgClearLogs(env);
      return json({ ok: true, message: 'لاگ پیام‌های تلگرام پاک شد.' }, 200, CORS);
    }
    return json({ error: 'not found' }, 404, CORS);
  },
};
