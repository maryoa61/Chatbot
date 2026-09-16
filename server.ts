import express, { Request, Response } from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import dotenv from "dotenv";

dotenv.config();

const app = express();
const PORT = 3000;

// Increase payload limit for image & file uploads
app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ extended: true, limit: "50mb" }));

// Health check
app.get("/api/health", (_req: Request, res: Response) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

// Environment Configuration Status (Check if runtime keys are available)
app.get("/api/config/status", (_req: Request, res: Response) => {
  res.json({
    hasGeminiKey: Boolean(process.env.GEMINI_API_KEY && process.env.GEMINI_API_KEY.trim().length > 0),
    hasOpenAIKey: Boolean(process.env.OPENAI_API_KEY && process.env.OPENAI_API_KEY.trim().length > 0),
    hasAnthropicKey: Boolean(process.env.ANTHROPIC_API_KEY && process.env.ANTHROPIC_API_KEY.trim().length > 0),
    hasDeepSeekKey: Boolean(process.env.DEEPSEEK_API_KEY && process.env.DEEPSEEK_API_KEY.trim().length > 0),
    hasGroqKey: Boolean(process.env.GROQ_API_KEY && process.env.GROQ_API_KEY.trim().length > 0),
    hasOpenRouterKey: Boolean(process.env.OPENROUTER_API_KEY && process.env.OPENROUTER_API_KEY.trim().length > 0),
    hasXAIKey: Boolean(process.env.XAI_API_KEY && process.env.XAI_API_KEY.trim().length > 0),
    hasMistralKey: Boolean(process.env.MISTRAL_API_KEY && process.env.MISTRAL_API_KEY.trim().length > 0),
  });
});

// Real-time Web Search endpoint (Real DuckDuckGo, Wikipedia & Google Search Grounding)
app.post("/api/search", async (req: Request, res: Response) => {
  const { query } = req.body;
  if (!query || typeof query !== "string") {
    return res.status(400).json({ error: "Search query is required" });
  }

  const results: Array<{ title: string; snippet: string; url: string }> = [];

  try {
    // 1. If GEMINI_API_KEY is available in environment, perform real-time Google Search grounding
    if (process.env.GEMINI_API_KEY) {
      try {
        const { GoogleGenAI } = await import("@google/genai");
        const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
        const geminiResp = await ai.models.generateContent({
          model: "gemini-3.6-flash",
          contents: `Search the web and provide relevant information and sources for: "${query}"`,
          config: {
            tools: [{ googleSearch: {} }],
          },
        });

        const groundingChunks = geminiResp.candidates?.[0]?.groundingMetadata?.groundingChunks || [];
        for (const chunk of groundingChunks) {
          if (chunk.web?.uri && chunk.web?.title) {
            results.push({
              title: chunk.web.title,
              snippet: geminiResp.text ? geminiResp.text.slice(0, 180) : "",
              url: chunk.web.uri,
            });
          }
        }
      } catch (gErr) {
        console.warn("Google Search grounding fallback to DDG:", gErr);
      }
    }

    // 2. DuckDuckGo HTML / Lite Search
    if (results.length === 0) {
      const searchUrl = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
      const response = await fetch(searchUrl, {
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
          "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          "Accept-Language": "fa,en-US,en;q=0.9",
        },
      });

      if (response.ok) {
        const html = await response.text();
        const resultBlocks = html.split('<div class="result results_links');
        for (let i = 1; i < Math.min(resultBlocks.length, 7); i++) {
          const block = resultBlocks[i];
          const titleTextMatch = block.match(/<a[^>]+class="result__a"[^>]*>([\s\S]*?)<\/a>/);
          const snippetMatch = block.match(/<a[^>]+class="result__snippet"[^>]*>([\s\S]*?)<\/a>/);

          if (titleTextMatch) {
            let url = "";
            const rawUrlMatch = block.match(/href="([^"]+)"/);
            if (rawUrlMatch) {
              const rawUrl = rawUrlMatch[1];
              const uddg = rawUrl.match(/uddg=([^&]+)/);
              url = uddg ? decodeURIComponent(uddg[1]) : rawUrl;
            }

            const cleanTitle = titleTextMatch[1].replace(/<[^>]*>/g, "").trim();
            const cleanSnippet = snippetMatch ? snippetMatch[1].replace(/<[^>]*>/g, "").trim() : "";

            if (cleanTitle && url && !url.includes("duckduckgo.com")) {
              results.push({
                title: cleanTitle,
                snippet: cleanSnippet,
                url: url.startsWith("//") ? "https:" + url : url,
              });
            }
          }
        }
      }
    }

    // 3. Fallback to Wikipedia API
    if (results.length === 0) {
      try {
        const wikiUrl = `https://fa.wikipedia.org/w/api.php?action=opensearch&search=${encodeURIComponent(query)}&limit=5&format=json`;
        const wikiRes = await fetch(wikiUrl);
        if (wikiRes.ok) {
          const wikiData = await wikiRes.json() as any;
          const titles = wikiData[1] || [];
          const snippets = wikiData[2] || [];
          const urls = wikiData[3] || [];
          for (let i = 0; i < titles.length; i++) {
            if (titles[i] && urls[i]) {
              results.push({
                title: titles[i],
                snippet: snippets[i] || titles[i],
                url: urls[i],
              });
            }
          }
        }
      } catch (wikiErr) {
        console.warn("Wikipedia fallback error:", wikiErr);
      }
    }

    res.json({ results });
  } catch (error: any) {
    console.error("Web search error:", error);
    res.status(500).json({ error: error.message || "Failed to perform web search", results: [] });
  }
});

