import {
  AIAgent,
  Attachment,
  ChatMessage,
  WebSource,
  ThemeSettings,
  TelegramBotConfig,
  TelegramBotInfo,
  isAnthropicFamily,
  isOpenAIFamily,
} from '../types';

export interface SendMessageOptions {
  agent: AIAgent;
  messages: ChatMessage[];
  newUserMessage: string;
  attachments?: Attachment[];
  enableWebSearch?: boolean;
  onStreamChunk?: (chunk: string, fullReply: string, thinkingChunk?: string, fullThinking?: string) => void;
}

export interface SendMessageResult {
  reply: string;
  webSources?: WebSource[];
  thinking?: string;
  cached?: boolean;
}

// In-memory LRU-like response cache for repeated prompts (Performance Optimization)
interface CacheEntry {
  reply: string;
  thinking?: string;
  webSources?: WebSource[];
  timestamp: number;
}

const RESPONSE_CACHE = new Map<string, CacheEntry>();
const CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes cache validity

function getCacheKey(agentId: string, model: string, prompt: string, search: boolean): string {
  return `${agentId}:${model}:${search ? 's1' : 's0'}:${prompt.trim().toLowerCase()}`;
}

export function getCachedResponse(agentId: string, model: string, prompt: string, search: boolean): SendMessageResult | null {
  const key = getCacheKey(agentId, model, prompt, search);
  const entry = RESPONSE_CACHE.get(key);
  if (!entry) return null;
  if (Date.now() - entry.timestamp > CACHE_TTL_MS) {
    RESPONSE_CACHE.delete(key);
    return null;
  }
  return {
    reply: entry.reply,
    thinking: entry.thinking,
    webSources: entry.webSources,
    cached: true,
  };
}

export function setCachedResponse(agentId: string, model: string, prompt: string, search: boolean, result: SendMessageResult): void {
  const key = getCacheKey(agentId, model, prompt, search);
  // Cap cache size to 100 entries
  if (RESPONSE_CACHE.size >= 100) {
    const oldestKey = RESPONSE_CACHE.keys().next().value;
    if (oldestKey) RESPONSE_CACHE.delete(oldestKey);
  }
  RESPONSE_CACHE.set(key, {
    reply: result.reply,
    thinking: result.thinking,
    webSources: result.webSources,
    timestamp: Date.now(),
  });
}

/**
 * Context Truncation / Rolling Window (Performance Optimization)
 * Keeps recent messages and summarizes or trims older conversation
 * to prevent token overflow and reduce latency.
 */
export function pruneConversationContext(messages: ChatMessage[], maxRecentMessages = 12): ChatMessage[] {
  if (messages.length <= maxRecentMessages) {
    return messages;
  }
  // Keep the first message if relevant, plus the most recent N messages
  const recent = messages.slice(-maxRecentMessages);
  return recent;
}

/**
 * Robust Fetch with Exponential Backoff Retry (Performance & Reliability Optimization)
 * Retries transient network failures and 429/5xx status codes up to maxRetries times.
 */
export async function fetchWithRetry(
  url: string,
  options: RequestInit,
  maxRetries = 3,
  initialDelayMs = 1000
): Promise<Response> {
  let delay = initialDelayMs;
  let lastError: any = null;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const response = await fetch(url, options);

      // Don't retry client bad requests (except 429 rate limits)
      if (response.ok || (response.status >= 400 && response.status < 500 && response.status !== 429)) {
        return response;
      }

      // If server error or rate limited, retry with backoff
      if (attempt < maxRetries) {
        console.warn(`[Retry Engine] Request to ${url} returned ${response.status}. Retrying in ${delay}ms (Attempt ${attempt}/${maxRetries})...`);
        await new Promise((r) => setTimeout(r, delay));
        delay *= 2; // Exponential backoff (1s, 2s, 4s)
        continue;
      }

      return response;
    } catch (err: any) {
      lastError = err;
      if (attempt < maxRetries) {
        console.warn(`[Retry Engine] Network failure to ${url}: ${err.message}. Retrying in ${delay}ms (Attempt ${attempt}/${maxRetries})...`);
        await new Promise((r) => setTimeout(r, delay));
        delay *= 2;
      } else {
        throw err;
      }
    }
  }

  throw lastError || new Error(`Failed to complete request after ${maxRetries} retries`);
}

