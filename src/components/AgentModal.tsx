import React, { useState, useEffect } from 'react';
import { AIAgent, ProviderType, isOpenAIFamily, isAnthropicFamily } from '../types';
import { ServerKeyStatus } from '../services/apiService';
import { apiUrl } from '../utils/api';
import {
  X,
  Key,
  Globe,
  Cpu,
  Sliders,
  Check,
  Eye,
  EyeOff,
  Bot,
  Sparkles,
  Terminal,
  ShieldCheck,
  Zap,
} from 'lucide-react';

interface AgentModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (agent: AIAgent) => void;
  agentToEdit: AIAgent | null;
  theme?: 'dark' | 'light';
  serverKeyStatus?: ServerKeyStatus;
}

interface ProviderMetaItem {
  id: ProviderType;
  label: string;
  category: 'openai-family' | 'anthropic-family' | 'gemini';
  defaultBaseUrl: string;
  defaultModel: string;
  defaultColor: string;
  isLocal?: boolean;
}

const PROVIDERS_LIST: ProviderMetaItem[] = [
  // Anthropic Claude Family
  {
    id: 'anthropic',
    label: 'Anthropic Claude (رسمی)',
    category: 'anthropic-family',
    defaultBaseUrl: 'https://api.anthropic.com',
    defaultModel: 'claude-3-7-sonnet-20250219',
    defaultColor: 'from-amber-600 to-orange-500',
  },
  {
    id: 'anthropic-proxy',
    label: 'پروکسی سفارشی Claude / Gateway',
    category: 'anthropic-family',
    defaultBaseUrl: 'https://api.anthropic.com',
    defaultModel: 'claude-3-5-sonnet-20241022',
    defaultColor: 'from-amber-700 to-yellow-600',
  },

  // OpenAI & its ecosystem / compatible APIs
  {
    id: 'openai',
    label: 'OpenAI (رسمی)',
    category: 'openai-family',
    defaultBaseUrl: 'https://api.openai.com/v1',
    defaultModel: 'gpt-4o',
    defaultColor: 'from-emerald-600 to-teal-500',
  },
  {
    id: 'deepseek',
    label: 'DeepSeek (دیپ‌سیک)',
    category: 'openai-family',
    defaultBaseUrl: 'https://api.deepseek.com/v1',
    defaultModel: 'deepseek-reasoner',
    defaultColor: 'from-cyan-600 to-blue-600',
  },
  {
    id: 'groq',
    label: 'Groq LPU (فوق سریع)',
    category: 'openai-family',
    defaultBaseUrl: 'https://api.groq.com/openai/v1',
    defaultModel: 'llama-3.3-70b-versatile',
    defaultColor: 'from-orange-600 to-red-600',
  },
  {
    id: 'openrouter',
    label: 'OpenRouter (درگاه جامع)',
    category: 'openai-family',
    defaultBaseUrl: 'https://openrouter.ai/api/v1',
    defaultModel: 'openai/gpt-4o',
    defaultColor: 'from-purple-600 to-indigo-500',
  },
  {
    id: 'xai',
    label: 'xAI Grok',
    category: 'openai-family',
    defaultBaseUrl: 'https://api.x.ai/v1',
    defaultModel: 'grok-2',
    defaultColor: 'from-slate-700 to-zinc-900',
  },
  {
    id: 'mistral',
    label: 'Mistral AI',
    category: 'openai-family',
    defaultBaseUrl: 'https://api.mistral.ai/v1',
    defaultModel: 'mistral-large-latest',
    defaultColor: 'from-amber-700 to-orange-700',
  },
  {
    id: 'ollama',
    label: 'Ollama (محلی بدون اینترنت)',
    category: 'openai-family',
    defaultBaseUrl: 'http://localhost:11434/v1',
    defaultModel: 'llama3.2',
    defaultColor: 'from-slate-600 to-slate-800',
    isLocal: true,
  },
  {
    id: 'custom',
    label: 'سایر ارائه‌دهندگان سازگار با OpenAI',
    category: 'openai-family',
    defaultBaseUrl: 'https://api.openai.com/v1',
    defaultModel: 'gpt-4o',
    defaultColor: 'from-teal-700 to-cyan-700',
  },

  // Google Gemini
  {
    id: 'gemini',
    label: 'Google Gemini (گوگل)',
    category: 'gemini',
    defaultBaseUrl: 'https://generativelanguage.googleapis.com',
    defaultModel: 'gemini-3.6-flash',
    defaultColor: 'from-blue-600 to-indigo-600',
  },
];