// --- Telegram Bot Integration State & Endpoints ---
interface TelegramBotServerConfig {
  botToken: string;
  customApiUrl?: string; // Cloudflare Worker or custom proxy for api.telegram.org
  botInfo?: any;
  defaultAgentId?: string;
  enabled: boolean;
  autoReply: boolean;
  systemPrompt?: string;
}

interface TelegramLogEntry {
  id: string;
  timestamp: number;
  from: string;
  text: string;
  reply?: string;
  status: "received" | "replied" | "error";
  chatId: number | string;
}

let activeTelegramConfig: TelegramBotServerConfig = {
  botToken: process.env.TELEGRAM_BOT_TOKEN || "",
  customApiUrl: (process.env.TELEGRAM_API_BASE_URL || "").trim(),
  enabled: false,
  autoReply: true,
  systemPrompt: "شما یک ربات هوش مصنوعی تلگرام هستید. به تمام پرسش‌ها با زبان فارسی سلیس، شیوا و راهنما پاسخ دهید.",
};

let telegramLogs: TelegramLogEntry[] = [];
let lastProcessedTelegramUpdateId = 0;

// Helper to get Telegram API base endpoint
function getTelegramApiBase(overrideUrl?: string): string {
  const url = (overrideUrl || activeTelegramConfig.customApiUrl || "").trim().replace(/\/+$/, "");
  return url || "https://api.telegram.org";
}

// Helper to generate AI responses for Telegram incoming messages
async function generateTelegramAIResponse(
  userPrompt: string,
  systemInstruction?: string
): Promise<string> {
  if (process.env.GEMINI_API_KEY) {
    try {
      const { GoogleGenAI } = await import("@google/genai");
      const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
      const resp = await ai.models.generateContent({
        model: "gemini-3.6-flash",
        contents: userPrompt,
        config: {
          systemInstruction:
            systemInstruction ||
            "شما ربات هوشمند تلگرام هستید. به زبان فارسی صمیمی، دقیق و کوتاه پاسخ دهید.",
        },
      });
      return resp.text || "پاسخی از هوش مصنوعی دریافت نشد.";
    } catch (err: any) {
      console.error("Error generating AI response for Telegram:", err);
      return `متأسفانه در پاسخ هوش مصنوعی خطایی رخ داد: ${err.message || "خطای ناشناخته"}`;
    }
  }
  return "کلید سرویس هوش مصنوعی (GEMINI_API_KEY) روی سرور فعال نیست.";
}