/**
 * Perform web search via backend proxy
 */
export async function searchWeb(query: string): Promise<WebSource[]> {
  try {
    const res = await fetch('/api/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query }),
    });

    if (!res.ok) {
      console.warn('Web search failed with status:', res.status);
      return [];
    }

    const data = await res.json();
    return data.results || [];
  } catch (err) {
    console.error('Web search error:', err);
    return [];
  }
}

/**
 * Execute chat completion based on Agent's provider (OpenAI or Anthropic)
 */
export async function sendChatMessage(options: SendMessageOptions): Promise<SendMessageResult> {
  const { agent, messages, newUserMessage, attachments = [], enableWebSearch = false, onStreamChunk } = options;

  // 0. Performance Check: In-memory Response Cache for repeat prompts (without file attachments)
  if (attachments.length === 0 && !onStreamChunk) {
    const cached = getCachedResponse(agent.id, agent.model, newUserMessage, enableWebSearch);
    if (cached) {
      console.log('[Cache Hit] Returning instant cached response for prompt:', newUserMessage.slice(0, 30));
      return cached;
    }
  }

  // 1. Context Truncation (Performance Optimization: prune older messages to reduce tokens & latency)
  const prunedMessages = pruneConversationContext(messages, 12);

  let webSources: WebSource[] = [];
  let augmentedUserMessage = newUserMessage;

  // 2. If Web Search is enabled, fetch fresh results and inject into prompt
  if (enableWebSearch && newUserMessage.trim()) {
    webSources = await searchWeb(newUserMessage);
    if (webSources.length > 0) {
      const formattedSources = webSources
        .map((s, idx) => `[${idx + 1}] ${s.title}\nمنبع: ${s.url}\nخلاصه: ${s.snippet || 'بدون خلاصه'}`)
        .join('\n\n');

      augmentedUserMessage = `${newUserMessage}

---
[اطلاعات زنده جستجوی وب (Web Search Results)]:
${formattedSources}
---
دستورالعمل: با استفاده از اطلاعات بالا و دانش خود به کاربر پاسخ دهید. در صورت استفاده از منابع بالا، به منبع یا شماره آن اشاره کنید.`;
    }
  }

  // 3. Format file attachments (text files, code, documents) into prompt context
  const textAttachments = attachments.filter((a) => a.type === 'file' && a.textContent);
  if (textAttachments.length > 0) {
    const filesContext = textAttachments
      .map((f) => `--- پیوست فایل: ${f.name} (${Math.round(f.size / 1024)} KB) ---\n${f.textContent}\n--- پایان فایل ---`)
      .join('\n\n');
    augmentedUserMessage = `${augmentedUserMessage}\n\n${filesContext}`;
  }

  // Image attachments for multimodal models
  const imageAttachments = attachments.filter((a) => a.type === 'image' && a.base64);

  let result: SendMessageResult;

  // 4. Dispatch based on provider with Retry Mechanism
  if (isAnthropicFamily(agent.provider)) {
    result = await callAnthropic({
      agent,
      messages: prunedMessages,
      augmentedUserMessage,
      imageAttachments,
      webSources,
      onStreamChunk,
    });
  } else if (agent.provider === 'gemini') {
    result = await callGemini({
      agent,
      messages: prunedMessages,
      augmentedUserMessage,
      imageAttachments,
      webSources,
      enableWebSearch,
    });
  } else {
    // Default to OpenAI-compatible
    result = await callOpenAI({
      agent,
      messages: prunedMessages,
      augmentedUserMessage,
      imageAttachments,
      webSources,
      onStreamChunk,
    });
  }

  // Store in cache if eligible
  if (attachments.length === 0 && result.reply && !result.reply.startsWith('⚠️')) {
    setCachedResponse(agent.id, agent.model, newUserMessage, enableWebSearch, result);
  }

  return result;
}

