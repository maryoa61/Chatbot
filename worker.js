/* ============================================================
   Chatbot — Cloudflare Worker (Telegram reverse proxy)
   ------------------------------------------------------------
   Forwards path-preserving requests to api.telegram.org:

     https://<worker>.workers.dev/bot<token>/<method>
       → https://api.telegram.org/bot<token>/<method>

   Wire it into the app either via env:
     TELEGRAM_API_BASE_URL=https://<worker>.workers.dev
   or per-user in Settings → Telegram → Custom Proxy / Worker URL.

   Configuration comes from Worker Secrets / Vars, nothing
   sensitive is hardcoded here:

     PROXY_TOKEN      (secret, optional) If set, every request must
                                        carry it as X-Proxy-Token.
     ALLOWED_ORIGINS  (var) Comma-separated allowed Origins for
                            browser calls. Empty = deny browser
                            calls (server-to-server still works).
   ============================================================ */

const splitList = (v) =>
  String(v || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

export default {
  async fetch(request, env) {
    const reqUrl = new URL(request.url);

    // Health check
    if (reqUrl.pathname === '/' || reqUrl.pathname === '/health') {
      return Response.json({ status: 'ok', service: 'chatbot-telegram-proxy' });
    }

    // Only Telegram Bot API paths: /bot<token>/...
    if (!reqUrl.pathname.startsWith('/bot')) {
      return Response.json({ error: 'not found (use /bot<token>/<method>)' }, 404);
    }

    // Optional shared-token auth
    if (env.PROXY_TOKEN) {
      const got = request.headers.get('X-Proxy-Token') || '';
      if (got !== env.PROXY_TOKEN) {
        return Response.json({ error: 'unauthorized' }, 401);
      }
    }

    // Browser origin check (skip for non-browser / server calls)
    const origin = request.headers.get('Origin') || '';
    if (origin) {
      const allowed = splitList(env.ALLOWED_ORIGINS);
      if (!allowed.includes(origin)) {
        return Response.json({ error: 'origin not allowed' }, 403);
      }
    }

    // Handle CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: corsHeaders(origin),
      });
    }

    const target = new URL('https://api.telegram.org' + reqUrl.pathname + reqUrl.search);
    const init = {
      method: request.method,
      headers: new Headers(),
      body:
        request.method === 'GET' || request.method === 'HEAD'
          ? undefined
          : await request.arrayBuffer(),
      redirect: 'manual',
    };
    const ct = request.headers.get('content-type');
    if (ct) init.headers.set('content-type', ct);

    const upstream = await fetch(target.toString(), init);
    const resHeaders = new Headers(upstream.headers);
    resHeaders.set('Access-Control-Allow-Origin', origin || '*');
    resHeaders.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    resHeaders.set(
      'Access-Control-Allow-Headers',
      'content-type, X-Proxy-Token'
    );

    return new Response(upstream.body, {
      status: upstream.status,
      headers: resHeaders,
    });
  },
};

function corsHeaders(origin) {
  return {
    'Access-Control-Allow-Origin': origin || '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'content-type, X-Proxy-Token',
    'Access-Control-Max-Age': '86400',
  };
}