// 1. Test Telegram Bot Token & getMe
app.post("/api/telegram/test", async (req: Request, res: Response) => {
  const { botToken, customApiUrl } = req.body;
  const tokenToUse = (botToken || activeTelegramConfig.botToken || "").trim();
  const apiBase = getTelegramApiBase(customApiUrl);

  if (!tokenToUse) {
    return res.status(400).json({
      ok: false,
      error: "توکن ربات تلگرام (Bot Token) الزامی است. لطفاً توکن دریافتی از @BotFather را وارد کنید.",
    });
  }

  try {
    const telegramRes = await fetch(`${apiBase}/bot${tokenToUse}/getMe`);
    const data = (await telegramRes.json()) as any;

    if (data.ok) {
      activeTelegramConfig.botInfo = data.result;
      activeTelegramConfig.botToken = tokenToUse;
      if (customApiUrl !== undefined) {
        activeTelegramConfig.customApiUrl = customApiUrl.trim();
      }
      return res.json({
        ok: true,
        result: data.result,
        message: `اتصال به ربات ${data.result.first_name} (@${data.result.username || "بدون یوزرنیم"}) با موفقیت برقرار شد.`,
      });
    } else {
      return res.status(400).json({
        ok: false,
        error: data.description || "توکن وارد شده معتبر نمی‌باشد یا تلگرام اجازه دسترسی نداد.",
      });
    }
  } catch (err: any) {
    console.error("Telegram getMe error:", err);
    return res.status(500).json({
      ok: false,
      error: `عدم امکان برقراری ارتباط با ${apiBase}: ${err.message}`,
    });
  }
});

// 2. Get Telegram config and recent logs
app.get("/api/telegram/status", (_req: Request, res: Response) => {
  res.json({
    config: {
      botToken: activeTelegramConfig.botToken ? `${activeTelegramConfig.botToken.slice(0, 10)}...` : "",
      hasToken: Boolean(activeTelegramConfig.botToken),
      customApiUrl: activeTelegramConfig.customApiUrl || "",
      botInfo: activeTelegramConfig.botInfo || null,
      enabled: activeTelegramConfig.enabled,
      autoReply: activeTelegramConfig.autoReply,
      defaultAgentId: activeTelegramConfig.defaultAgentId || "gemini-pro",
    },
    logs: telegramLogs.slice(-30),
  });
});

// 3. Update Telegram config
app.post("/api/telegram/config", (req: Request, res: Response) => {
  const { botToken, customApiUrl, defaultAgentId, enabled, autoReply, systemPrompt } = req.body;

  if (typeof botToken === "string") {
    activeTelegramConfig.botToken = botToken.trim();
  }
  if (typeof customApiUrl === "string") {
    activeTelegramConfig.customApiUrl = customApiUrl.trim();
  }
  if (typeof defaultAgentId === "string") {
    activeTelegramConfig.defaultAgentId = defaultAgentId;
  }
  if (typeof enabled === "boolean") {
    activeTelegramConfig.enabled = enabled;
  }
  if (typeof autoReply === "boolean") {
    activeTelegramConfig.autoReply = autoReply;
  }
  if (typeof systemPrompt === "string") {
    activeTelegramConfig.systemPrompt = systemPrompt;
  }

  res.json({
    ok: true,
    message: "تنظیمات ربات تلگرام ذخیره شد.",
    config: activeTelegramConfig,
  });
});

