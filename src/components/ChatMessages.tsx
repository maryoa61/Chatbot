import React, { useState, useRef, useEffect, useMemo } from 'react';
import { AIAgent, Attachment, ChatMessage, WebSource, ThemeSettings } from '../types';
import Markdown from 'react-markdown';
import {
  CheckCheck,
  Copy,
  Check,
  Volume2,
  VolumeX,
  FileText,
  ExternalLink,
  Bot,
  Globe,
  Maximize2,
  Sparkles,
  ChevronDown,
  ChevronUp,
  AlertCircle,
  Search,
  X,
} from 'lucide-react';

interface ChatMessagesProps {
  messages: ChatMessage[];
  agent: AIAgent;
  isTyping: boolean;
  isSearching: boolean;
  onSendPresetPrompt: (prompt: string) => void;
  onOpenSettings: () => void;
  theme?: 'dark' | 'light';
  themeSettings?: ThemeSettings;
  isSearchOpen?: boolean;
  onToggleSearch?: () => void;
  onCloseSearch?: () => void;
  isAgentReady?: boolean;
}

// Highlight matching words helper
function highlightText(text: string, query: string, isLight: boolean): React.ReactNode {
  if (!query || !query.trim() || !text) return text;
  const trimmed = query.trim();
  const escaped = trimmed.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const regex = new RegExp(`(${escaped})`, 'gi');
  const parts = text.split(regex);
  if (parts.length <= 1) return text;

  return parts.map((part, i) =>
    part.toLowerCase() === trimmed.toLowerCase() ? (
      <mark
        key={i}
        className={`rounded px-1 font-semibold ${
          isLight
            ? 'bg-amber-300 text-slate-900 ring-1 ring-amber-400'
            : 'bg-amber-400/40 text-amber-200 ring-1 ring-amber-400/60'
        }`}
      >
        {part}
      </mark>
    ) : (
      part
    )
  );
}

function highlightChildren(children: React.ReactNode, query: string, isLight: boolean): React.ReactNode {
  if (!query || !query.trim() || !children) return children;
  if (typeof children === 'string') {
    return highlightText(children, query, isLight);
  }
  if (Array.isArray(children)) {
    return children.map((child, i) => (
      <React.Fragment key={i}>
        {highlightChildren(child, query, isLight)}
      </React.Fragment>
    ));
  }
  return children;
}

