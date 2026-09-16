// Extended AI Provider ecosystem
export type ProviderType =
  // OpenAI & its ecosystem / compatible providers
  | 'openai'
  | 'deepseek'
  | 'groq'
  | 'openrouter'
  | 'xai'
  | 'mistral'
  | 'together'
  | 'ollama'
  | 'custom'
  // Anthropic Claude family
  | 'anthropic'
  | 'anthropic-proxy'
  // Google Gemini
  | 'gemini';

export type ProviderFamily = 'openai-family' | 'anthropic-family' | 'gemini-family';

export const isOpenAIFamily = (provider: ProviderType): boolean => {
  return [
    'openai',
    'deepseek',
    'groq',
    'openrouter',
    'xai',
    'mistral',
    'together',
    'ollama',
    'custom',
  ].includes(provider);
};

export const isAnthropicFamily = (provider: ProviderType): boolean => {
  return ['anthropic', 'anthropic-proxy'].includes(provider);
};

export interface ProviderMeta {
  id: ProviderType;
  name: string;
  family: ProviderFamily;
  defaultBaseUrl: string;
  popularModels: Array<{ id: string; label: string }>;
  description: string;
  isLocal?: boolean;
}

export interface AIAgent {
  id: string;
  name: string;
  provider: ProviderType;
  baseUrl: string;
  apiKey: string;
  model: string;
  systemPrompt: string;
  temperature: number;
  maxTokens?: number;
  avatarColor: string;
  avatarIcon?: string;
  description?: string;
  isCustom?: boolean;
  createdAt: number;
}

export interface Attachment {
  id: string;
  name: string;
  type: 'image' | 'file';
  mimeType: string;
  size: number;
  url?: string;
  base64?: string;
  textContent?: string;
}

export interface WebSource {
  title: string;
  snippet?: string;
  url: string;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: number;
  agentId: string;
  attachments?: Attachment[];
  webSources?: WebSource[];
  isSearching?: boolean;
  error?: string;
  status?: 'sending' | 'sent' | 'read' | 'failed';
  thinking?: string; // Reasoning / Thinking process for Claude 3.7, DeepSeek R1, o1/o3-mini
  thinkingDuration?: number; // Thinking duration in seconds
}

export interface ChatSession {
  id: string;
  agentId: string;
  title: string;
  messages: ChatMessage[];
  updatedAt: number;
  pinned?: boolean;
}

export type TelegramTheme = 'dark' | 'light' | 'midnight' | 'desert';
export type TelegramAccentColor = 'blue' | 'green' | 'purple' | 'amber' | 'rose' | 'cyan';
export type TelegramChatPattern = 'doodle' | 'gradient' | 'none';
export type TelegramFontSize = 'small' | 'medium' | 'large';

export interface ThemeSettings {
  theme: TelegramTheme;
  accentColor: TelegramAccentColor;
  chatPattern: TelegramChatPattern;
  fontSize: TelegramFontSize;
}

export interface TelegramBotInfo {
  id: number;
  is_bot: boolean;
  first_name: string;
  username?: string;
  can_join_groups?: boolean;
  can_read_all_group_messages?: boolean;
  supports_inline_queries?: boolean;
}

export interface TelegramBotConfig {
  botToken: string;
  customApiUrl?: string; // Cloudflare Worker / Custom reverse proxy for api.telegram.org
  botInfo?: TelegramBotInfo | null;
  defaultAgentId: string;
  enabled: boolean;
  autoReply: boolean;
  webhookUrl?: string;
  lastChecked?: number;
}