// 4. Send Message via Telegram Bot
app.post("/api/telegram/send", async (req: Request, res: Response) => {
  const { botToken, customApiUrl, chatId, text, parseMode } = req.body;
  const tokenToUse = (botToken || activeTelegramConfig.botToken || "").trim();
  const apiBase = getTelegramApiBase(customApiUrl);

  if (!tokenToUse) {
    return res.status(400).json({ ok: false, error: "توکن ربات تلگرام تنظیم نشده است." });
  }
  if (!chatId || !text) {
    return res.status(400).json({ ok: false, error: "شناسه چت (chatId) و متن پیام (text) الزامی است." });
  }

  try {
    const payload: any = {
      chat_id: chatId,
      text: String(text),
    };
    if (parseMode) {
      payload.parse_mode = parseMode;
    }

    const tgRes = await fetch(`${apiBase}/bot${tokenToUse}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    const data = (await tgRes.json()) as any;
    if (data.ok) {
      return res.json({ ok: true, result: data.result });
    } else {
      return res.status(400).json({ ok: false, error: data.description || "خطا در ارسال پیام به تلگرام" });
    }
  } catch (err: any) {
    console.error("Telegram sendMessage error:", err);
    return res.status(500).json({ ok: false, error: err.message });
  }
});

// 5. Telegram Webhook Handler (Receives updates directly from Telegram)
app.post("/api/telegram/webhook", async (req: Request, res: Response) => {
  // Always respond 200 OK fast to Telegram to avoid timeout retries
  res.status(200).json({ ok: true });

  try {
    const update = req.body;
    if (!update || !update.message) return;

    const msg = update.message;
    const chatId = msg.chat?.id;
    const userText = msg.text;
    const fromUser = msg.from?.username
      ? `@${msg.from.username}`
      : `${msg.from?.first_name || ""} ${msg.from?.last_name || ""}`.trim() || "کاربر تلگرام";

    if (!chatId || !userText) return;

    const logEntry: TelegramLogEntry = {
      id: `msg-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      timestamp: Date.now(),
      from: fromUser,
      text: userText,
      chatId,
      status: "received",
    };
    telegramLogs.push(logEntry);

    // Auto reply if enabled and token is present
    const tokenToUse = activeTelegramConfig.botToken;
    if (tokenToUse && activeTelegramConfig.autoReply) {
      const aiReply = await generateTelegramAIResponse(userText, activeTelegramConfig.systemPrompt);
      logEntry.reply = aiReply;
      logEntry.status = "replied";

      // Send reply back to Telegram
      try {
        await fetch(`https://api.telegram.org/bot${tokenToUse}/sendMessage`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            chat_id: chatId,
            text: aiReply,
          }),
        });
      } catch (sendErr) {
        console.error("Error sending Telegram auto-reply:", sendErr);
        logEntry.status = "error";
      }
    }
  } catch (err) {
    console.error("Telegram webhook handler error:", err);
  }
});