/**
 * Google Gemini Call
 */
async function callGemini(params: {
  agent: AIAgent;
  messages: ChatMessage[];
  augmentedUserMessage: string;
  imageAttachments: Attachment[];
  webSources: WebSource[];
  enableWebSearch: boolean;
}): Promise<SendMessageResult> {
  const { agent, messages, augmentedUserMessage, imageAttachments, webSources, enableWebSearch } = params;

  const contents: any[] = [];
  const recentHistory = messages.slice(-15);
  for (const m of recentHistory) {
    if (m.role === 'user') {
      contents.push({ role: 'user', parts: [{ text: m.content }] });
    } else if (m.role === 'assistant') {
      contents.push({ role: 'model', parts: [{ text: m.content }] });
    }
  }

  const userParts: any[] = [{ text: augmentedUserMessage }];
  for (const img of imageAttachments) {
    if (img.base64) {
      const parts = img.base64.split(';base64,');
      const mimeType = parts[0]?.replace('data:', '') || img.mimeType || 'image/jpeg';
      const rawData = parts[1] || img.base64;
      userParts.push({
        inlineData: {
          mimeType,
          data: rawData,
        },
      });
    }
  }
  contents.push({ role: 'user', parts: userParts });

  const res = await fetch('/api/proxy/gemini', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      baseUrl: agent.baseUrl,
      apiKey: agent.apiKey,
      model: agent.model || 'gemini-2.5-pro',
      contents,
      systemInstruction: agent.systemPrompt,
      enableSearch: enableWebSearch,
    }),
  });

  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error || 'خطا در ارتباط با سرور Google Gemini');
  }

  const combinedSources = (data.webSources && data.webSources.length > 0) ? data.webSources : webSources;
  return {
    reply: data.text || 'پاسخی از Google Gemini دریافت نشد.',
    webSources: combinedSources,
  };
}

/**
 * OpenAI-compatible call with SSE Streaming, Thinking Extraction, and Retry
 */