const PRESET_BASE_URLS: Record<ProviderType, Array<{ name: string; url: string }>> = {
  gemini: [
    { name: 'Google Gemini رسمی', url: 'https://generativelanguage.googleapis.com' },
    { name: 'پروکسی سفارشی / Gateway', url: 'https://generativelanguage.googleapis.com' },
  ],
  anthropic: [
    { name: 'Anthropic رسمی', url: 'https://api.anthropic.com' },
    { name: 'Cloudflare AI Gateway', url: 'https://gateway.ai.cloudflare.com/v1' },
  ],
  'anthropic-proxy': [
    { name: 'Anthropic رسمی', url: 'https://api.anthropic.com' },
    { name: 'پروکسی سفارشی', url: 'https://api.anthropic.com' },
  ],
  openai: [
    { name: 'OpenAI رسمی', url: 'https://api.openai.com/v1' },
    { name: 'پروکسی کلودفلر', url: 'https://gateway.ai.cloudflare.com/v1' },
  ],
  deepseek: [
    { name: 'DeepSeek رسمی', url: 'https://api.deepseek.com/v1' },
  ],
  groq: [
    { name: 'Groq Cloud رسمی', url: 'https://api.groq.com/openai/v1' },
  ],
  openrouter: [
    { name: 'OpenRouter رسمی', url: 'https://openrouter.ai/api/v1' },
  ],
  xai: [
    { name: 'xAI رسمی', url: 'https://api.x.ai/v1' },
  ],
  mistral: [
    { name: 'Mistral AI رسمی', url: 'https://api.mistral.ai/v1' },
  ],
  together: [
    { name: 'Together AI رسمی', url: 'https://api.together.xyz/v1' },
  ],
  ollama: [
    { name: 'Ollama محلی (Localhost)', url: 'http://localhost:11434/v1' },
    { name: 'LM Studio محلی', url: 'http://localhost:1234/v1' },
  ],
  custom: [
    { name: 'پروکسی سفارشی', url: 'https://api.openai.com/v1' },
    { name: 'سرور محلی vLLM', url: 'http://localhost:8000/v1' },
  ],
};