// 6. Polling endpoint for updates (useful when webhook URL isn't configured)
app.post("/api/telegram/poll", async (req: Request, res: Response) => {
  const { botToken, customApiUrl, autoReply = true, systemPrompt } = req.body;
  const tokenToUse = (botToken || activeTelegramConfig.botToken || "").trim();
  const apiBase = getTelegramApiBase(customApiUrl);

  if (!tokenToUse) {
    return res.status(400).json({ ok: false, error: "توکن ربات الزامی است." });
  }

  try {
    const tgUrl = `${apiBase}/bot${tokenToUse}/getUpdates?offset=${lastProcessedTelegramUpdateId + 1}&limit=10&timeout=0`;
    const tgRes = await fetch(tgUrl);
    const data = (await tgRes.json()) as any;

    if (!data.ok) {
      return res.status(400).json({ ok: false, error: data.description || "خطا در دریافت پیام‌ها از تلگرام" });
    }

    const updates = data.result || [];
    const processedMessages: any[] = [];

    for (const update of updates) {
      if (update.update_id > lastProcessedTelegramUpdateId) {
        lastProcessedTelegramUpdateId = update.update_id;
      }

      if (update.message && update.message.text) {
        const msg = update.message;
        const chatId = msg.chat?.id;
        const userText = msg.text;
        const fromUser = msg.from?.username
          ? `@${msg.from.username}`
          : `${msg.from?.first_name || ""} ${msg.from?.last_name || ""}`.trim() || "کاربر تلگرام";

        const logEntry: TelegramLogEntry = {
          id: `poll-${Date.now()}-${update.update_id}`,
          timestamp: (msg.date ? msg.date * 1000 : Date.now()),
          from: fromUser,
          text: userText,
          chatId,
          status: "received",
        };

        if (autoReply && chatId) {
          const aiReply = await generateTelegramAIResponse(userText, systemPrompt || activeTelegramConfig.systemPrompt);
          logEntry.reply = aiReply;
          logEntry.status = "replied";

          try {
            await fetch(`${apiBase}/bot${tokenToUse}/sendMessage`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                chat_id: chatId,
                text: aiReply,
              }),
            });
          } catch (replyErr) {
            console.error("Failed to send polled reply:", replyErr);
            logEntry.status = "error";
          }
        }

        telegramLogs.push(logEntry);
        processedMessages.push(logEntry);
      }
    }

    res.json({
      ok: true,
      newMessagesCount: processedMessages.length,
      messages: processedMessages,
      allLogs: telegramLogs.slice(-25),
    });
  } catch (err: any) {
    console.error("Telegram poll error:", err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// 7. Clear or get telegram logs
app.get("/api/telegram/logs", (_req: Request, res: Response) => {
  res.json({ logs: telegramLogs.slice(-40) });
});
app.post("/api/telegram/logs/clear", (_req: Request, res: Response) => {
  telegramLogs = [];
  res.json({ ok: true, message: "لاگ پیام‌های تلگرام پاک شد." });
});

// OpenAI-compatible Chat Proxy (supports OpenAI, DeepSeek, Groq, OpenRouter, xAI Grok, Mistral, Together, Ollama, etc.)
app.post("/api/proxy/openai", async (req: Request, res: Response) => {
  const { baseUrl, apiKey, model, messages, temperature = 0.7, max_tokens, stream = false } = req.body;

  // Check if target is a local model (Ollama / LocalAI / LM Studio)
  const isLocal = Boolean(
    baseUrl && (baseUrl.includes("localhost") || baseUrl.includes("127.0.0.1") || baseUrl.includes(":11434"))
  );

  // Automatic key resolution for OpenAI and its extended family:
  let keyToUse = (apiKey || "").trim();
  if (!keyToUse && !isLocal) {
    const urlLower = (baseUrl || "").toLowerCase();
    if (urlLower.includes("deepseek.com")) {
      keyToUse = (process.env.DEEPSEEK_API_KEY || "").trim();
    } else if (urlLower.includes("groq.com")) {
      keyToUse = (process.env.GROQ_API_KEY || "").trim();
    } else if (urlLower.includes("openrouter.ai")) {
      keyToUse = (process.env.OPENROUTER_API_KEY || "").trim();
    } else if (urlLower.includes("x.ai")) {
      keyToUse = (process.env.XAI_API_KEY || "").trim();
    } else if (urlLower.includes("mistral.ai")) {
      keyToUse = (process.env.MISTRAL_API_KEY || "").trim();
    } else if (urlLower.includes("together.xyz")) {
      keyToUse = (process.env.TOGETHER_API_KEY || "").trim();
    } else if (urlLower.includes("openai.com") || !baseUrl) {
      keyToUse = (process.env.OPENAI_API_KEY || "").trim();
    }
  }

  if (!keyToUse && !isLocal) {
    return res.status(400).json({
      error: "کلید API برای این سرویس دهنده تنظیم نشده است. لطفاً در تنظیمات عامل کلید API را وارد کنید.",
    });
  }

  // Normalize baseUrl
  let targetUrl = (baseUrl || "https://api.openai.com/v1").trim().replace(/\/+$/, "");
  if (!targetUrl.endsWith("/chat/completions")) {
    targetUrl = `${targetUrl}/chat/completions`;
  }

  try {
    const modelStr = (model || "gpt-4o-mini").toLowerCase();
    const isReasoningModel =
      modelStr.startsWith("o1") ||
      modelStr.startsWith("o3") ||
      modelStr.includes("reasoner") ||
      modelStr.includes("deepseek-r1");

    const payload: Record<string, any> = {
      model: model || "gpt-4o-mini",
      messages,
      stream: Boolean(stream),
    };

    // Reasoning models (OpenAI o1/o3-mini) do not accept custom temperature and use max_completion_tokens
    if (isReasoningModel) {
      if (max_tokens) {
        payload.max_completion_tokens = Number(max_tokens);
      }
    } else {
      payload.temperature = Number(temperature) ?? 0.7;
      if (max_tokens) {
        payload.max_tokens = Number(max_tokens);
      }
    }

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };

    if (keyToUse) {
      headers["Authorization"] = `Bearer ${keyToUse}`;
    }

    // Provider-specific headers
    if (targetUrl.includes("openrouter.ai")) {
      headers["HTTP-Referer"] = "https://ai.studio";
      headers["X-Title"] = "Telegram AI Agent Hub";
    }

    const apiResponse = await fetch(targetUrl, {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
    });

    if (!apiResponse.ok) {
      const errText = await apiResponse.text();
      let parsedErr: any = null;
      try {
        parsedErr = JSON.parse(errText);
      } catch {
        parsedErr = { message: errText };
      }
      return res.status(apiResponse.status).json({
        error: parsedErr.error?.message || parsedErr.message || `خطای API: ${apiResponse.statusText}`,
        status: apiResponse.status,
      });
    }

    if (stream) {
      res.setHeader("Content-Type", "text/event-stream");
      res.setHeader("Cache-Control", "no-cache");
      res.setHeader("Connection", "keep-alive");

      if (apiResponse.body) {
        const reader = apiResponse.body.getReader();
        const decoder = new TextDecoder();
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          const chunk = decoder.decode(value, { stream: true });
          res.write(chunk);
        }
      }
      res.end();
    } else {
      const data = await apiResponse.json();
      res.json(data);
    }
  } catch (err: any) {
    console.error("OpenAI proxy error:", err);
    res.status(500).json({ error: err.message || "خطا در برقراری ارتباط با سرویس هوش مصنوعی" });
  }
});