async function callOpenAI(params: {
  agent: AIAgent;
  messages: ChatMessage[];
  augmentedUserMessage: string;
  imageAttachments: Attachment[];
  webSources: WebSource[];
  onStreamChunk?: (chunk: string, fullReply: string, thinkingChunk?: string, fullThinking?: string) => void;
}): Promise<SendMessageResult> {
  const { agent, messages, augmentedUserMessage, imageAttachments, webSources, onStreamChunk } = params;

  // Build OpenAI message list
  const apiMessages: Array<{ role: string; content: any }> = [];

  // Add system prompt if defined
  if (agent.systemPrompt && agent.systemPrompt.trim()) {
    apiMessages.push({
      role: 'system',
      content: agent.systemPrompt.trim(),
    });
  }

  // Add past conversation context
  for (const m of messages) {
    if (m.role === 'user' || m.role === 'assistant') {
      apiMessages.push({
        role: m.role,
        content: m.content,
      });
    }
  }

  // Add new user message with optional images
  if (imageAttachments.length > 0) {
    const multiContent: any[] = [{ type: 'text', text: augmentedUserMessage }];
    for (const img of imageAttachments) {
      if (img.base64) {
        multiContent.push({
          type: 'image_url',
          image_url: {
            url: img.base64,
          },
        });
      }
    }
    apiMessages.push({ role: 'user', content: multiContent });
  } else {
    apiMessages.push({ role: 'user', content: augmentedUserMessage });
  }

  const shouldUseStream = Boolean(onStreamChunk);

  const res = await fetchWithRetry('/api/proxy/openai', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      baseUrl: agent.baseUrl,
      apiKey: agent.apiKey,
      model: agent.model,
      messages: apiMessages,
      temperature: agent.temperature,
      max_tokens: agent.maxTokens,
      stream: shouldUseStream,
    }),
  });

  if (!res.ok) {
    const errData = await res.json().catch(() => ({}));
    throw new Error(errData.error || 'خطا در ارتباط با سرور هوش مصنوعی');
  }

  // Handle SSE streaming if stream callback is provided
  if (shouldUseStream && res.body) {
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let reply = '';
    let thinking = '';
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith(':')) continue;
        if (trimmed === 'data: [DONE]') continue;
        if (trimmed.startsWith('data: ')) {
          try {
            const parsed = JSON.parse(trimmed.slice(6));
            const delta = parsed.choices?.[0]?.delta;
            if (delta) {
              const contentChunk = delta.content || '';
              const reasoningChunk = delta.reasoning_content || delta.thinking || '';
              if (contentChunk) reply += contentChunk;
              if (reasoningChunk) thinking += reasoningChunk;
              onStreamChunk?.(contentChunk, reply, reasoningChunk, thinking);
            }
          } catch {
            // Ignore parse errors on partial chunks
          }
        }
      }
    }

    // Also check for <think>...</think> tags if reasoning was inline (e.g. DeepSeek R1)
    if (!thinking && reply.includes('<think>')) {
      const thinkMatch = reply.match(/<think>([\s\S]*?)(?:<\/think>|$)/);
      if (thinkMatch) {
        thinking = thinkMatch[1].trim();
        reply = reply.replace(/<think>[\s\S]*?<\/think>/g, '').trim();
      }
    }

    return { reply: reply || 'پاسخی دریافت نشد.', webSources, thinking: thinking || undefined };
  }

  // Non-streaming response
  const data = await res.json();
  const choice = data.choices?.[0]?.message;
  let reply = choice?.content || 'پاسخی دریافت نشد.';
  let thinking = choice?.reasoning_content || choice?.thinking || '';

  // Extract <think>...</think> if model output inline thinking tags
  if (!thinking && reply.includes('<think>')) {
    const thinkMatch = reply.match(/<think>([\s\S]*?)(?:<\/think>|$)/);
    if (thinkMatch) {
      thinking = thinkMatch[1].trim();
      reply = reply.replace(/<think>[\s\S]*?<\/think>/g, '').trim();
    }
  }

  return { reply, webSources, thinking: thinking || undefined };
}

/**
 * Anthropic Claude call with Thinking Block Extraction, SSE Streaming, and Retry
 */