export const ChatMessages: React.FC<ChatMessagesProps> = ({
  messages,
  agent,
  isTyping,
  isSearching,
  onSendPresetPrompt,
  onOpenSettings,
  theme = 'dark',
  themeSettings,
  isSearchOpen = true,
  onToggleSearch,
  onCloseSearch,
  isAgentReady = false,
}) => {
  const activeTheme = themeSettings?.theme || (theme === 'light' ? 'light' : 'dark');
  const isLight = activeTheme === 'light';
  const activeAccent = themeSettings?.accentColor || 'blue';
  const activePattern = themeSettings?.chatPattern || 'doodle';
  const activeFontSize = themeSettings?.fontSize || 'medium';

  const fontClass =
    activeFontSize === 'small'
      ? 'text-xs'
      : activeFontSize === 'large'
      ? 'text-base'
      : 'text-sm';

  const getUserBubbleClasses = (isActiveMatch: boolean, isMatched: boolean) => {
    if (isActiveMatch) {
      return isLight
        ? 'bg-[#eff6ff] text-slate-900 border-2 border-amber-500 ring-4 ring-amber-400/30 scale-[1.01] shadow-xl'
        : 'bg-[#2b5278] text-white border-2 border-amber-400 ring-4 ring-amber-400/30 scale-[1.01] shadow-xl';
    }
    if (isMatched) {
      return isLight
        ? 'bg-[#eff6ff] text-slate-900 border-2 border-amber-300 ring-1 ring-amber-300/40'
        : 'bg-[#2b5278] text-white border-2 border-amber-400/70';
    }

    switch (activeAccent) {
      case 'green':
        return isLight
          ? 'bg-[#ecfdf5] text-emerald-950 border border-emerald-300'
          : 'bg-[#134e4a] text-white border border-[#115e59]';
      case 'purple':
        return isLight
          ? 'bg-[#faf5ff] text-purple-950 border border-purple-300'
          : 'bg-[#4c1d95] text-white border border-[#581c87]';
      case 'amber':
        return isLight
          ? 'bg-[#fffbeb] text-amber-950 border border-amber-300'
          : 'bg-[#78350f] text-white border border-[#92400e]';
      case 'rose':
        return isLight
          ? 'bg-[#fff1f2] text-rose-950 border border-rose-300'
          : 'bg-[#881337] text-white border border-[#9f1239]';
      case 'cyan':
        return isLight
          ? 'bg-[#ecfeff] text-cyan-950 border border-cyan-300'
          : 'bg-[#155e75] text-white border border-[#0e7490]';
      case 'blue':
      default:
        return isLight
          ? 'bg-[#eff6ff] text-slate-900 border border-blue-200'
          : 'bg-[#2b5278] text-white border border-[#3b658d]';
    }
  };

  const getAssistantBubbleClasses = (isActiveMatch: boolean, isMatched: boolean) => {
    if (isActiveMatch) {
      return isLight
        ? 'bg-white text-slate-800 border-2 border-amber-500 ring-4 ring-amber-400/30 scale-[1.01] shadow-xl'
        : 'bg-[#182533] text-[#f5f5f5] border-2 border-amber-400 ring-4 ring-amber-400/30 scale-[1.01] shadow-xl';
    }
    if (isMatched) {
      return isLight
        ? 'bg-white text-slate-800 border-2 border-amber-300 ring-1 ring-amber-300/40'
        : 'bg-[#182533] text-[#f5f5f5] border-2 border-amber-400/70';
    }
    if (activeTheme === 'light') return 'bg-white text-slate-800 border-slate-200';
    if (activeTheme === 'midnight') return 'bg-[#0f1d2c] text-slate-100 border-[#1c3249]';
    if (activeTheme === 'desert') return 'bg-[#261f1a] text-amber-50 border-[#3a3028]';
    return 'bg-[#182533] text-[#f5f5f5] border-[#242f3d]';
  };

  const bottomRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  // States
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [speakingId, setSpeakingId] = useState<string | null>(null);
  const [previewImage, setPreviewImage] = useState<string | null>(null);
  const [expandedSources, setExpandedSources] = useState<Record<string, boolean>>({});

  // In-chat search states
  const [searchQuery, setSearchQuery] = useState('');
  const [currentMatchIdx, setCurrentMatchIdx] = useState(0);

  // Auto-scroll to bottom on new incoming messages (unless actively searching)
  useEffect(() => {
    if (!searchQuery.trim()) {
      bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages, isTyping, isSearching]);

  // Focus search input when search is opened
  useEffect(() => {
    if (isSearchOpen) {
      setTimeout(() => {
        searchInputRef.current?.focus();
        searchInputRef.current?.select();
      }, 100);
    }
  }, [isSearchOpen]);

  // Keyboard shortcut Ctrl+F / Cmd+F to open search
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f') {
        e.preventDefault();
        if (!isSearchOpen && onToggleSearch) {
          onToggleSearch();
        }
        setTimeout(() => searchInputRef.current?.focus(), 50);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isSearchOpen, onToggleSearch]);

  // Calculate matching messages
  const matchingMessages = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return [];
    return messages.filter((msg) => {
      const matchContent = msg.content && msg.content.toLowerCase().includes(q);
      const matchAttachment = msg.attachments?.some((a) => a.name.toLowerCase().includes(q));
      return matchContent || matchAttachment;
    });
  }, [messages, searchQuery]);

  // Reset match index if matching list changes
  useEffect(() => {
    setCurrentMatchIdx(0);
  }, [searchQuery]);

  // Active match ID
  const activeMatchId = matchingMessages[currentMatchIdx]?.id;

  // Scroll active match into view smoothly
  useEffect(() => {
    if (activeMatchId) {
      const el = document.getElementById(`msg-container-${activeMatchId}`);
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    }
  }, [activeMatchId, currentMatchIdx]);

  const handlePrevMatch = () => {
    if (matchingMessages.length === 0) return;
    setCurrentMatchIdx((prev) => (prev > 0 ? prev - 1 : matchingMessages.length - 1));
  };

  const handleNextMatch = () => {
    if (matchingMessages.length === 0) return;
    setCurrentMatchIdx((prev) => (prev < matchingMessages.length - 1 ? prev + 1 : 0));
  };

  const handleSearchKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      if (e.shiftKey) {
        handlePrevMatch();
      } else {
        handleNextMatch();
      }
    } else if (e.key === 'Escape') {
      if (searchQuery) {
        setSearchQuery('');
      } else if (onCloseSearch) {
        onCloseSearch();
      }
    }
  };

  const handleCopy = (id: string, text: string) => {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const handleSpeak = (id: string, text: string) => {
    if (!('speechSynthesis' in window)) return;

    if (speakingId === id) {
      window.speechSynthesis.cancel();
      setSpeakingId(null);
      return;
    }

    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text.slice(0, 300));
    utterance.onend = () => setSpeakingId(null);
    utterance.onerror = () => setSpeakingId(null);
    setSpeakingId(id);
    window.speechSynthesis.speak(utterance);
  };

  const toggleSources = (msgId: string) => {
    setExpandedSources((prev) => ({ ...prev, [msgId]: !prev[msgId] }));
  };

  const formatTime = (ts: number) => {
    const d = new Date(ts);
    return d.toLocaleTimeString('fa-IR', { hour: '2-digit', minute: '2-digit' });
  };

  const isLocal = Boolean(
    agent.baseUrl && (agent.baseUrl.includes('localhost') || agent.baseUrl.includes('127.0.0.1') || agent.baseUrl.includes(':11434'))
  );
  const isKeyConfigured = Boolean(agent.apiKey && agent.apiKey.trim().length > 0) || isAgentReady || isLocal;

  return (
    <div className="flex-1 flex flex-col h-full overflow-hidden relative" dir="rtl">
      {/* 🔍 TOP SEARCH BAR IN MESSAGE LIST */}
      {isSearchOpen ? (
        <div
          id="in-chat-search-bar"
          className={`px-3 sm:px-4 py-2 border-b flex items-center gap-2 shadow-xs z-20 backdrop-blur-md transition-all duration-200 ${
            isLight
              ? 'bg-white/95 border-slate-200 text-slate-800'
              : 'bg-[#17212b]/95 border-[#242f3d] text-white'
          }`}
        >
          {/* Search Icon */}
          <Search className={`w-4 h-4 shrink-0 ${isLight ? 'text-slate-400' : 'text-gray-400'}`} />

          {/* Search Input */}
          <input
            ref={searchInputRef}
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onKeyDown={handleSearchKeyDown}
            placeholder="جستجو در متن پیام‌های این گفتگو... (Enter برای پیام بعد)"
            className={`w-full bg-transparent text-xs sm:text-sm outline-none leading-normal ${
              isLight ? 'text-slate-900 placeholder:text-slate-400' : 'text-white placeholder:text-gray-500'
            }`}
          />

          {/* Results Count Badge */}
          {searchQuery.trim() && (
            <span
              className={`text-[11px] whitespace-nowrap px-2 py-0.5 rounded-full font-medium shrink-0 ${
                matchingMessages.length > 0
                  ? isLight
                    ? 'bg-blue-100 text-blue-800 border border-blue-200'
                    : 'bg-[#2b5278] text-cyan-300 border border-[#5288c1]'
                  : isLight
                  ? 'bg-rose-100 text-rose-700 border border-rose-200'
                  : 'bg-rose-950/60 text-rose-300 border border-rose-800/40'
              }`}
            >
              {matchingMessages.length > 0
                ? `${currentMatchIdx + 1} از ${matchingMessages.length} پیام`
                : 'موردی یافت نشد'}
            </span>
          )}

          {/* Up & Down Match Navigation Buttons */}
          <div className="flex items-center gap-0.5 shrink-0 border-r pr-1 mr-1 border-slate-300 dark:border-[#242f3d]">
            <button
              type="button"
              onClick={handlePrevMatch}
              disabled={matchingMessages.length === 0}
              className={`p-1.5 rounded-lg disabled:opacity-30 transition-colors ${
                isLight ? 'hover:bg-slate-100 text-slate-600' : 'hover:bg-[#242f3d] text-gray-300'
              }`}
              title="پیام قبلی (Shift+Enter)"
            >
              <ChevronUp className="w-4 h-4" />
            </button>
            <button
              type="button"
              onClick={handleNextMatch}
              disabled={matchingMessages.length === 0}
              className={`p-1.5 rounded-lg disabled:opacity-30 transition-colors ${
                isLight ? 'hover:bg-slate-100 text-slate-600' : 'hover:bg-[#242f3d] text-gray-300'
              }`}
              title="پیام بعدی (Enter)"
            >
              <ChevronDown className="w-4 h-4" />
            </button>
          </div>

          {/* Clear text button */}
          {searchQuery && (
            <button
              type="button"
              onClick={() => {
                setSearchQuery('');
                searchInputRef.current?.focus();
              }}
              className={`p-1 rounded-md transition-colors ${
                isLight ? 'text-slate-400 hover:text-slate-700' : 'text-gray-400 hover:text-white'
              }`}
              title="پاک کردن عبارت جستجو"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}

          {/* Close search bar button */}
          <button
            type="button"
            onClick={() => {
              setSearchQuery('');
              onCloseSearch?.();
            }}
            className={`p-1.5 rounded-lg transition-colors ${
              isLight
                ? 'text-slate-400 hover:text-slate-700 hover:bg-slate-100'
                : 'text-gray-400 hover:text-white hover:bg-[#242f3d]'
            }`}
            title="بستن نوار جستجو (Esc)"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      ) : (
        /* Subtle quick trigger if search bar is collapsed */
        <div className="absolute top-2 left-4 z-20">
          <button
            onClick={onToggleSearch}
            className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs shadow-md border backdrop-blur-xs transition-all opacity-85 hover:opacity-100 ${
              isLight
                ? 'bg-white/90 hover:bg-white text-slate-700 border-slate-200'
                : 'bg-[#17212b]/90 hover:bg-[#17212b] text-gray-300 border-[#242f3d]'
            }`}
            title="جستجو در پیام‌ها (Ctrl+F)"
          >
            <Search className="w-3.5 h-3.5 text-blue-500" />
            <span className="text-[11px]">جستجو در پیام‌ها</span>
          </button>
        </div>
      )}

      {/* 📜 MESSAGES SCROLL CONTAINER */}
      <div
        id="telegram-messages-container"
        className={`flex-1 overflow-y-auto p-3 sm:p-4 space-y-4 relative transition-colors ${
          activeTheme === 'light'
            ? activePattern === 'doodle'
              ? 'telegram-pattern-light'
              : activePattern === 'gradient'
              ? 'bg-gradient-to-br from-[#f8fafc] via-[#eef2f6] to-[#e2e8f0]'
              : 'bg-[#f1f5f9]'
            : activeTheme === 'midnight'
            ? activePattern === 'doodle'
              ? 'telegram-pattern-dark bg-[#081018]'
              : activePattern === 'gradient'
              ? 'bg-gradient-to-br from-[#081018] via-[#0d1b2a] to-[#132232]'
              : 'bg-[#081018]'
            : activeTheme === 'desert'
            ? activePattern === 'doodle'
              ? 'telegram-pattern-dark bg-[#1c1917]'
              : activePattern === 'gradient'
              ? 'bg-gradient-to-br from-[#1c1917] via-[#241f1c] to-[#2e2622]'
              : 'bg-[#1c1917]'
            : activePattern === 'doodle'
            ? 'telegram-pattern-dark bg-[#0e1621]'
            : activePattern === 'gradient'
            ? 'bg-gradient-to-br from-[#0e1621] via-[#141e2b] to-[#1a2737]'
            : 'bg-[#0e1621]'
        }`}
      >
        {/* Top Banner when API Key is missing */}
        {!isKeyConfigured && (
          <div
            className={`max-w-md mx-auto my-2 p-3 rounded-2xl text-xs flex items-center justify-between shadow-md border ${
              isLight
                ? 'bg-amber-50 border-amber-300 text-amber-900'
                : 'bg-amber-950/70 border-amber-600/40 text-amber-200'
            }`}
          >
            <div className="flex items-center gap-2">
              <AlertCircle className="w-4 h-4 text-amber-500 shrink-0" />
              <span>
                کلید API برای <b>{agent.name}</b> هنوز تنظیم نشده است.
              </span>
            </div>
            <button
              onClick={onOpenSettings}
              className="px-2.5 py-1 bg-amber-600 hover:bg-amber-500 text-white rounded-lg text-xs font-semibold shrink-0 transition-colors shadow-2xs"
            >
              تنظیم کلید
            </button>
          </div>
        )}

        {/* Empty State / Welcome Screen */}
        {messages.length === 0 && (
          <div
            className={`max-w-md mx-auto my-8 p-6 rounded-3xl text-center shadow-xl border animate-in fade-in zoom-in-95 duration-300 ${
              isLight
                ? 'bg-white/95 backdrop-blur-xs border-slate-200 text-slate-800'
                : 'bg-[#17212b]/90 backdrop-blur-xs border-[#242f3d] text-white'
            }`}
          >
            <div
              className={`w-16 h-16 mx-auto rounded-full bg-gradient-to-tr ${agent.avatarColor} flex items-center justify-center text-white shadow-lg text-2xl font-bold mb-3`}
            >
              {agent.name.charAt(0) || <Bot className="w-8 h-8" />}
            </div>
            <h2 className={`text-base font-bold mb-1 ${isLight ? 'text-slate-900' : 'text-white'}`}>
              {agent.name}
            </h2>
            <p className={`text-xs mb-4 line-clamp-2 ${isLight ? 'text-slate-500' : 'text-gray-400'}`}>
              {agent.description || 'آماده پاسخ به پرسش‌ها، تحلیل تصاویر و فایل‌ها، و جستجوی وب آنلاین'}
            </p>

            <div
              className={`grid grid-cols-2 gap-2 text-[11px] mb-5 p-2.5 rounded-xl border font-mono ${
                isLight
                  ? 'bg-slate-50 border-slate-200 text-slate-700'
                  : 'bg-[#0e1621]/60 border-[#202b36] text-gray-400'
              }`}
            >
              <div>
                <span className={`block ${isLight ? 'text-slate-400' : 'text-gray-500'}`}>پروتکل:</span>
                <span className="text-blue-500 font-semibold">{agent.provider.toUpperCase()}</span>
              </div>
              <div>
                <span className={`block ${isLight ? 'text-slate-400' : 'text-gray-500'}`}>مدل:</span>
                <span className="text-teal-600 dark:text-teal-400 font-semibold truncate block">
                  {agent.model}
                </span>
              </div>
            </div>

            <div className={`text-xs mb-2 font-medium ${isLight ? 'text-slate-600' : 'text-gray-400'}`}>
              پیشنهاد گفتگو:
            </div>
            <div className="space-y-1.5 text-right">
              {[
                '🌐 آخرین اخبار مهم و مقالات دنیای هوش مصنوعی را در وب جستجو کن',
                '💻 یک قطعه کد تایپ‌اسکریپت تمیز برای ذخیره و بارگذاری داده آماده کن',
                '✍️ یک ایمیل رسمی، محترمانه و حرفه‌ای برای درخواست همکاری بنویس',
              ].map((prompt, idx) => (
                <button
                  key={idx}
                  onClick={() => onSendPresetPrompt(prompt)}
                  className={`w-full p-2 text-xs rounded-xl border text-right transition-colors flex items-center justify-between group ${
                    isLight
                      ? 'bg-slate-100 hover:bg-slate-200 text-slate-800 border-slate-200'
                      : 'bg-[#202b36] hover:bg-[#283645] text-gray-200 border-[#2b3a4a]'
                  }`}
                >
                  <span className="truncate">{prompt}</span>
                  <Sparkles className="w-3.5 h-3.5 text-blue-500 group-hover:scale-110 transition-transform shrink-0" />
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Messages Stream */}
        {messages.map((msg) => {
          const isUser = msg.role === 'user';
          const hasWebSources = msg.webSources && msg.webSources.length > 0;
          const isSourcesExpanded = Boolean(expandedSources[msg.id]);

          // Search match properties
          const isMatched = searchQuery.trim().length > 0 && matchingMessages.some((m) => m.id === msg.id);
          const isActiveMatch = searchQuery.trim().length > 0 && activeMatchId === msg.id;

          return (
            <div
              key={msg.id}
              id={`msg-container-${msg.id}`}
              className={`flex w-full ${isUser ? 'justify-start' : 'justify-end'} group transition-all duration-300 ${
                isActiveMatch ? 'py-1' : ''
              }`}
            >
              {/* User message */}
              {isUser ? (
                <div
                  className={`max-w-[85%] sm:max-w-[75%] rounded-2xl rounded-tr-xs p-3 shadow-md relative animate-in fade-in duration-150 transition-all ${getUserBubbleClasses(
                    isActiveMatch,
                    isMatched
                  )}`}
                >
                  {/* Active Match Indicator Badge */}
                  {isActiveMatch && (
                    <div className="flex items-center gap-1 text-[10px] font-semibold text-amber-600 dark:text-amber-300 mb-1.5 pb-1 border-b border-amber-200 dark:border-amber-500/30">
                      <Search className="w-3 h-3" />
                      <span>نتیجه تطابق {currentMatchIdx + 1} از {matchingMessages.length}</span>
                    </div>
                  )}

                  {/* Image Attachments */}
                  {msg.attachments &&
                    msg.attachments.filter((a) => a.type === 'image').length > 0 && (
                      <div className="grid grid-cols-2 gap-2 mb-2">
                        {msg.attachments
                          .filter((a) => a.type === 'image')
                          .map((img) => (
                            <div
                              key={img.id}
                              onClick={() => setPreviewImage(img.base64 || img.url || null)}
                              className="relative group/img cursor-pointer overflow-hidden rounded-xl border border-black/10 bg-black/10"
                            >
                              <img
                                src={img.base64 || img.url}
                                alt={img.name}
                                referrerPolicy="no-referrer"
                                className="w-full h-36 object-cover hover:scale-105 transition-transform duration-200"
                              />
                              <div className="absolute inset-0 bg-black/30 opacity-0 group-hover/img:opacity-100 flex items-center justify-center transition-opacity">
                                <Maximize2 className="w-5 h-5 text-white" />
                              </div>
                            </div>
                          ))}
                      </div>
                    )}

                  {/* File Attachments */}
                  {msg.attachments &&
                    msg.attachments.filter((a) => a.type === 'file').length > 0 && (
                      <div className="space-y-1.5 mb-2">
                        {msg.attachments
                          .filter((a) => a.type === 'file')
                          .map((file) => (
                            <div
                              key={file.id}
                              className={`flex items-center gap-2.5 p-2 rounded-xl text-xs border ${
                                isLight
                                  ? 'bg-white/80 border-blue-200 text-slate-800'
                                  : 'bg-black/20 border-white/10 text-white'
                              }`}
                            >
                              <div className="w-8 h-8 rounded-lg bg-blue-500/20 text-blue-600 dark:text-blue-300 flex items-center justify-center shrink-0">
                                <FileText className="w-4 h-4" />
                              </div>
                              <div className="min-w-0 flex-1">
                                <p className="font-medium truncate">
                                  {highlightText(file.name, searchQuery, isLight)}
                                </p>
                                <p className={`text-[10px] ${isLight ? 'text-blue-600' : 'text-blue-200'}`}>
                                  {Math.round(file.size / 1024)} KB • سند
                                </p>
                              </div>
                            </div>
                          ))}
                      </div>
                    )}

                  {/* Message Text with Search Highlighting */}
                  <div className={`${fontClass} whitespace-pre-wrap leading-relaxed select-text font-normal`}>
                    {highlightText(msg.content, searchQuery, isLight)}
                  </div>

                  {/* Timestamp & Read Receipt */}
                  <div
                    className={`flex items-center justify-end gap-1 mt-1 text-[10px] select-none ${
                      isLight ? 'text-blue-600/75' : 'text-blue-200/80'
                    }`}
                  >
                    <span>{formatTime(msg.timestamp)}</span>
                    <CheckCheck className="w-3.5 h-3.5 text-blue-600 dark:text-cyan-300" />
                  </div>
                </div>
              ) : (
                /* Bot / Assistant Message */
                <div className="max-w-[90%] sm:max-w-[80%] flex items-start gap-2.5">
                  {/* Bot Avatar */}
                  <div
                    className={`w-8 h-8 rounded-full bg-gradient-to-tr ${agent.avatarColor} flex items-center justify-center text-white shrink-0 text-xs font-bold mt-1 shadow-xs`}
                  >
                    {agent.name.charAt(0) || <Bot className="w-4 h-4" />}
                  </div>

                  <div className="min-w-0 flex-1">
                    <div
                      className={`rounded-2xl rounded-tl-xs p-3 sm:p-3.5 shadow-md border relative transition-all ${getAssistantBubbleClasses(
                        isActiveMatch,
                        isMatched
                      )}`}
                    >
                      {/* Active Match Indicator Badge */}
                      {isActiveMatch && (
                        <div className="flex items-center gap-1 text-[10px] font-semibold text-amber-600 dark:text-amber-300 mb-2 pb-1.5 border-b border-amber-200 dark:border-amber-500/30">
                          <Search className="w-3 h-3" />
                          <span>نتیجه تطابق {currentMatchIdx + 1} از {matchingMessages.length}</span>
                        </div>
                      )}

                      {/* Bot Name and Provider Badge */}
                      <div
                        className={`flex items-center justify-between gap-2 mb-2 pb-1.5 border-b ${
                          isLight ? 'border-slate-100' : 'border-[#242f3d]'
                        }`}
                      >
                        <div className="flex items-center gap-1.5">
                          <span className="text-xs font-semibold text-[#3390ec]">{agent.name}</span>
                          <span className={`text-[10px] font-mono ${isLight ? 'text-slate-400' : 'text-gray-500'}`}>
                            ({agent.model})
                          </span>
                        </div>

                        {/* Quick Action Toolbar */}
                        <div className="flex items-center gap-1 opacity-80 hover:opacity-100">
                          <button
                            onClick={() => handleCopy(msg.id, msg.content)}
                            className={`p-1 rounded transition-colors ${
                              isLight ? 'hover:bg-slate-100 text-slate-500' : 'hover:bg-[#242f3d] text-gray-400'
                            }`}
                            title="کپی متن"
                          >
                            {copiedId === msg.id ? (
                              <Check className="w-3.5 h-3.5 text-emerald-500" />
                            ) : (
                              <Copy className="w-3.5 h-3.5" />
                            )}
                          </button>
                          <button
                            onClick={() => handleSpeak(msg.id, msg.content)}
                            className={`p-1 rounded transition-colors ${
                              isLight ? 'hover:bg-slate-100 text-slate-500' : 'hover:bg-[#242f3d] text-gray-400'
                            }`}
                            title="خوانش صوتی"
                          >
                            {speakingId === msg.id ? (
                              <VolumeX className="w-3.5 h-3.5 text-amber-500" />
                            ) : (
                              <Volume2 className="w-3.5 h-3.5" />
                            )}
                          </button>
                        </div>
                      </div>

                      {/* Web Search Sources Badge / Accordion */}
                      {hasWebSources && (
                        <div
                          className={`mb-3 p-2.5 rounded-xl border text-xs ${
                            isLight
                              ? 'bg-blue-50/70 border-blue-200'
                              : 'bg-[#0e1621] border-[#2b3a4a]'
                          }`}
                        >
                          <button
                            onClick={() => toggleSources(msg.id)}
                            className={`w-full flex items-center justify-between font-medium ${
                              isLight ? 'text-blue-700 hover:text-blue-800' : 'text-cyan-400 hover:text-cyan-300'
                            }`}
                          >
                            <span className="flex items-center gap-1.5">
                              <Globe className="w-3.5 h-3.5" />
                              <span>منابع وب ({msg.webSources?.length} منبع)</span>
                            </span>
                            {isSourcesExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                          </button>

                          {isSourcesExpanded && (
                            <div
                              className={`mt-2 space-y-2 pt-2 border-t ${
                                isLight ? 'border-blue-200/80' : 'border-[#202b36]'
                              }`}
                            >
                              {msg.webSources?.map((src, idx) => (
                                <a
                                  key={idx}
                                  href={src.url}
                                  target="_blank"
                                  rel="noreferrer noopener"
                                  className={`block p-2 rounded-lg border transition-colors group/link text-right ${
                                    isLight
                                      ? 'bg-white hover:bg-slate-50 border-slate-200'
                                      : 'bg-[#17212b] hover:bg-[#202b36] border-[#242f3d]'
                                  }`}
                                >
                                  <div className="flex items-center justify-between text-xs font-medium">
                                    <span className={`truncate ${isLight ? 'text-blue-600' : 'text-blue-300'}`}>
                                      {highlightText(src.title, searchQuery, isLight)}
                                    </span>
                                    <ExternalLink className="w-3 h-3 text-gray-400 group-hover/link:text-blue-500 shrink-0 mr-1" />
                                  </div>
                                  {src.snippet && (
                                    <p
                                      className={`text-[11px] mt-1 line-clamp-2 ${
                                        isLight ? 'text-slate-600' : 'text-gray-400'
                                      }`}
                                    >
                                      {highlightText(src.snippet, searchQuery, isLight)}
                                    </p>
                                  )}
                                </a>
                              ))}
                            </div>
                          )}
                        </div>
                      )}

                      {/* Markdown Rendered Content */}
                      <div
                        className={`markdown-body text-sm leading-relaxed select-text ${
                          isLight ? 'text-slate-800' : 'text-[#e6e6e6]'
                        }`}
                      >
                        <Markdown
                          components={{
                            code({ className, children, ...props }: any) {
                              const match = /language-(\w+)/.exec(className || '');
                              const isInline = !match && !String(children).includes('\n');
                              if (isInline) {
                                return (
                                  <code
                                    className={`px-1.5 py-0.5 rounded font-mono text-xs ${
                                      isLight
                                        ? 'bg-slate-100 text-blue-700 border border-slate-200'
                                        : 'bg-[#0e1621] text-cyan-300'
                                    }`}
                                    dir="ltr"
                                    {...props}
                                  >
                                    {children}
                                  </code>
                                );
                              }
                              return (
                                <div
                                  className="my-2.5 rounded-xl overflow-hidden border border-[#242f3d] bg-[#0e1621]"
                                  dir="ltr"
                                >
                                  <div className="flex items-center justify-between px-3 py-1.5 bg-[#17212b] border-b border-[#242f3d] text-[11px] text-gray-400">
                                    <span className="font-mono">{match ? match[1] : 'code'}</span>
                                    <button
                                      onClick={() => handleCopy(`code-${msg.id}`, String(children))}
                                      className="flex items-center gap-1 hover:text-white"
                                    >
                                      <Copy className="w-3 h-3" />
                                      <span>کپی</span>
                                    </button>
                                  </div>
                                  <pre className="p-3 overflow-x-auto text-xs font-mono text-gray-200">
                                    <code>{children}</code>
                                  </pre>
                                </div>
                              );
                            },
                            p({ children }) {
                              return (
                                <p className="mb-2 last:mb-0 leading-relaxed">
                                  {highlightChildren(children, searchQuery, isLight)}
                                </p>
                              );
                            },
                            ul({ children }) {
                              return <ul className="list-disc list-inside space-y-1 my-2 pr-1">{children}</ul>;
                            },
                            ol({ children }) {
                              return <ol className="list-decimal list-inside space-y-1 my-2 pr-1">{children}</ol>;
                            },
                            a({ href, children }) {
                              return (
                                <a
                                  href={href}
                                  target="_blank"
                                  rel="noreferrer noopener"
                                  className="text-blue-500 hover:underline inline-flex items-center gap-0.5"
                                >
                                  {children}
                                </a>
                              );
                            },
                          }}
                        >
                          {msg.content}
                        </Markdown>
                      </div>

                      {/* Timestamp */}
                      <div
                        className={`flex items-center justify-end mt-1 text-[10px] select-none ${
                          isLight ? 'text-slate-400' : 'text-gray-500'
                        }`}
                      >
                        <span>{formatTime(msg.timestamp)}</span>
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>
          );
        })}

        {/* Real-time Typing / Searching indicator */}
        {(isTyping || isSearching) && (
          <div className="flex items-start gap-2.5 animate-in fade-in duration-150">
            <div
              className={`w-8 h-8 rounded-full bg-gradient-to-tr ${agent.avatarColor} flex items-center justify-center text-white shrink-0 text-xs font-bold shadow-xs`}
            >
              {agent.name.charAt(0) || <Bot className="w-4 h-4" />}
            </div>
            <div
              className={`rounded-2xl rounded-tl-xs p-3 shadow-md border flex items-center gap-2 ${
                isLight
                  ? 'bg-white border-slate-200 text-slate-800'
                  : 'bg-[#182533] border-[#242f3d] text-white'
              }`}
            >
              {isSearching ? (
                <div className="flex items-center gap-2 text-xs text-blue-600 dark:text-cyan-400 font-medium">
                  <Globe className="w-4 h-4 animate-spin" />
                  <span>در حال جستجوی اینترنت و جمع‌آوری منابع...</span>
                </div>
              ) : (
                <div className="flex items-center gap-1.5 px-2 py-1">
                  <span className="w-2 h-2 bg-[#3390ec] rounded-full animate-bounce" />
                  <span className="w-2 h-2 bg-[#3390ec] rounded-full animate-bounce [animation-delay:0.2s]" />
                  <span className="w-2 h-2 bg-[#3390ec] rounded-full animate-bounce [animation-delay:0.4s]" />
                </div>
              )}
            </div>
          </div>
        )}

        <div ref={bottomRef} />

        {/* Image Preview Modal */}
        {previewImage && (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-xs"
            onClick={() => setPreviewImage(null)}
          >
            <div className="relative max-w-3xl max-h-[85vh]">
              <img
                src={previewImage}
                alt="بزرگنمایی تصویر"
                className="max-w-full max-h-[85vh] rounded-2xl object-contain shadow-2xl"
              />
              <button
                onClick={() => setPreviewImage(null)}
                className="absolute top-3 left-3 p-2 bg-black/60 hover:bg-black/90 text-white rounded-full transition-colors"
              >
                ✕
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