// Anthropic Claude Proxy (supports https://api.anthropic.com or custom reverse proxy / Cloudflare)
app.post("/api/proxy/anthropic", async (req: Request, res: Response) => {
  const { baseUrl, apiKey, model, messages, system, temperature = 0.7, max_tokens = 4096, stream = false } = req.body;

  const keyToUse = (apiKey || process.env.ANTHROPIC_API_KEY || "").trim();

  if (!keyToUse) {
    return res.status(400).json({ error: "کلید API آنتروپیک (Anthropic API Key) الزامی است" });
  }

  let targetUrl = (baseUrl || "https://api.anthropic.com").trim().replace(/\/+$/, "");
  if (!targetUrl.endsWith("/v1/messages")) {
    targetUrl = `${targetUrl}/v1/messages`;
  }

  try {
    const modelName = model || "claude-3-7-sonnet-20250219";
    const isClaudeReasoning = modelName.includes("3-7") || modelName.includes("claude-3.7");

    const payload: Record<string, any> = {
      model: modelName,
      messages,
      max_tokens: Number(max_tokens) || (isClaudeReasoning ? 8192 : 4096),
      stream: Boolean(stream),
    };

    if (isClaudeReasoning) {
      // Claude 3.7 with extended thinking requires thinking parameter and max_tokens > budget_tokens
      payload.thinking = {
        type: "enabled",
        budget_tokens: 2048,
      };
      // When thinking is enabled, temperature must be 1.0 or omitted
    } else {
      payload.temperature = Number(temperature) || 0.7;
    }

    if (system) {
      payload.system = system;
    }

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "x-api-key": keyToUse,
      "anthropic-version": "2023-06-01",
    };

    const apiResponse = await fetch(targetUrl, {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
    });

    if (!apiResponse.ok) {
      const errText = await apiResponse.text();
      let parsedErr: any = null;
      try {
        parsedErr = JSON.parse(errText);
      } catch {
        parsedErr = { message: errText };
      }
      return res.status(apiResponse.status).json({
        error: parsedErr.error?.message || parsedErr.message || `خطای Anthropic: ${apiResponse.statusText}`,
        status: apiResponse.status,
      });
    }

    if (stream) {
      res.setHeader("Content-Type", "text/event-stream");
      res.setHeader("Cache-Control", "no-cache");
      res.setHeader("Connection", "keep-alive");

      if (apiResponse.body) {
        const reader = apiResponse.body.getReader();
        const decoder = new TextDecoder();
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          const chunk = decoder.decode(value, { stream: true });
          res.write(chunk);
        }
      }
      res.end();
    } else {
      const data = await apiResponse.json();
      res.json(data);
    }
  } catch (err: any) {
    console.error("Anthropic proxy error:", err);
    res.status(500).json({ error: err.message || "خطا در ارتباط با آنتروپیک" });
  }
});