async function callAnthropic(params: {
  agent: AIAgent;
  messages: ChatMessage[];
  augmentedUserMessage: string;
  imageAttachments: Attachment[];
  webSources: WebSource[];
  onStreamChunk?: (chunk: string, fullReply: string, thinkingChunk?: string, fullThinking?: string) => void;
}): Promise<SendMessageResult> {
  const { agent, messages, augmentedUserMessage, imageAttachments, webSources, onStreamChunk } = params;

  // Anthropic messages format (roles: user, assistant)
  const apiMessages: Array<{ role: 'user' | 'assistant'; content: any }> = [];

  for (const m of messages) {
    if (m.role === 'user' || m.role === 'assistant') {
      apiMessages.push({
        role: m.role,
        content: m.content,
      });
    }
  }

  // User content with images if any
  if (imageAttachments.length > 0) {
    const contentBlocks: any[] = [];
    for (const img of imageAttachments) {
      if (img.base64) {
        // Strip data:image/...;base64, prefix if present
        const parts = img.base64.split(';base64,');
        const mediaType = parts[0]?.replace('data:', '') || img.mimeType || 'image/jpeg';
        const rawBase64 = parts[1] || img.base64;

        contentBlocks.push({
          type: 'image',
          source: {
            type: 'base64',
            media_type: mediaType,
            data: rawBase64,
          },
        });
      }
    }
    contentBlocks.push({ type: 'text', text: augmentedUserMessage });
    apiMessages.push({ role: 'user', content: contentBlocks });
  } else {
    apiMessages.push({ role: 'user', content: augmentedUserMessage });
  }

  const shouldUseStream = Boolean(onStreamChunk);

  const res = await fetchWithRetry('/api/proxy/anthropic', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      baseUrl: agent.baseUrl,
      apiKey: agent.apiKey,
      model: agent.model,
      messages: apiMessages,
      system: agent.systemPrompt,
      temperature: agent.temperature,
      max_tokens: agent.maxTokens,
      stream: shouldUseStream,
    }),
  });

  if (!res.ok) {
    const errData = await res.json().catch(() => ({}));
    throw new Error(errData.error || 'خطا در ارتباط با آنتروپیک');
  }

  // Handle SSE streaming for Anthropic
  if (shouldUseStream && res.body) {
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let reply = '';
    let thinking = '';
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith(':')) continue;
        if (trimmed.startsWith('data: ')) {
          try {
            const event = JSON.parse(trimmed.slice(6));
            if (event.type === 'content_block_delta') {
              if (event.delta?.type === 'text_delta') {
                const chunk = event.delta.text || '';
                reply += chunk;
                onStreamChunk?.(chunk, reply, undefined, thinking);
              } else if (event.delta?.type === 'thinking_delta') {
                const thinkChunk = event.delta.thinking || '';
                thinking += thinkChunk;
                onStreamChunk?.(undefined as any, reply, thinkChunk, thinking);
              }
            }
          } catch {
            // Ignore partial lines
          }
        }
      }
    }

    return { reply: reply || 'پاسخی دریافت نشد.', webSources, thinking: thinking || undefined };
  }

  const data = await res.json();

  let reply = '';
  let thinking = '';
  if (Array.isArray(data.content)) {
    for (const block of data.content) {
      if (block.type === 'thinking') {
        thinking += (block.thinking || '') + '\n';
      } else if (block.type === 'text') {
        reply += (reply ? '\n\n' : '') + (block.text || '');
      }
    }
    if (thinking && !reply) {
      reply = thinking;
    }
  } else if (typeof data.content === 'string') {
    reply = data.content;
  } else {
    reply = 'پاسخی از Claude دریافت نشد.';
  }

  return { reply, webSources, thinking: thinking.trim() || undefined };
}

// Server Key Status interface and helper
export interface ServerKeyStatus {
  hasGeminiKey: boolean;
  hasOpenAIKey: boolean;
  hasAnthropicKey: boolean;
  hasDeepSeekKey?: boolean;
  hasGroqKey?: boolean;
  hasOpenRouterKey?: boolean;
  hasXAIKey?: boolean;
  hasMistralKey?: boolean;
}

export async function getServerKeyStatus(): Promise<ServerKeyStatus> {
  try {
    const res = await fetch('/api/config/status');
    if (res.ok) {
      return await res.json();
    }
  } catch (e) {
    console.warn('Could not fetch server key status', e);
  }
  return { hasGeminiKey: false, hasOpenAIKey: false, hasAnthropicKey: false };
}

// Local storage keys
const AGENTS_STORAGE_KEY = 'telegram_ai_agents_v1';
const CHATS_STORAGE_KEY = 'telegram_ai_chats_v1';
const ACTIVE_AGENT_KEY = 'telegram_ai_active_agent_v1';

export function loadSavedAgents(defaultPresets: AIAgent[]): AIAgent[] {
  try {
    const raw = localStorage.getItem(AGENTS_STORAGE_KEY);
    if (!raw) return defaultPresets;
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed) && parsed.length > 0) {
      return parsed;
    }
  } catch (e) {
    console.warn('Failed to read agents from storage', e);
  }
  return defaultPresets;
}

export function saveAgentsToStorage(agents: AIAgent[]): void {
  try {
    localStorage.setItem(AGENTS_STORAGE_KEY, JSON.stringify(agents));
  } catch (e) {
    console.error('Failed to save agents to storage', e);
  }
}

export function loadSavedChats(): Record<string, ChatMessage[]> {
  try {
    const raw = localStorage.getItem(CHATS_STORAGE_KEY);
    if (!raw) return {};
    const parsed: Record<string, ChatMessage[]> = JSON.parse(raw);
    // Remove any leftover synthetic/fake welcome messages so chat only contains real messages
    const cleaned: Record<string, ChatMessage[]> = {};
    for (const [key, msgList] of Object.entries(parsed)) {
      if (Array.isArray(msgList)) {
        cleaned[key] = msgList.filter((m) => !m.id.startsWith('welcome-'));
      }
    }
    return cleaned;
  } catch (e) {
    console.warn('Failed to read chats from storage', e);
    return {};
  }
}

