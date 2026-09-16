import React, { useState } from 'react';
import { AIAgent, ChatMessage, ProviderType, TelegramBotConfig, ThemeSettings, isAnthropicFamily, isOpenAIFamily } from '../types';
import { ServerKeyStatus } from '../services/apiService';
import {
  Search,
  Plus,
  Bot,
  Settings,
  Trash2,
  Sparkles,
  Cpu,
  Moon,
  Sun,
  ShieldCheck,
  Send,
  Palette,
} from 'lucide-react';

interface SidebarProps {
  agents: AIAgent[];
  activeAgentId: string;
  onSelectAgent: (agentId: string) => void;
  onAddNewAgent: () => void;
  onEditAgent: (agent: AIAgent) => void;
  onDeleteAgent: (agentId: string) => void;
  chats: Record<string, ChatMessage[]>;
  isOpenMobile: boolean;
  onCloseMobile: () => void;
  theme: 'dark' | 'light';
  onToggleTheme: () => void;
  serverKeyStatus?: ServerKeyStatus;
  onOpenSettingsModal?: (tab?: 'telegram' | 'theme' | 'agents') => void;
  telegramConfig?: TelegramBotConfig;
  themeSettings?: ThemeSettings;
}

export const Sidebar: React.FC<SidebarProps> = ({
  agents,
  activeAgentId,
  onSelectAgent,
  onAddNewAgent,
  onEditAgent,
  onDeleteAgent,
  chats,
  isOpenMobile,
  onCloseMobile,
  theme,
  onToggleTheme,
  serverKeyStatus,
  onOpenSettingsModal,
  telegramConfig,
  themeSettings,
}) => {
  const isLight = theme === 'light';
  const [searchTerm, setSearchTerm] = useState('');
  const [activeTab, setActiveTab] = useState<'all' | 'gemini' | 'anthropic' | 'openai'>('all');

  const filteredAgents = agents.filter((agent) => {
    const matchesSearch =
      agent.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      agent.model.toLowerCase().includes(searchTerm.toLowerCase()) ||
      (agent.description && agent.description.toLowerCase().includes(searchTerm.toLowerCase()));

    if (!matchesSearch) return false;

    if (activeTab === 'gemini') return agent.provider === 'gemini';
    if (activeTab === 'anthropic') return isAnthropicFamily(agent.provider);
    if (activeTab === 'openai') return isOpenAIFamily(agent.provider);
    return true;
  });

  const getProviderBadge = (provider: ProviderType) => {
    switch (provider) {
      case 'gemini':
        return { label: 'Gemini', color: isLight ? 'bg-blue-100 text-blue-800' : 'bg-blue-900/40 text-blue-300' };
      case 'anthropic':
      case 'anthropic-proxy':
        return { label: 'Claude', color: isLight ? 'bg-amber-100 text-amber-800' : 'bg-amber-900/40 text-amber-300' };
      case 'deepseek':
        return { label: 'DeepSeek', color: isLight ? 'bg-cyan-100 text-cyan-800' : 'bg-cyan-900/40 text-cyan-300' };
      case 'groq':
        return { label: 'Groq', color: isLight ? 'bg-orange-100 text-orange-800' : 'bg-orange-900/40 text-orange-300' };
      case 'openrouter':
        return { label: 'OpenRouter', color: isLight ? 'bg-purple-100 text-purple-800' : 'bg-purple-900/40 text-purple-300' };
      case 'xai':
        return { label: 'xAI', color: isLight ? 'bg-slate-200 text-slate-800' : 'bg-slate-700 text-slate-200' };
      case 'mistral':
        return { label: 'Mistral', color: isLight ? 'bg-amber-100 text-orange-800' : 'bg-orange-900/40 text-amber-300' };
      case 'ollama':
        return { label: 'Ollama', color: isLight ? 'bg-zinc-200 text-zinc-800' : 'bg-zinc-700 text-zinc-200' };
      default:
        return { label: 'OpenAI', color: isLight ? 'bg-teal-100 text-teal-800' : 'bg-teal-900/40 text-teal-300' };
    }
  };

  const getLastMessage = (agentId: string) => {
    const agentMsgs = chats[agentId] || [];
    if (agentMsgs.length === 0) return null;
    return agentMsgs[agentMsgs.length - 1];
  };

  const formatMessageTime = (ts?: number) => {
    if (!ts) return '';
    const d = new Date(ts);
    return d.toLocaleTimeString('fa-IR', { hour: '2-digit', minute: '2-digit' });
  };

  return (
    <aside
      id="telegram-sidebar"
      className={`fixed inset-y-0 right-0 z-40 w-80 md:static md:w-80 border-l flex flex-col transition-all duration-200 ease-in-out select-none ${
        isOpenMobile ? 'translate-x-0 shadow-2xl' : 'translate-x-full md:translate-x-0'
      } ${
        isLight
          ? 'bg-white border-slate-200 text-slate-800'
          : 'bg-[#17212b] border-[#242f3d] text-[#f5f5f5]'
      }`}
      dir="rtl"
    >
      {/* Top Telegram Bar */}
      <div
        className={`p-3 border-b space-y-2.5 ${
          isLight ? 'bg-slate-50 border-slate-200' : 'bg-[#17212b] border-[#242f3d]'
        }`}
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-full bg-[#3390ec] flex items-center justify-center text-white font-bold shadow-xs">
              <Bot className="w-5 h-5" />
            </div>
            <div>
              <span className={`text-sm font-bold block ${isLight ? 'text-slate-900' : 'text-white'}`}>
                عامل‌های تلگرام AI
              </span>
              <span className={`text-[10px] ${isLight ? 'text-slate-500' : 'text-gray-400'}`}>
                Gemini • Claude • OpenAI
              </span>
            </div>
          </div>

          <div className="flex items-center gap-1.5">
            {/* General Settings Button (Telegram Bot & Themes) */}
            <button
              id="sidebar-general-settings-btn"
              onClick={() => onOpenSettingsModal?.('telegram')}
              className={`p-1.5 rounded-xl border transition-colors ${
                isLight
                  ? 'bg-white border-slate-300 text-slate-700 hover:bg-slate-100 shadow-2xs'
                  : 'bg-[#242f3d] border-[#2e3c4d] text-gray-200 hover:bg-[#2d3a4b]'
              }`}
              title="تنظیمات تلگرام و تم‌ها"
            >
              <Settings className="w-4 h-4" />
            </button>

            {/* Dark / Light Mode Toggle Button */}
            <button
              id="sidebar-theme-toggle-btn"
              onClick={onToggleTheme}
              className={`p-1.5 rounded-xl border transition-colors ${
                isLight
                  ? 'bg-white border-slate-300 text-amber-600 hover:bg-slate-100 shadow-2xs'
                  : 'bg-[#242f3d] border-[#2e3c4d] text-yellow-300 hover:bg-[#2d3a4b]'
              }`}
              title={isLight ? 'تغییر به حالت تاریک (Dark Mode)' : 'تغییر به حالت روشن (Light Mode)'}
            >
              {isLight ? <Moon className="w-4 h-4" /> : <Sun className="w-4 h-4" />}
            </button>

            {/* Add New Agent Button */}
            <button
              id="add-new-agent-btn"
              onClick={onAddNewAgent}
              className="flex items-center gap-1 px-2.5 py-1.5 bg-[#3390ec] hover:bg-[#2881d8] text-white rounded-xl text-xs font-medium shadow-xs transition-colors"
              title="افزودن عامل هوش مصنوعی جدید"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>عامل جدید</span>
            </button>
          </div>
        </div>

        {/* Telegram Bot Connection Pill */}
        <div
          id="sidebar-telegram-status-pill"
          onClick={() => onOpenSettingsModal?.('telegram')}
          className={`px-2.5 py-1.5 rounded-xl border flex items-center justify-between cursor-pointer transition-colors text-xs ${
            telegramConfig?.botInfo?.username
              ? isLight
                ? 'bg-blue-50 border-blue-200 text-blue-900 hover:bg-blue-100/80'
                : 'bg-blue-950/40 border-blue-800/50 text-blue-200 hover:bg-blue-950/60'
              : isLight
              ? 'bg-slate-100/80 border-slate-200 text-slate-600 hover:bg-slate-200/70'
              : 'bg-[#202b36] border-[#2b3a4a] text-gray-300 hover:bg-[#283645]'
          }`}
          title="تنظیمات اتصال به ربات تلگرام"
        >
          <div className="flex items-center gap-2 truncate">
            <Send className="w-3.5 h-3.5 text-[#3390ec] shrink-0" />
            {telegramConfig?.botInfo?.username ? (
              <div className="flex items-center gap-1.5 truncate">
                <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse shrink-0" />
                <span className="font-mono text-[11px] font-semibold truncate">@{telegramConfig.botInfo.username}</span>
              </div>
            ) : (
              <span className="text-[11px]">اتصال به ربات تلگرام (Telegram Bot)</span>
            )}
          </div>
          <span className="text-[10px] text-[#3390ec] font-semibold shrink-0">
            {telegramConfig?.botInfo?.username ? 'متصل' : 'اتصال'}
          </span>
        </div>

        {/* Search Box */}
        <div className="relative">
          <input
            type="text"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="جستجو در عامل‌ها یا مدل‌ها..."
            className={`w-full rounded-xl pl-3 pr-8 py-1.5 text-xs outline-none transition-all ${
              isLight
                ? 'bg-white border border-slate-300 focus:border-[#3390ec] text-slate-900 placeholder:text-slate-400'
                : 'bg-[#0e1621] border border-[#242f3d] focus:border-[#5288c1] text-white placeholder:text-gray-500'
            }`}
          />
          <Search
            className={`w-3.5 h-3.5 absolute right-2.5 top-1/2 -translate-y-1/2 ${
              isLight ? 'text-slate-400' : 'text-gray-400'
            }`}
          />
        </div>

        {/* Filter Tabs */}
        <div className="flex items-center gap-1 pt-0.5">
          <button
            onClick={() => setActiveTab('all')}
            className={`flex-1 py-1 text-[11px] rounded-lg transition-colors font-medium ${
              activeTab === 'all'
                ? isLight
                  ? 'bg-[#3390ec] text-white shadow-xs'
                  : 'bg-[#2b5278] text-white'
                : isLight
                ? 'text-slate-600 hover:bg-slate-200'
                : 'text-gray-400 hover:text-white hover:bg-[#202b36]'
            }`}
          >
            همه ({agents.length})
          </button>
          <button
            onClick={() => setActiveTab('gemini')}
            className={`flex-1 py-1 text-[11px] rounded-lg transition-colors font-medium ${
              activeTab === 'gemini'
                ? isLight
                  ? 'bg-blue-600 text-white shadow-xs'
                  : 'bg-blue-700 text-white'
                : isLight
                ? 'text-slate-600 hover:bg-slate-200'
                : 'text-gray-400 hover:text-white hover:bg-[#202b36]'
            }`}
          >
            Gemini
          </button>
          <button
            onClick={() => setActiveTab('anthropic')}
            className={`flex-1 py-1 text-[11px] rounded-lg transition-colors font-medium ${
              activeTab === 'anthropic'
                ? isLight
                  ? 'bg-amber-600 text-white shadow-xs'
                  : 'bg-amber-700 text-white'
                : isLight
                ? 'text-slate-600 hover:bg-slate-200'
                : 'text-gray-400 hover:text-white hover:bg-[#202b36]'
            }`}
          >
            Claude
          </button>
          <button
            onClick={() => setActiveTab('openai')}
            className={`flex-1 py-1 text-[11px] rounded-lg transition-colors font-medium ${
              activeTab === 'openai'
                ? isLight
                  ? 'bg-teal-600 text-white shadow-xs'
                  : 'bg-teal-700 text-white'
                : isLight
                ? 'text-slate-600 hover:bg-slate-200'
                : 'text-gray-400 hover:text-white hover:bg-[#202b36]'
            }`}
          >
            OpenAI و هم‌خانواده
          </button>
        </div>
      </div>

      {/* Agents / Chats List */}
      <div className="flex-1 overflow-y-auto p-1.5 space-y-1">
        {filteredAgents.length === 0 ? (
          <div className="text-center py-10 px-4 text-xs">
            <Bot className={`w-8 h-8 mx-auto mb-2 opacity-50 ${isLight ? 'text-slate-400' : 'text-gray-500'}`} />
            <p className={isLight ? 'text-slate-500' : 'text-gray-400'}>عاملی با این مشخصات یافت نشد.</p>
          </div>
        ) : (
          filteredAgents.map((agent) => {
            const isActive = agent.id === activeAgentId;
            const lastMsg = getLastMessage(agent.id);

            const isLocal = Boolean(
              agent.provider === 'ollama' ||
              (agent.baseUrl && (agent.baseUrl.includes('localhost') || agent.baseUrl.includes('127.0.0.1') || agent.baseUrl.includes(':11434')))
            );
            const hasServerKey = Boolean(
              (agent.provider === 'gemini' && serverKeyStatus?.hasGeminiKey) ||
              (agent.provider === 'openai' && serverKeyStatus?.hasOpenAIKey && agent.baseUrl.includes('openai.com')) ||
              (isAnthropicFamily(agent.provider) && serverKeyStatus?.hasAnthropicKey) ||
              (agent.provider === 'deepseek' && serverKeyStatus?.hasDeepSeekKey) ||
              (agent.provider === 'groq' && serverKeyStatus?.hasGroqKey) ||
              (agent.provider === 'openrouter' && serverKeyStatus?.hasOpenRouterKey) ||
              (agent.provider === 'xai' && serverKeyStatus?.hasXAIKey) ||
              (agent.provider === 'mistral' && serverKeyStatus?.hasMistralKey)
            );
            const isConfigured = Boolean(agent.apiKey && agent.apiKey.trim().length > 0) || hasServerKey || isLocal;
            const badge = getProviderBadge(agent.provider);

            return (
              <div
                key={agent.id}
                onClick={() => {
                  onSelectAgent(agent.id);
                  onCloseMobile();
                }}
                className={`group relative flex items-center gap-3 p-2.5 rounded-xl cursor-pointer transition-all ${
                  isActive
                    ? isLight
                      ? 'bg-blue-50/90 text-slate-900 border border-blue-200 shadow-xs'
                      : 'bg-[#2b5278] text-white shadow-xs'
                    : isLight
                    ? 'hover:bg-slate-100 text-slate-800'
                    : 'hover:bg-[#202b36] text-gray-200'
                }`}
              >
                {/* Avatar with Status Dot */}
                <div className="relative shrink-0">
                  <div
                    className={`w-11 h-11 rounded-full bg-gradient-to-tr ${agent.avatarColor} flex items-center justify-center text-white font-bold text-sm shadow-xs`}
                  >
                    {agent.name.charAt(0) || <Bot className="w-5 h-5" />}
                  </div>
                  <span
                    className={`absolute bottom-0 left-0 w-2.5 h-2.5 bg-emerald-500 border-2 rounded-full ${
                      isLight ? 'border-white' : 'border-[#17212b]'
                    }`}
                  />
                </div>

                {/* Agent Details */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-1 mb-0.5">
                    <h3 className={`text-xs font-semibold truncate ${isLight ? 'text-slate-900' : 'text-white'}`}>
                      {agent.name}
                    </h3>
                    <span className={`text-[10px] shrink-0 ${isLight ? 'text-slate-500' : 'text-gray-400'}`}>
                      {lastMsg ? formatMessageTime(lastMsg.timestamp) : ''}
                    </span>
                  </div>

                  {/* Model Name & Snippet */}
                  <div
                    className={`flex items-center justify-between text-[11px] ${
                      isLight ? 'text-slate-500' : 'text-gray-400'
                    }`}
                  >
                    <span className="truncate max-w-[130px]">
                      {lastMsg ? (
                        lastMsg.role === 'user' ? `شما: ${lastMsg.content}` : lastMsg.content
                      ) : (
                        <span className={isLight ? 'text-slate-400' : 'text-gray-500'}>{agent.model}</span>
                      )}
                    </span>

                    {/* Key status indicator or Provider badge */}
                    {!isConfigured ? (
                      <span className="text-[9px] px-1.5 py-0.5 bg-amber-500/20 text-amber-700 dark:text-amber-300 rounded font-medium shrink-0">
                        فاقد کلید
                      </span>
                    ) : (
                      <span
                        className={`text-[9px] px-1.5 py-0.5 rounded font-medium shrink-0 ${badge.color}`}
                      >
                        {badge.label}
                      </span>
                    )}
                  </div>
                </div>

                {/* Quick Action Button on Hover */}
                <div className="opacity-0 group-hover:opacity-100 flex items-center gap-1 transition-opacity">
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onEditAgent(agent);
                    }}
                    className={`p-1 rounded transition-colors ${
                      isLight
                        ? 'hover:bg-slate-200 text-slate-600 hover:text-slate-900'
                        : 'hover:bg-[#242f3d] text-gray-300 hover:text-white'
                    }`}
                    title="ویرایش تنظیمات عامل"
                  >
                    <Settings className="w-3.5 h-3.5" />
                  </button>

                  {agent.isCustom && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        onDeleteAgent(agent.id);
                      }}
                      className={`p-1 rounded transition-colors ${
                        isLight
                          ? 'hover:bg-rose-100 text-rose-500'
                          : 'hover:bg-[#242f3d] text-gray-300 hover:text-rose-400'
                      }`}
                      title="حذف عامل"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Bottom Footer Info */}
      <div
        className={`p-2.5 border-t text-xs flex items-center justify-between gap-2 ${
          isLight ? 'bg-slate-50 border-slate-200 text-slate-600' : 'bg-[#141d26] border-[#242f3d] text-gray-400'
        }`}
      >
        <button
          onClick={() => onOpenSettingsModal?.('theme')}
          className={`flex items-center gap-1 text-[11px] px-2 py-1 rounded-md border transition-colors ${
            isLight
              ? 'bg-white border-slate-300 hover:bg-slate-100 text-slate-700'
              : 'bg-[#202b36] border-[#2b3a4a] hover:bg-[#283645] text-gray-300'
          }`}
          title="شخصی‌سازی تم، رنگ و فونت"
        >
          <Palette className="w-3.5 h-3.5 text-indigo-500" />
          <span>تنظیمات تم</span>
        </button>

        <button
          onClick={onToggleTheme}
          className={`flex items-center gap-1 text-[11px] px-2 py-1 rounded-md border transition-colors ${
            isLight
              ? 'bg-white border-slate-300 hover:bg-slate-100 text-slate-700'
              : 'bg-[#202b36] border-[#2b3a4a] hover:bg-[#283645] text-gray-300'
          }`}
          title="تغییر سریع حالت تاریک/روشن"
        >
          {isLight ? <Moon className="w-3 h-3 text-indigo-500" /> : <Sun className="w-3 h-3 text-amber-400" />}
          <span>{isLight ? 'تاریک' : 'روشن'}</span>
        </button>
      </div>
    </aside>
  );
};
