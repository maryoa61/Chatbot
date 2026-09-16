import React from 'react';
import { AIAgent, TelegramBotConfig } from '../types';
import { Bot, Globe, Settings, Info, Trash2, KeyRound, Moon, Sun, Search, Send, Sliders } from 'lucide-react';

interface ChatHeaderProps {
  agent: AIAgent;
  isSearching: boolean;
  isTyping: boolean;
  webSearchEnabled: boolean;
  onToggleWebSearch: () => void;
  onOpenSettings: () => void;
  onToggleInfo: () => void;
  onClearChat: () => void;
  theme: 'dark' | 'light';
  onToggleTheme: () => void;
  isSearchOpen: boolean;
  onToggleSearch: () => void;
  onOpenSettingsModal?: (tab?: 'telegram' | 'theme' | 'agents') => void;
  telegramConfig?: TelegramBotConfig;
}

export const ChatHeader: React.FC<ChatHeaderProps> = ({
  agent,
  isSearching,
  isTyping,
  webSearchEnabled,
  onToggleWebSearch,
  onOpenSettings,
  onToggleInfo,
  onClearChat,
  theme,
  onToggleTheme,
  isSearchOpen,
  onToggleSearch,
  onOpenSettingsModal,
  telegramConfig,
}) => {
  const isLight = theme === 'light';
  const isKeyConfigured = Boolean(agent.apiKey && agent.apiKey.trim().length > 0);

  return (
    <header
      id="telegram-chat-header"
      className={`h-16 px-4 border-b flex items-center justify-between select-none z-10 transition-colors ${
        isLight
          ? 'bg-white border-slate-200 text-slate-800 shadow-2xs'
          : 'bg-[#17212b] border-[#242f3d] text-white'
      }`}
      dir="rtl"
    >
      {/* Agent profile info */}
      <div className="flex items-center gap-3 min-w-0 cursor-pointer" onClick={onToggleInfo}>
        <div className="relative">
          <div
            className={`w-10 h-10 rounded-full bg-gradient-to-tr ${agent.avatarColor} flex items-center justify-center text-white shadow-xs font-semibold`}
          >
            {agent.name.charAt(0) || <Bot className="w-5 h-5" />}
          </div>
          <span
            className={`absolute bottom-0 left-0 w-3 h-3 bg-emerald-500 border-2 rounded-full ${
              isLight ? 'border-white' : 'border-[#17212b]'
            }`}
          />
        </div>

        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h1 className={`font-semibold text-sm truncate ${isLight ? 'text-slate-900' : 'text-white'}`}>
              {agent.name}
            </h1>
            <span
              className={`text-[10px] px-1.5 py-0.5 rounded font-mono font-medium ${
                agent.provider === 'gemini'
                  ? isLight
                    ? 'bg-blue-100 text-blue-800 border border-blue-200'
                    : 'bg-blue-950/60 text-blue-300 border border-blue-800/40'
                  : agent.provider === 'anthropic'
                  ? isLight
                    ? 'bg-amber-100 text-amber-800 border border-amber-200'
                    : 'bg-amber-950/60 text-amber-300 border border-amber-800/40'
                  : isLight
                  ? 'bg-teal-100 text-teal-800 border border-teal-200'
                  : 'bg-emerald-950/60 text-emerald-300 border border-emerald-800/40'
              }`}
            >
              {agent.model}
            </span>
          </div>
          <div
            className={`text-xs flex items-center gap-1.5 truncate ${
              isLight ? 'text-slate-500' : 'text-[#7f91a4]'
            }`}
          >
            {isSearching ? (
              <span className="text-cyan-500 flex items-center gap-1 font-medium animate-pulse">
                <Globe className="w-3 h-3 animate-spin" />
                در حال جستجوی وب...
              </span>
            ) : isTyping ? (
              <span className={`flex items-center gap-1 font-medium ${isLight ? 'text-[#3390ec]' : 'text-[#5288c1]'}`}>
                <span>در حال نوشتن</span>
                <span className="animate-bounce">.</span>
                <span className="animate-bounce delay-100">.</span>
                <span className="animate-bounce delay-200">.</span>
              </span>
            ) : (
              <span>آنلاین • ربات هوش مصنوعی</span>
            )}
          </div>
        </div>
      </div>

      {/* Action buttons */}
      <div className="flex items-center gap-1.5 sm:gap-2">
        {/* In-Chat Message Search Toggle Button */}
        <button
          id="toggle-message-search-btn"
          onClick={onToggleSearch}
          className={`p-2 rounded-xl transition-colors ${
            isSearchOpen
              ? isLight
                ? 'bg-blue-100 text-[#3390ec] ring-1 ring-blue-300 shadow-2xs'
                : 'bg-[#2b5278] text-cyan-300 ring-1 ring-[#5288c1]'
              : isLight
              ? 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
              : 'text-gray-400 hover:text-white hover:bg-[#242f3d]'
          }`}
          title="جستجو در پیام‌های این گفتگو (Ctrl+F)"
        >
          <Search className="w-4 h-4" />
        </button>

        {/* API Key Missing Alert Pill */}
        {!isKeyConfigured && (
          <button
            onClick={onOpenSettings}
            className={`hidden sm:flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium transition-colors ${
              isLight
                ? 'bg-amber-100 hover:bg-amber-200 text-amber-800 border border-amber-300'
                : 'bg-amber-500/10 hover:bg-amber-500/20 text-amber-300 border border-amber-500/30'
            }`}
            title="کلید API هنوز ذخیره نشده است"
          >
            <KeyRound className="w-3.5 h-3.5" />
            <span>تنظیم API Key</span>
          </button>
        )}

        {/* Telegram Bot status pill */}
        <button
          onClick={() => onOpenSettingsModal?.('telegram')}
          className={`hidden md:flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border transition-colors ${
            telegramConfig?.botInfo?.username
              ? isLight
                ? 'bg-blue-50 text-blue-800 border-blue-200 hover:bg-blue-100'
                : 'bg-blue-950/50 text-blue-300 border-blue-800/40 hover:bg-blue-900/50'
              : isLight
              ? 'bg-slate-100 text-slate-600 border-slate-200 hover:bg-slate-200/70'
              : 'bg-[#202b36] text-gray-400 border-[#2b3a4a] hover:bg-[#283645]'
          }`}
          title="تنظیمات اتصال به ربات تلگرام"
        >
          <Send className="w-3 h-3 text-[#3390ec]" />
          {telegramConfig?.botInfo?.username ? (
            <div className="flex items-center gap-1">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
              <span className="font-mono text-[11px]">@{telegramConfig.botInfo.username}</span>
            </div>
          ) : (
            <span className="text-[11px]">ربات تلگرام</span>
          )}
        </button>

        {/* General Settings (Telegram & Theme) */}
        <button
          id="header-general-settings-btn"
          onClick={() => onOpenSettingsModal?.('telegram')}
          className={`p-2 rounded-xl transition-colors ${
            isLight
              ? 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
              : 'text-gray-400 hover:text-white hover:bg-[#242f3d]'
          }`}
          title="تنظیمات کلی سیستم (ربات تلگرام، تم‌ها و عامل‌ها)"
        >
          <Sliders className="w-4 h-4" />
        </button>

        {/* Web Search Toggle Button */}
        <button
          id="web-search-toggle-btn"
          onClick={onToggleWebSearch}
          className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl text-xs font-medium transition-all ${
            webSearchEnabled
              ? isLight
                ? 'bg-cyan-50 text-cyan-700 border border-cyan-300 shadow-2xs font-semibold'
                : 'bg-[#2b5278] text-cyan-300 border border-[#5288c1] shadow-xs'
              : isLight
              ? 'bg-slate-100 hover:bg-slate-200 text-slate-600 border border-slate-200'
              : 'bg-[#202b36] hover:bg-[#283645] text-gray-400 border border-[#2b3a4a]'
          }`}
          title={
            webSearchEnabled
              ? 'جستجوی وب فعال است (نتایج زنده به هوش مصنوعی داده می‌شود)'
              : 'فعال‌سازی جستجوی وب'
          }
        >
          <Globe className={`w-4 h-4 ${webSearchEnabled ? 'text-cyan-500 animate-pulse' : ''}`} />
          <span className="hidden md:inline">وب سرچ</span>
          {webSearchEnabled && <span className="w-1.5 h-1.5 rounded-full bg-cyan-500" />}
        </button>

        {/* Dark / Light Mode Toggle */}
        <button
          id="header-theme-toggle-btn"
          onClick={onToggleTheme}
          className={`p-2 rounded-xl transition-colors ${
            isLight
              ? 'text-slate-600 hover:text-amber-600 hover:bg-slate-100'
              : 'text-gray-400 hover:text-yellow-300 hover:bg-[#242f3d]'
          }`}
          title={isLight ? 'تغییر به حالت تاریک (Dark Mode)' : 'تغییر به حالت روشن (Light Mode)'}
        >
          {isLight ? <Moon className="w-4 h-4" /> : <Sun className="w-4 h-4" />}
        </button>

        {/* Edit Agent Settings Button */}
        <button
          id="edit-agent-settings-btn"
          onClick={onOpenSettings}
          className={`p-2 rounded-xl transition-colors ${
            isLight
              ? 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
              : 'text-gray-400 hover:text-white hover:bg-[#242f3d]'
          }`}
          title="تنظیمات عامل (API Key و Base URL)"
        >
          <Settings className="w-4 h-4" />
        </button>

        {/* Clear Chat History */}
        <button
          id="clear-chat-btn"
          onClick={onClearChat}
          className={`p-2 rounded-xl transition-colors ${
            isLight
              ? 'text-slate-600 hover:text-rose-600 hover:bg-slate-100'
              : 'text-gray-400 hover:text-rose-400 hover:bg-[#242f3d]'
          }`}
          title="پاک کردن پیام‌ها"
        >
          <Trash2 className="w-4 h-4" />
        </button>

        {/* Info Drawer Toggle */}
        <button
          id="toggle-info-drawer-btn"
          onClick={onToggleInfo}
          className={`p-2 rounded-xl transition-colors ${
            isLight
              ? 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
              : 'text-gray-400 hover:text-white hover:bg-[#242f3d]'
          }`}
          title="اطلاعات عامل هوش مصنوعی"
        >
          <Info className="w-4 h-4" />
        </button>
      </div>
    </header>
  );
};