export function saveChatsToStorage(chats: Record<string, ChatMessage[]>): void {
  try {
    localStorage.setItem(CHATS_STORAGE_KEY, JSON.stringify(chats));
  } catch (e) {
    console.error('Failed to save chats to storage', e);
  }
}

/**
 * Export full chat history and agents as a downloadable JSON file
 */
export function exportChatsToJson(chats: Record<string, ChatMessage[]>, agents: AIAgent[]): void {
  const exportPayload = {
    version: 1,
    exportDate: new Date().toISOString(),
    chats,
    agents: agents.map((a) => ({
      id: a.id,
      name: a.name,
      model: a.model,
      provider: a.provider,
      systemPrompt: a.systemPrompt,
      avatarColor: a.avatarColor,
    })),
  };

  const jsonStr = JSON.stringify(exportPayload, null, 2);
  const blob = new Blob([jsonStr], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `telegram-ai-chats-backup-${new Date().toISOString().slice(0, 10)}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/**
 * Parse and import chats and agents from a JSON file content
 */
export function importChatsFromJson(
  jsonString: string
): { success: boolean; chats?: Record<string, ChatMessage[]>; count?: number; error?: string } {
  try {
    const data = JSON.parse(jsonString);
    if (!data || typeof data !== 'object') {
      return { success: false, error: 'فایل JSON نامعتبر است.' };
    }

    const importedChats = data.chats || data;
    if (typeof importedChats !== 'object' || Array.isArray(importedChats)) {
      return { success: false, error: 'ساختار پیام‌های ذخیره شده در فایل معتبر نیست.' };
    }

    let totalMsgs = 0;
    const validatedChats: Record<string, ChatMessage[]> = {};
    for (const [agentId, msgs] of Object.entries(importedChats)) {
      if (Array.isArray(msgs)) {
        validatedChats[agentId] = msgs.filter((m: any) => m && m.id && m.content);
        totalMsgs += validatedChats[agentId].length;
      }
    }

    return {
      success: true,
      chats: validatedChats,
      count: totalMsgs,
    };
  } catch (err: any) {
    return { success: false, error: `خطا در خواندن فایل: ${err.message}` };
  }
}

export function loadActiveAgentId(defaultId: string): string {
  try {
    return localStorage.getItem(ACTIVE_AGENT_KEY) || defaultId;
  } catch {
    return defaultId;
  }
}

export function saveActiveAgentId(id: string): void {
  try {
    localStorage.setItem(ACTIVE_AGENT_KEY, id);
  } catch {
    // ignore
  }
}

export const THEME_STORAGE_KEY = 'telegram_theme_mode_v1';
const THEME_SETTINGS_KEY = 'telegram_theme_settings_v2';
const TELEGRAM_CONFIG_KEY = 'telegram_bot_config_v1';

export function loadSavedTheme(): 'dark' | 'light' {
  try {
    const raw = localStorage.getItem(THEME_STORAGE_KEY);
    if (raw === 'light' || raw === 'dark') return raw;
  } catch {
    // fallback
  }
  return 'dark';
}

export function saveThemeToStorage(theme: 'dark' | 'light'): void {
  try {
    localStorage.setItem(THEME_STORAGE_KEY, theme);
  } catch {
    // ignore
  }
}

export const DEFAULT_THEME_SETTINGS: ThemeSettings = {
  theme: 'dark',
  accentColor: 'blue',
  chatPattern: 'doodle',
  fontSize: 'medium',
};

export function loadSavedThemeSettings(): ThemeSettings {
  try {
    const raw = localStorage.getItem(THEME_SETTINGS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      return { ...DEFAULT_THEME_SETTINGS, ...parsed };
    }
  } catch (e) {
    console.warn('Failed to parse theme settings', e);
  }
  // Fallback check for previous 'telegram_theme_mode_v1'
  try {
    const oldMode = localStorage.getItem(THEME_STORAGE_KEY);
    if (oldMode === 'light') {
      return { ...DEFAULT_THEME_SETTINGS, theme: 'light' };
    }
  } catch {
    // ignore
  }
  return DEFAULT_THEME_SETTINGS;
}

export function saveThemeSettingsToStorage(settings: ThemeSettings): void {
  try {
    localStorage.setItem(THEME_SETTINGS_KEY, JSON.stringify(settings));
    localStorage.setItem(THEME_STORAGE_KEY, settings.theme === 'light' ? 'light' : 'dark');
  } catch (e) {
    console.error('Failed to save theme settings', e);
  }
}

export const DEFAULT_TELEGRAM_CONFIG: TelegramBotConfig = {
  botToken: '',
  botInfo: null,
  defaultAgentId: 'gemini-pro',
  enabled: false,
  autoReply: true,
};

export function loadSavedTelegramConfig(): TelegramBotConfig {
  try {
    const raw = localStorage.getItem(TELEGRAM_CONFIG_KEY);
    if (raw) {
      return { ...DEFAULT_TELEGRAM_CONFIG, ...JSON.parse(raw) };
    }
  } catch (e) {
    console.warn('Failed to load telegram config', e);
  }
  return DEFAULT_TELEGRAM_CONFIG;
}

export function saveTelegramConfigToStorage(config: TelegramBotConfig): void {
  try {
    localStorage.setItem(TELEGRAM_CONFIG_KEY, JSON.stringify(config));
  } catch (e) {
    console.error('Failed to save telegram config', e);
  }
}

// Telegram Bot API Actions
export async function testTelegramBotToken(
  botToken: string,
  customApiUrl?: string
): Promise<{
  ok: boolean;
  result?: TelegramBotInfo;
  error?: string;
  message?: string;
}> {
  try {
    const res = await fetch('/api/telegram/test', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ botToken, customApiUrl }),
    });
    return await res.json();
  } catch (err: any) {
    return { ok: false, error: err.message || 'خطا در ارتباط با سرور' };
  }
}

export async function sendTelegramMessage(
  botToken: string,
  chatId: string | number,
  text: string,
  customApiUrl?: string
): Promise<{ ok: boolean; result?: any; error?: string }> {
  try {
    const res = await fetch('/api/telegram/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ botToken, chatId, text, customApiUrl }),
    });
    return await res.json();
  } catch (err: any) {
    return { ok: false, error: err.message || 'خطا در ارتباط با سرور' };
  }
}

export async function pollTelegramUpdates(
  botToken: string,
  autoReply = true,
  systemPrompt?: string,
  customApiUrl?: string
): Promise<{
  ok: boolean;
  newMessagesCount?: number;
  messages?: any[];
  allLogs?: any[];
  error?: string;
}> {
  try {
    const res = await fetch('/api/telegram/poll', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ botToken, autoReply, systemPrompt, customApiUrl }),
    });
    return await res.json();
  } catch (err: any) {
    return { ok: false, error: err.message || 'خطا در پولینگ تلگرام' };
  }
}

export async function syncTelegramConfigToServer(config: Partial<TelegramBotConfig>): Promise<void> {
  try {
    await fetch('/api/telegram/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(config),
    });
  } catch (err) {
    console.warn('Failed to sync telegram config to server', err);
  }
}

export const updateTelegramConfig = syncTelegramConfigToServer;

export async function getTelegramLogs(): Promise<any[]> {
  try {
    const res = await fetch('/api/telegram/logs');
    const data = await res.json();
    return data.logs || [];
  } catch {
    return [];
  }
}

export async function clearTelegramLogs(): Promise<boolean> {
  try {
    const res = await fetch('/api/telegram/logs/clear', { method: 'POST' });
    const data = await res.json();
    return Boolean(data.ok);
  } catch {
    return false;
  }
}

