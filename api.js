/* ============================================================
   Chatbot — Cloudflare Worker (API backend) v1.0 — PHASE 1
   ------------------------------------------------------------
   Stateless port of the Express server (server.ts), minus Telegram
   routes (phase 2 — they need KV for state) and minus static file
   serving (frontend deploys to Pages / any static host).

   Routes:
     GET  /api/health          → { status: "ok", ... }
     GET  /api/config/status   → which server keys are set
     POST /api/search          → Gemini grounding → DDG → Wikipedia
     POST /api/proxy/openai    → OpenAI-compatible chat (streaming OK)
     POST /api/proxy/anthropic → Anthropic messages (streaming OK)
     POST /api/proxy/gemini    → Gemini generateContent (REST, no SDK)

   Server-side keys come from Worker Secrets (same names as the old
   .env). Per-request keys in the JSON body still take precedence,
   exactly like the Express version.

   Secrets (all optional — set what you use):
     GEMINI_API_KEY, OPENAI_API_KEY, ANTHROPIC_API_KEY,
     DEEPSEEK_API_KEY, GROQ_API_KEY, OPENROUTER_API_KEY,
     XAI_API_KEY, MISTRAL_API_KEY, TOGETHER_API_KEY
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

export default {
  async fetch(request, env) {
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
    return json({ error: 'not found (phase 1: telegram routes + static serving not included)' }, 404, CORS);
  },
};