// Built-in Google Gemini Support with Google Search Grounding & Custom Base URL
app.post("/api/proxy/gemini", async (req: Request, res: Response) => {
  const { apiKey, baseUrl, model = "gemini-2.5-pro", contents, systemInstruction, enableSearch = false } = req.body;

  const keyToUse = apiKey || process.env.GEMINI_API_KEY;
  if (!keyToUse) {
    return res.status(400).json({ error: "کلید API گوگل جمینای (Google Gemini API Key) تنظیم نشده است" });
  }

  try {
    const { GoogleGenAI } = await import("@google/genai");
    const aiOptions: any = { apiKey: keyToUse };
    if (baseUrl && !baseUrl.includes("googleapis.com")) {
      aiOptions.httpOptions = { baseUrl };
    }
    const ai = new GoogleGenAI(aiOptions);

    const config: any = {};
    if (systemInstruction) {
      config.systemInstruction = systemInstruction;
    }
    if (enableSearch) {
      config.tools = [{ googleSearch: {} }];
    }

    // Support simple ping or structured contents
    const payloadContents = typeof contents === "string" ? contents : contents;

    let modelToUse = model || "gemini-3.6-flash";
    if (modelToUse === "gemini-2.5-flash" || modelToUse === "gemini-2.5-pro" || modelToUse === "gemini-pro") {
      modelToUse = "gemini-3.6-flash";
    }

    let response;
    try {
      response = await ai.models.generateContent({
        model: modelToUse,
        contents: payloadContents,
        config,
      });
    } catch (callErr: any) {
      if (
        modelToUse !== "gemini-3.6-flash" &&
        (callErr.message?.includes("404") ||
          callErr.message?.includes("not found") ||
          callErr.message?.includes("no longer available"))
      ) {
        response = await ai.models.generateContent({
          model: "gemini-3.6-flash",
          contents: payloadContents,
          config,
        });
      } else {
        throw callErr;
      }
    }

    // Extract search grounding metadata if present
    const searchChunks = response.candidates?.[0]?.groundingMetadata?.groundingChunks || [];
    const webSources = searchChunks
      .filter((chunk: any) => chunk.web?.uri && chunk.web?.title)
      .map((chunk: any) => ({
        title: chunk.web.title,
        url: chunk.web.uri,
      }));

    res.json({
      text: response.text || "",
      webSources,
    });
  } catch (err: any) {
    console.error("Gemini proxy error:", err);
    res.status(500).json({ error: err.message || "خطا در برقراری ارتباط با سرویس Google Gemini" });
  }
});

// Setup Vite middleware in dev or static files in prod
async function startServer() {
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (_req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://0.0.0.0:${PORT}`);
  });
}

startServer();