const POPULAR_MODELS: Record<ProviderType, Array<{ id: string; label: string }>> = {
  gemini: [
    { id: 'gemini-3.6-flash', label: 'Gemini 3.6 Flash (جدید)' },
    { id: 'gemini-2.5-pro', label: 'Gemini 2.5 Pro (عمیق)' },
    { id: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash' },
    { id: 'gemini-2.5-flash-thinking', label: 'Gemini 2.5 Thinking' },
  ],
  anthropic: [
    { id: 'claude-3-7-sonnet-20250219', label: 'Claude 3.7 Sonnet (تفکر هیبریدی)' },
    { id: 'claude-3-5-sonnet-20241022', label: 'Claude 3.5 Sonnet' },
    { id: 'claude-3-5-haiku-20241022', label: 'Claude 3.5 Haiku (سریع)' },
    { id: 'claude-3-opus-20240229', label: 'Claude 3 Opus (استدلال عمیق)' },
  ],
  'anthropic-proxy': [
    { id: 'claude-3-7-sonnet-20250219', label: 'Claude 3.7 Sonnet' },
    { id: 'claude-3-5-sonnet-20241022', label: 'Claude 3.5 Sonnet' },
    { id: 'claude-3-5-haiku-20241022', label: 'Claude 3.5 Haiku' },
  ],
  openai: [
    { id: 'gpt-4o', label: 'GPT-4o (چندوجهی)' },
    { id: 'gpt-4o-mini', label: 'GPT-4o Mini (سریع)' },
    { id: 'o3-mini', label: 'o3-mini (استدلال ریاضی و کد)' },
    { id: 'o1', label: 'o1 (استدلال پیشرفته)' },
  ],
  deepseek: [
    { id: 'deepseek-reasoner', label: 'DeepSeek R1 (استدلال عمیق)' },
    { id: 'deepseek-chat', label: 'DeepSeek V3 (چت عمومی)' },
  ],
  groq: [
    { id: 'llama-3.3-70b-versatile', label: 'Llama 3.3 70B' },
    { id: 'llama-3.1-8b-instant', label: 'Llama 3.1 8B (فوق سریع)' },
    { id: 'mixtral-8x7b-32768', label: 'Mixtral 8x7B' },
  ],
  openrouter: [
    { id: 'openai/gpt-4o', label: 'GPT-4o' },
    { id: 'anthropic/claude-3.7-sonnet', label: 'Claude 3.7 Sonnet' },
    { id: 'deepseek/deepseek-r1', label: 'DeepSeek R1' },
    { id: 'meta-llama/llama-3.3-70b-instruct', label: 'Llama 3.3 70B' },
  ],
  xai: [
    { id: 'grok-2', label: 'Grok 2' },
    { id: 'grok-2-vision-1212', label: 'Grok 2 Vision' },
  ],
  mistral: [
    { id: 'mistral-large-latest', label: 'Mistral Large' },
    { id: 'codestral-latest', label: 'Codestral (کدنویسی)' },
    { id: 'mistral-small-latest', label: 'Mistral Small' },
  ],
  together: [
    { id: 'meta-llama/Llama-3.3-70B-Instruct-Turbo', label: 'Llama 3.3 70B Turbo' },
    { id: 'deepseek-ai/DeepSeek-R1', label: 'DeepSeek R1' },
  ],
  ollama: [
    { id: 'llama3.2', label: 'Llama 3.2 (پیشنهادی)' },
    { id: 'deepseek-r1:latest', label: 'DeepSeek R1 (محلی)' },
    { id: 'qwen2.5-coder', label: 'Qwen 2.5 Coder' },
    { id: 'mistral', label: 'Mistral 7B' },
  ],
  custom: [
    { id: 'gpt-4o', label: 'GPT-4o' },
    { id: 'llama-3.3-70b', label: 'Llama 3.3 70B' },
    { id: 'deepseek-chat', label: 'DeepSeek Chat' },
  ],
};

const COLOR_OPTIONS = [
  { name: 'آبی گوگل و تلگرام', class: 'from-blue-600 to-indigo-600' },
  { name: 'زمردی OpenAI', class: 'from-emerald-600 to-teal-500' },
  { name: 'کهربایی Claude', class: 'from-amber-600 to-orange-500' },
  { name: 'فیروزه‌ای DeepSeek', class: 'from-cyan-600 to-blue-600' },
  { name: 'قرمز آتشین Groq', class: 'from-orange-600 to-red-600' },
  { name: 'بنفش OpenRouter', class: 'from-purple-600 to-indigo-500' },
  { name: 'تیره xAI / Ollama', class: 'from-slate-700 to-zinc-900' },
];

export const AgentModal: React.FC<AgentModalProps> = ({
  isOpen,
  onClose,
  onSave,
  agentToEdit,
  theme = 'dark',
  serverKeyStatus,
}) => {
  const isLight = theme === 'light';

  const [name, setName] = useState('');
  const [provider, setProvider] = useState<ProviderType>('gemini');
  const [familyTab, setFamilyTab] = useState<'all' | 'openai' | 'anthropic' | 'gemini'>('all');
  const [baseUrl, setBaseUrl] = useState('https://generativelanguage.googleapis.com');
  const [apiKey, setApiKey] = useState('');
  const [model, setModel] = useState('gemini-3.6-flash');
  const [systemPrompt, setSystemPrompt] = useState('شما یک دستیار هوش مصنوعی دقیق و پاسخ‌گو به زبان فارسی هستید.');
  const [temperature, setTemperature] = useState(0.7);
  const [maxTokens, setMaxTokens] = useState(4096);
  const [avatarColor, setAvatarColor] = useState('from-blue-600 to-indigo-600');
  const [showApiKey, setShowApiKey] = useState(false);
  const [isTesting, setIsTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null);

  // Check if target is a local model (Ollama / LocalAI / LM Studio)
  const isLocalTarget = Boolean(
    provider === 'ollama' ||
      (baseUrl && (baseUrl.includes('localhost') || baseUrl.includes('127.0.0.1') || baseUrl.includes(':11434') || baseUrl.includes(':1234')))
  );

  // Check if provider has active environment key
  const hasServerKeyForProvider = Boolean(
    (provider === 'gemini' && serverKeyStatus?.hasGeminiKey) ||
    (provider === 'openai' && serverKeyStatus?.hasOpenAIKey && baseUrl.includes('openai.com')) ||
    (isAnthropicFamily(provider) && serverKeyStatus?.hasAnthropicKey) ||
    (provider === 'deepseek' && serverKeyStatus?.hasDeepSeekKey) ||
    (provider === 'groq' && serverKeyStatus?.hasGroqKey) ||
    (provider === 'openrouter' && serverKeyStatus?.hasOpenRouterKey) ||
    (provider === 'xai' && serverKeyStatus?.hasXAIKey) ||
    (provider === 'mistral' && serverKeyStatus?.hasMistralKey)
  );

  useEffect(() => {
    if (agentToEdit) {
      setName(agentToEdit.name);
      setProvider(agentToEdit.provider);
      setBaseUrl(agentToEdit.baseUrl);
      setApiKey(agentToEdit.apiKey || '');
      setModel(agentToEdit.model);
      setSystemPrompt(agentToEdit.systemPrompt || '');
      setTemperature(agentToEdit.temperature ?? 0.7);
      setMaxTokens(agentToEdit.maxTokens ?? 4096);
      setAvatarColor(agentToEdit.avatarColor || 'from-blue-600 to-indigo-600');

      if (isAnthropicFamily(agentToEdit.provider)) {
        setFamilyTab('anthropic');
      } else if (isOpenAIFamily(agentToEdit.provider)) {
        setFamilyTab('openai');
      } else {
        setFamilyTab('gemini');
      }
    } else {
      // Default for new agent: Gemini
      setName('');
      setProvider('gemini');
      setFamilyTab('all');
      setBaseUrl('https://generativelanguage.googleapis.com');
      setApiKey('');
      setModel('gemini-3.6-flash');
      setSystemPrompt('شما یک دستیار هوشمند و کارشناس هستید که به زبان فارسی روان، شیوا و ساختاریافته پاسخ می‌دهید.');
      setTemperature(0.7);
      setMaxTokens(4096);
      setAvatarColor('from-blue-600 to-indigo-600');
    }
    setTestResult(null);
  }, [agentToEdit, isOpen]);

  if (!isOpen) return null;

  const handleProviderSelect = (selectedProvider: ProviderType) => {
    setProvider(selectedProvider);
    const meta = PROVIDERS_LIST.find((p) => p.id === selectedProvider);
    if (meta) {
      setBaseUrl(meta.defaultBaseUrl);
      setModel(meta.defaultModel);
      if (!agentToEdit) {
        setAvatarColor(meta.defaultColor);
      }
    }
    setTestResult(null);
  };

  const handleTestConnection = async () => {
    if (!apiKey.trim() && !hasServerKeyForProvider && !isLocalTarget) {
      setTestResult({
        success: false,
        message: 'لطفاً ابتدا کلید API را وارد کنید یا مطمئن شوید کلید در متغیرهای سیستم وجود دارد.',
      });
      return;
    }

    setIsTesting(true);
    setTestResult(null);

    try {
      if (provider === 'gemini') {
        const res = await fetch(apiUrl('/api/proxy/gemini'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            baseUrl,
            apiKey: apiKey.trim() || undefined,
            model,
            contents: 'ping',
          }),
        });
        const data = await res.json();
        if (res.ok) {
          setTestResult({ success: true, message: 'اتصال به Google Gemini با موفقیت تایید شد! ✅' });
        } else {
          setTestResult({ success: false, message: data.error || 'خطا در احراز هویت Google Gemini' });
        }
      } else if (isAnthropicFamily(provider)) {
        const res = await fetch(apiUrl('/api/proxy/anthropic'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            baseUrl,
            apiKey: apiKey.trim() || undefined,
            model,
            max_tokens: 10,
            messages: [{ role: 'user', content: 'ping' }],
          }),
        });
        const data = await res.json();
        if (res.ok) {
          setTestResult({ success: true, message: 'اتصال به Anthropic Claude با موفقیت تایید شد! ✅' });
        } else {
          setTestResult({ success: false, message: data.error || 'خطا در احراز هویت Anthropic' });
        }
      } else {
        // OpenAI and all compatible providers (DeepSeek, Groq, OpenRouter, xAI, Mistral, Ollama)
        const res = await fetch(apiUrl('/api/proxy/openai'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            baseUrl,
            apiKey: apiKey.trim() || undefined,
            model,
            messages: [{ role: 'user', content: 'ping' }],
            max_tokens: 5,
          }),
        });
        const data = await res.json();
        if (res.ok) {
          setTestResult({
            success: true,
            message: `اتصال به ${PROVIDERS_LIST.find((p) => p.id === provider)?.label || 'OpenAI API'} با موفقیت برقرار شد! ✅`,
          });
        } else {
          setTestResult({ success: false, message: data.error || 'خطا در احراز هویت سرویس هوش مصنوعی' });
        }
      }
    } catch (err: any) {
      setTestResult({ success: false, message: err.message || 'خطا در برقراری تماس شبکه' });
    } finally {
      setIsTesting(false);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;

    const meta = PROVIDERS_LIST.find((p) => p.id === provider);
    const defaultBaseUrl = meta?.defaultBaseUrl || 'https://api.openai.com/v1';
    const defaultModel = meta?.defaultModel || 'gpt-4o';

    const savedAgent: AIAgent = {
      id: agentToEdit ? agentToEdit.id : `agent-${Date.now()}`,
      name: name.trim(),
      provider,
      baseUrl: baseUrl.trim() || defaultBaseUrl,
      apiKey: apiKey.trim(),
      model: model.trim() || defaultModel,
      systemPrompt: systemPrompt.trim(),
      temperature,
      maxTokens,
      avatarColor,
      isCustom: true,
      createdAt: agentToEdit ? agentToEdit.createdAt : Date.now(),
    };

    onSave(savedAgent);
    onClose();
  };

  // Filter providers based on tab
  const filteredProviders = PROVIDERS_LIST.filter((p) => {
    if (familyTab === 'all') return true;
    if (familyTab === 'openai') return p.category === 'openai-family';
    if (familyTab === 'anthropic') return p.category === 'anthropic-family';
    if (familyTab === 'gemini') return p.category === 'gemini';
    return true;
  });

  const isReasoningModel =
    model.toLowerCase().startsWith('o1') ||
    model.toLowerCase().startsWith('o3') ||
    model.toLowerCase().includes('reasoner') ||
    model.toLowerCase().includes('deepseek-r1');

  return (
    <div
      id="agent-modal-backdrop"
      className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/60 backdrop-blur-xs animate-in fade-in duration-200"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        id="agent-modal-container"
        className={`w-full max-w-2xl max-h-[92vh] flex flex-col rounded-2xl shadow-2xl overflow-hidden border transition-colors ${
          isLight
            ? 'bg-white border-slate-200 text-slate-800'
            : 'bg-[#17212b] border-[#242f3d] text-[#f5f5f5]'
        }`}
        dir="rtl"
      >
        {/* Header (Telegram style) */}
        <div
          className={`flex items-center justify-between px-5 py-4 border-b ${
            isLight ? 'bg-slate-50 border-slate-200' : 'bg-[#1b2734] border-[#242f3d]'
          }`}
        >
          <div className="flex items-center gap-3">
            <div className={`w-9 h-9 rounded-full bg-gradient-to-tr ${avatarColor} flex items-center justify-center shadow-xs`}>
              <Bot className="w-5 h-5 text-white" />
            </div>
            <div>
              <h2 className={`text-base font-semibold ${isLight ? 'text-slate-900' : 'text-white'}`}>
                {agentToEdit ? 'تنظیمات عامل هوش مصنوعی' : 'افزودن عامل هوش مصنوعی جدید'}
              </h2>
              <p className={`text-xs ${isLight ? 'text-slate-500' : 'text-gray-400'}`}>
                پشتیبانی از تمامی مدل‌های خانواده OpenAI، آنتروپیک Claude و گوگل
              </p>
            </div>
          </div>
          <button
            id="close-agent-modal-btn"
            onClick={onClose}
            className={`p-1.5 rounded-lg transition-colors ${
              isLight
                ? 'text-slate-500 hover:text-slate-800 hover:bg-slate-200'
                : 'text-gray-400 hover:text-white hover:bg-[#242f3d]'
            }`}
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content Form */}
        <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto p-5 space-y-4 text-sm">
          {/* Agent Name */}
          <div>
            <label className={`block text-xs font-medium mb-1.5 ${isLight ? 'text-slate-700' : 'text-gray-300'}`}>
              نام نمایشی عامل در تلگرام <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="مثال: Claude 3.7 Sonnet، DeepSeek R1، GPT-4o یا Llama 3.3"
              className={`w-full px-3.5 py-2.5 rounded-xl outline-none transition-all text-sm ${
                isLight
                  ? 'bg-slate-50 border border-slate-300 focus:border-[#3390ec] text-slate-900 placeholder:text-slate-400'
                  : 'bg-[#0e1621] border border-[#242f3d] focus:border-[#5288c1] text-white placeholder:text-gray-500'
              }`}
            />
          </div>

          {/* Provider Family Category Filter */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className={`text-xs font-medium ${isLight ? 'text-slate-700' : 'text-gray-300'}`}>
                سرویس‌دهنده و پروتکل هوش مصنوعی
              </label>
              <span className={`text-[11px] ${isLight ? 'text-slate-500' : 'text-gray-400'}`}>
                OpenAI • Anthropic • Gemini
              </span>
            </div>

            {/* Sub-family Tabs */}
            <div className="flex items-center gap-1.5 mb-2.5">
              <button
                type="button"
                onClick={() => setFamilyTab('all')}
                className={`px-3 py-1 text-xs rounded-lg font-medium transition-colors ${
                  familyTab === 'all'
                    ? 'bg-[#3390ec] text-white'
                    : isLight
                    ? 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                    : 'bg-[#202b36] text-gray-400 hover:text-white'
                }`}
              >
                همه ارائه‌دهندگان
              </button>
              <button
                type="button"
                onClick={() => setFamilyTab('openai')}
                className={`px-3 py-1 text-xs rounded-lg font-medium transition-colors ${
                  familyTab === 'openai'
                    ? 'bg-emerald-600 text-white'
                    : isLight
                    ? 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                    : 'bg-[#202b36] text-gray-400 hover:text-white'
                }`}
              >
                خانواده OpenAI (DeepSeek, Groq...)
              </button>
              <button
                type="button"
                onClick={() => setFamilyTab('anthropic')}
                className={`px-3 py-1 text-xs rounded-lg font-medium transition-colors ${
                  familyTab === 'anthropic'
                    ? 'bg-amber-600 text-white'
                    : isLight
                    ? 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                    : 'bg-[#202b36] text-gray-400 hover:text-white'
                }`}
              >
                خانواده Anthropic Claude
              </button>
              <button
                type="button"
                onClick={() => setFamilyTab('gemini')}
                className={`px-3 py-1 text-xs rounded-lg font-medium transition-colors ${
                  familyTab === 'gemini'
                    ? 'bg-blue-600 text-white'
                    : isLight
                    ? 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                    : 'bg-[#202b36] text-gray-400 hover:text-white'
                }`}
              >
                Google Gemini
              </button>
            </div>

            {/* Provider Grid */}
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              {filteredProviders.map((p) => {
                const isSelected = provider === p.id;
                return (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => handleProviderSelect(p.id)}
                    className={`flex items-center gap-2 p-2.5 rounded-xl border text-right transition-all ${
                      isSelected
                        ? isLight
                          ? 'bg-blue-50 border-[#3390ec] text-[#3390ec] shadow-xs'
                          : 'bg-[#2b5278] border-[#5288c1] text-white shadow-xs'
                        : isLight
                        ? 'bg-slate-50 border-slate-200 text-slate-700 hover:bg-slate-100'
                        : 'bg-[#0e1621] border-[#242f3d] text-gray-300 hover:bg-[#202b36]'
                    }`}
                  >
                    <div className={`w-3 h-3 rounded-full bg-gradient-to-tr ${p.defaultColor} shrink-0`} />
                    <div className="min-w-0">
                      <div className="text-xs font-semibold truncate">{p.label}</div>
                      <div className="text-[10px] opacity-75 truncate">
                        {p.isLocal ? 'محلی و آفلاین' : p.category === 'anthropic-family' ? 'Claude' : p.category === 'openai-family' ? 'سازگار با OpenAI' : 'گوگل'}
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Base URL */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className={`text-xs font-medium flex items-center gap-1.5 ${isLight ? 'text-slate-700' : 'text-gray-300'}`}>
                <Globe className="w-3.5 h-3.5 text-blue-500" />
                <span>آدرس سرور پایه (Base URL)</span>
              </label>
              <span className={`text-[11px] ${isLight ? 'text-slate-500' : 'text-gray-400'}`}>
                {isAnthropicFamily(provider) ? 'اندپوینت Claude API' : 'اندپوینت پروتکل OpenAI'}
              </span>
            </div>
            <input
              type="text"
              required
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
              placeholder="https://..."
              dir="ltr"
              className={`w-full px-3.5 py-2.5 rounded-xl font-mono text-xs outline-none transition-all ${
                isLight
                  ? 'bg-slate-50 border border-slate-300 focus:border-[#3390ec] text-slate-900'
                  : 'bg-[#0e1621] border border-[#242f3d] focus:border-[#5288c1] text-white'
              }`}
            />
            {/* Quick URL Presets */}
            {PRESET_BASE_URLS[provider] && (
              <div className="flex flex-wrap gap-1.5 mt-2">
                {PRESET_BASE_URLS[provider].map((p) => (
                  <button
                    key={p.url + p.name}
                    type="button"
                    onClick={() => setBaseUrl(p.url)}
                    className={`text-[11px] px-2.5 py-1 rounded-lg border transition-colors ${
                      baseUrl === p.url
                        ? isLight
                          ? 'bg-blue-100 text-blue-800 border-blue-300'
                          : 'bg-[#2b5278] text-white border-[#5288c1]'
                        : isLight
                        ? 'bg-slate-100 hover:bg-slate-200 text-slate-700 border-slate-200'
                        : 'bg-[#202b36] hover:bg-[#283645] text-gray-300 border-[#2b3a4a]'
                    }`}
                  >
                    {p.name}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* API Key */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className={`text-xs font-medium flex items-center gap-1.5 ${isLight ? 'text-slate-700' : 'text-gray-300'}`}>
                <Key className="w-3.5 h-3.5 text-emerald-500" />
                <span>کلید اختصاصی (API Key)</span>
              </label>
              <span className="text-[11px] text-emerald-600 dark:text-emerald-400 flex items-center gap-1">
                <ShieldCheck className="w-3 h-3" />
                ذخیره امن مرورگر
              </span>
            </div>
            <div className="relative">
              <input
                type={showApiKey ? 'text' : 'password'}
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder={
                  hasServerKeyForProvider
                    ? 'کلید پیش‌فرض در سرور فعال است (ورود کلید اختیاری است)'
                    : isLocalTarget
                    ? 'برای سرویس محلی Ollama نیازی به کلید نیست'
                    : isAnthropicFamily(provider)
                    ? 'sk-ant-api03-... (کلید Anthropic)'
                    : provider === 'gemini'
                    ? 'AIzaSy... (کلید Google Gemini)'
                    : 'sk-... (کلید اختصاصی OpenAI, DeepSeek, Groq...)'
                }
                dir="ltr"
                className={`w-full pl-10 pr-3.5 py-2.5 rounded-xl font-mono text-xs outline-none transition-all ${
                  isLight
                    ? 'bg-slate-50 border border-slate-300 focus:border-[#3390ec] text-slate-900'
                    : 'bg-[#0e1621] border border-[#242f3d] focus:border-[#5288c1] text-white'
                }`}
              />
              <button
                type="button"
                onClick={() => setShowApiKey(!showApiKey)}
                className={`absolute left-3 top-1/2 -translate-y-1/2 ${
                  isLight ? 'text-slate-400 hover:text-slate-700' : 'text-gray-400 hover:text-white'
                }`}
              >
                {showApiKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
            {hasServerKeyForProvider && !apiKey && (
              <p className="mt-1.5 text-[11px] text-emerald-600 dark:text-emerald-400 flex items-center gap-1">
                <span>✨</span>
                <span>کلید دسترسی این ارائه‌دهنده در محیط سرور تنظیم شده است و مستقیم استفاده می‌شود.</span>
              </p>
            )}
            {isLocalTarget && (
              <p className="mt-1.5 text-[11px] text-blue-600 dark:text-blue-400 flex items-center gap-1">
                <span>💻</span>
                <span>سرویس محلی انتخاب شده است (بدون نیاز به کلید اینترنتی).</span>
              </p>
            )}
          </div>

          {/* Model Identifier */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className={`text-xs font-medium flex items-center gap-1.5 ${isLight ? 'text-slate-700' : 'text-gray-300'}`}>
                <Terminal className="w-3.5 h-3.5 text-purple-500" />
                <span>شناسه مدل (Model ID)</span>
              </label>
              {isReasoningModel && (
                <span className="text-[11px] text-teal-600 dark:text-teal-400 flex items-center gap-1 font-medium">
                  <Cpu className="w-3 h-3" />
                  مدل استدلال و تفکر عمیق
                </span>
              )}
            </div>
            <input
              type="text"
              value={model}
              onChange={(e) => setModel(e.target.value)}
              placeholder="مثال: claude-3-7-sonnet-20250219، deepseek-reasoner یا gpt-4o"
              dir="ltr"
              className={`w-full px-3.5 py-2.5 rounded-xl font-mono text-xs outline-none transition-all ${
                isLight
                  ? 'bg-slate-50 border border-slate-300 focus:border-[#3390ec] text-slate-900'
                  : 'bg-[#0e1621] border border-[#242f3d] focus:border-[#5288c1] text-white'
              }`}
            />
            {/* Preset Models Buttons */}
            {POPULAR_MODELS[provider] && (
              <div className="flex flex-wrap gap-1.5 mt-2">
                {POPULAR_MODELS[provider].map((m) => (
                  <button
                    key={m.id}
                    type="button"
                    onClick={() => setModel(m.id)}
                    className={`text-[11px] px-2.5 py-1 rounded-lg border transition-colors ${
                      model === m.id
                        ? isLight
                          ? 'bg-blue-100 border-[#3390ec] text-[#3390ec] font-semibold'
                          : 'bg-[#2b5278] border-[#5288c1] text-white font-semibold'
                        : isLight
                        ? 'bg-slate-100 hover:bg-slate-200 text-slate-700 border-slate-200'
                        : 'bg-[#202b36] hover:bg-[#283645] text-gray-300 border-[#2b3a4a]'
                    }`}
                  >
                    {m.label}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* System Prompt */}
          <div>
            <label className={`block text-xs font-medium mb-1.5 ${isLight ? 'text-slate-700' : 'text-gray-300'}`}>
              پرامپت سیستمی و نقش اختصاصی (System Prompt)
            </label>
            <textarea
              rows={2}
              value={systemPrompt}
              onChange={(e) => setSystemPrompt(e.target.value)}
              placeholder="مثال: شما یک دستیار هوشمند و کارشناس هستید..."
              className={`w-full px-3.5 py-2 rounded-xl outline-none text-xs transition-all resize-none ${
                isLight
                  ? 'bg-slate-50 border border-slate-300 focus:border-[#3390ec] text-slate-900'
                  : 'bg-[#0e1621] border border-[#242f3d] focus:border-[#5288c1] text-white'
              }`}
            />
          </div>

          {/* Temperature & Color */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-1">
            <div>
              <div className={`flex justify-between text-xs mb-1 ${isLight ? 'text-slate-700' : 'text-gray-300'}`}>
                <span className="flex items-center gap-1">
                  <Sliders className="w-3.5 h-3.5 text-gray-400" />
                  میزان خلاقیت (Temperature):
                </span>
                <span className="font-mono text-blue-500 font-medium">
                  {isReasoningModel ? 'پیش‌فرض مدل' : temperature}
                </span>
              </div>
              <input
                type="range"
                min="0"
                max="1.5"
                step="0.1"
                disabled={isReasoningModel}
                value={temperature}
                onChange={(e) => setTemperature(parseFloat(e.target.value))}
                className="w-full accent-[#3390ec] cursor-pointer disabled:opacity-40"
              />
              <div className={`flex justify-between text-[10px] mt-0.5 ${isLight ? 'text-slate-400' : 'text-gray-500'}`}>
                <span>دقیق و منطقی (0.0)</span>
                <span>خلاق و متنوع (1.5)</span>
              </div>
            </div>

            <div>
              <label className={`block text-xs font-medium mb-1.5 ${isLight ? 'text-slate-700' : 'text-gray-300'}`}>
                رنگ آواتار تلگرام
              </label>
              <div className="flex items-center gap-2">
                {COLOR_OPTIONS.map((c) => (
                  <button
                    key={c.class}
                    type="button"
                    onClick={() => setAvatarColor(c.class)}
                    className={`w-7 h-7 rounded-full bg-gradient-to-tr ${c.class} flex items-center justify-center transition-transform ${
                      avatarColor === c.class ? 'ring-2 ring-blue-500 scale-110' : 'opacity-80 hover:opacity-100'
                    }`}
                  >
                    {avatarColor === c.class && <Check className="w-3.5 h-3.5 text-white" />}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Test Connection Alert Box */}
          {testResult && (
            <div
              className={`p-3 rounded-xl border text-xs flex items-center justify-between animate-in fade-in ${
                testResult.success
                  ? isLight
                    ? 'bg-emerald-50 border-emerald-300 text-emerald-800'
                    : 'bg-emerald-950/40 border-emerald-700/50 text-emerald-300'
                  : isLight
                  ? 'bg-rose-50 border-rose-300 text-rose-800'
                  : 'bg-rose-950/40 border-rose-700/50 text-rose-300'
              }`}
            >
              <span>{testResult.message}</span>
            </div>
          )}
        </form>

        {/* Footer Actions */}
        <div
          className={`px-5 py-3.5 border-t flex items-center justify-between gap-3 ${
            isLight ? 'bg-slate-50 border-slate-200' : 'bg-[#1b2734] border-[#242f3d]'
          }`}
        >
          <button
            type="button"
            onClick={handleTestConnection}
            disabled={isTesting}
            className={`px-3 py-2 text-xs font-medium rounded-xl flex items-center gap-1.5 transition-colors disabled:opacity-50 ${
              isLight
                ? 'bg-slate-200 hover:bg-slate-300 text-slate-800'
                : 'bg-[#242f3d] hover:bg-[#2d3a4b] text-gray-200'
            }`}
          >
            <Zap className="w-3.5 h-3.5 text-amber-500" />
            <span>{isTesting ? 'در حال بررسی...' : 'تست زنده اتصال API'}</span>
          </button>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className={`px-4 py-2 text-xs font-medium rounded-xl transition-colors ${
                isLight
                  ? 'text-slate-600 hover:text-slate-900 hover:bg-slate-200'
                  : 'text-gray-400 hover:text-white hover:bg-[#242f3d]'
              }`}
            >
              انصراف
            </button>
            <button
              type="button"
              onClick={handleSubmit}
              className="px-5 py-2 bg-[#3390ec] hover:bg-[#2881d8] text-white text-xs font-medium rounded-xl shadow-xs transition-colors flex items-center gap-1.5"
            >
              <Check className="w-4 h-4" />
              <span>ذخیره عامل</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
