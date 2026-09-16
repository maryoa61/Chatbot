import React, { useState, useEffect } from 'react';
import {
  X,
  Bot,
  Send,
  Sparkles,
  Palette,
  Check,
  Copy,
  ExternalLink,
  Key,
  RefreshCw,
  Trash2,
  Eye,
  EyeOff,
  MessageSquare,
  Sliders,
  ShieldCheck,
  AlertCircle,
  CheckCircle2,
  Radio,
  Sun,
  Moon,
  Type,
  Plus,
  Settings,
  Globe,
  Network,
} from 'lucide-react';
import {
  AIAgent,
  ThemeSettings,
  TelegramBotConfig,
  TelegramTheme,
  TelegramAccentColor,
  TelegramChatPattern,
  TelegramFontSize,
} from '../types';
import {
  testTelegramBotToken,
  sendTelegramMessage,
  pollTelegramUpdates,
  syncTelegramConfigToServer,
  getTelegramLogs,
  clearTelegramLogs,
  ServerKeyStatus,
} from '../services/apiService';

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  initialTab?: 'telegram' | 'theme' | 'agents';
  themeSettings: ThemeSettings;
  onUpdateThemeSettings: (settings: ThemeSettings) => void;
  telegramConfig: TelegramBotConfig;
  onUpdateTelegramConfig: (config: TelegramBotConfig) => void;
  agents: AIAgent[];
  onAddNewAgent: () => void;
  onEditAgent: (agent: AIAgent) => void;
  serverKeyStatus?: ServerKeyStatus;
}

const THEME_OPTIONS: Array<{
  id: TelegramTheme;
  title: string;
  desc: string;
  icon: string;
  bgClass: string;
  isDark: boolean;
}> = [
  {
    id: 'dark',
    title: 'شب تلگرام (Dark)',
    desc: 'تم تیره پیش‌فرض تلگرام با کنتراست متعادل و چشم‌نواز',
    icon: '🌙',
    bgClass: 'bg-[#17212b] border-[#242f3d]',
    isDark: true,
  },
  {
    id: 'light',
    title: 'کلاسیک روز (Light)',
    desc: 'تم روشن و شفاف با رنگ‌های استاندارد چت تلگرام',
    icon: '☀️',
    bgClass: 'bg-white border-slate-300',
    isDark: false,
  },
  {
    id: 'midnight',
    title: 'شب قطبی (Midnight)',
    desc: 'رنگ‌آمیزی سرمه‌ای تیره و عمیق اقیانوسی',
    icon: '🌌',
    bgClass: 'bg-[#081018] border-[#132232]',
    isDark: true,
  },
  {
    id: 'desert',
    title: 'کویر و کهربایی (Desert)',
    desc: 'رنگ‌های گرم و خاکی ملایم با حباب‌های دلنشین',
    icon: '🏜️',
    bgClass: 'bg-[#1c1917] border-[#292524]',
    isDark: true,
  },
];

const ACCENT_COLORS: Array<{
  id: TelegramAccentColor;
  name: string;
  colorHex: string;
  bgClass: string;
  ringClass: string;
}> = [
  { id: 'blue', name: 'آبی تلگرام', colorHex: '#3390ec', bgClass: 'bg-[#3390ec]', ringClass: 'ring-[#3390ec]' },
  { id: 'green', name: 'زمردی', colorHex: '#10b981', bgClass: 'bg-[#10b981]', ringClass: 'ring-[#10b981]' },
  { id: 'purple', name: 'بنفش رویال', colorHex: '#a855f7', bgClass: 'bg-[#a855f7]', ringClass: 'ring-[#a855f7]' },
  { id: 'amber', name: 'کهربایی', colorHex: '#f59e0b', bgClass: 'bg-[#f59e0b]', ringClass: 'ring-[#f59e0b]' },
  { id: 'rose', name: 'یاقوتی', colorHex: '#f43f5e', bgClass: 'bg-[#f43f5e]', ringClass: 'ring-[#f43f5e]' },
  { id: 'cyan', name: 'فیروزه‌ای', colorHex: '#06b6d4', bgClass: 'bg-[#06b6d4]', ringClass: 'ring-[#06b6d4]' },
];

export const SettingsModal: React.FC<SettingsModalProps> = ({
  isOpen,
  onClose,
  initialTab = 'telegram',
  themeSettings,
  onUpdateThemeSettings,
  telegramConfig,
  onUpdateTelegramConfig,
  agents,
  onAddNewAgent,
  onEditAgent,
  serverKeyStatus,
}) => {
  const [activeTab, setActiveTab] = useState<'telegram' | 'theme' | 'agents'>(initialTab);

  useEffect(() => {
    if (isOpen) {
      setActiveTab(initialTab);
    }
  }, [isOpen, initialTab]);

  // Telegram Bot local state
  const [botToken, setBotToken] = useState(telegramConfig.botToken || '');
  const [customApiUrl, setCustomApiUrl] = useState(telegramConfig.customApiUrl || '');
  const [showToken, setShowToken] = useState(false);
  const [isTestingBot, setIsTestingBot] = useState(false);
  const [botTestResult, setBotTestResult] = useState<{
    ok: boolean;
    message: string;
    info?: any;
  } | null>(null);

  const [selectedAgentId, setSelectedAgentId] = useState(
    telegramConfig.defaultAgentId || agents[0]?.id || 'gemini-pro'
  );
  const [autoReply, setAutoReply] = useState(telegramConfig.autoReply ?? true);

  // Test send message state
  const [testChatId, setTestChatId] = useState('');
  const [testText, setTestText] = useState('سلام! این یک پیام آزمایشی از چت‌بات تلگرام شماست.');
  const [isSendingTest, setIsSendingTest] = useState(false);
  const [sendResult, setSendResult] = useState<{ ok: boolean; message: string } | null>(null);

  // Polling state
  const [isPolling, setIsPolling] = useState(false);
  const [pollResult, setPollResult] = useState<string | null>(null);

  // Telegram Logs
  const [logs, setLogs] = useState<any[]>([]);
  const [isLoadingLogs, setIsLoadingLogs] = useState(false);

  // Webhook URL copied indicator
  const [copiedWebhook, setCopiedWebhook] = useState(false);

  useEffect(() => {
    if (isOpen && activeTab === 'telegram') {
      loadLogs();
    }
  }, [isOpen, activeTab]);

  const loadLogs = async () => {
    setIsLoadingLogs(true);
    try {
      const data = await getTelegramLogs();
      setLogs(data);
    } finally {
      setIsLoadingLogs(false);
    }
  };

  if (!isOpen) return null;

  const isLight = themeSettings.theme === 'light';

  // Test & connect bot
  const handleTestAndConnect = async () => {
    const cleanToken = botToken.trim();
    const cleanCustomApiUrl = customApiUrl.trim();
    if (!cleanToken) {
      setBotTestResult({
        ok: false,
        message: 'لطفاً توکن ربات تلگرام را وارد کنید.',
      });
      return;
    }

    setIsTestingBot(true);
    setBotTestResult(null);

    const res = await testTelegramBotToken(cleanToken, cleanCustomApiUrl);
    setIsTestingBot(false);

    if (res.ok && res.result) {
      const updatedConfig: TelegramBotConfig = {
        ...telegramConfig,
        botToken: cleanToken,
        customApiUrl: cleanCustomApiUrl,
        botInfo: res.result,
        enabled: true,
        defaultAgentId: selectedAgentId,
        autoReply,
        lastChecked: Date.now(),
      };
      onUpdateTelegramConfig(updatedConfig);
      syncTelegramConfigToServer(updatedConfig);

      setBotTestResult({
        ok: true,
        message: `اتصال برقرار شد! ربات: ${res.result.first_name} (@${res.result.username || 'بدون نام کاربری'})`,
        info: res.result,
      });
    } else {
      setBotTestResult({
        ok: false,
        message: res.error || 'ارتباط با سرور تلگرام برقرار نشد. لطفاً صحت توکن را بررسی کنید.',
      });
    }
  };

  // Disconnect bot
  const handleDisconnectBot = () => {
    const updated: TelegramBotConfig = {
      ...telegramConfig,
      botToken: '',
      customApiUrl: customApiUrl.trim(),
      botInfo: null,
      enabled: false,
    };
    setBotToken('');
    setBotTestResult(null);
    onUpdateTelegramConfig(updated);
    syncTelegramConfigToServer(updated);
  };

  // Send test message
  const handleSendTestMessage = async () => {
    const tokenToUse = botToken.trim() || telegramConfig.botToken;
    const apiUrlToUse = customApiUrl.trim() || telegramConfig.customApiUrl;
    if (!tokenToUse) {
      setSendResult({ ok: false, message: 'ابتدا توکن ربات را وارد و ذخیره کنید.' });
      return;
    }
    if (!testChatId.trim()) {
      setSendResult({ ok: false, message: 'شناسه چت (Chat ID) را وارد کنید.' });
      return;
    }

    setIsSendingTest(true);
    setSendResult(null);

    const res = await sendTelegramMessage(tokenToUse, testChatId.trim(), testText, apiUrlToUse);
    setIsSendingTest(false);

    if (res.ok) {
      setSendResult({ ok: true, message: 'پیام با موفقیت به تلگرام ارسال شد!' });
      loadLogs();
    } else {
      setSendResult({
        ok: false,
        message: res.error || 'ارسال پیام با خطا مواجه شد. مطمئن شوید کاربر قبلاً به ربات شما /start زده است.',
      });
    }
  };

  // Long poll updates
  const handlePollUpdates = async () => {
    const tokenToUse = botToken.trim() || telegramConfig.botToken;
    const apiUrlToUse = customApiUrl.trim() || telegramConfig.customApiUrl;
    if (!tokenToUse) {
      setPollResult('ابتدا توکن ربات را وارد کنید.');
      return;
    }

    setIsPolling(true);
    setPollResult(null);

    const res = await pollTelegramUpdates(tokenToUse, autoReply, undefined, apiUrlToUse);
    setIsPolling(false);

    if (res.ok) {
      setPollResult(
        `بررسی انجام شد: ${res.newMessagesCount || 0} پیام جدید دریافت و پاسخ داده شد.`
      );
      loadLogs();
    } else {
      setPollResult(`خطا در بررسی: ${res.error}`);
    }
  };

  const handleClearLogs = async () => {
    await clearTelegramLogs();
    setLogs([]);
  };

  const currentOrigin = typeof window !== 'undefined' ? window.location.origin : '';
  const webhookUrl = `${currentOrigin}/api/telegram/webhook`;

  const handleCopyWebhook = () => {
    navigator.clipboard.writeText(webhookUrl);
    setCopiedWebhook(true);
    setTimeout(() => setCopiedWebhook(false), 2000);
  };

  return (
    <div
      id="telegram-settings-modal-backdrop"
      className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/70 backdrop-blur-xs transition-opacity duration-200 select-none"
      dir="rtl"
      onClick={onClose}
    >
      <div
        id="telegram-settings-modal-dialog"
        className={`w-full max-w-2xl max-h-[92vh] flex flex-col rounded-2xl shadow-2xl border transition-all overflow-hidden ${
          isLight ? 'bg-white border-slate-300 text-slate-900' : 'bg-[#17212b] border-[#242f3d] text-white'
        }`}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Modal Top Header */}
        <div
          className={`px-5 py-4 border-b flex items-center justify-between shrink-0 ${
            isLight ? 'bg-slate-50 border-slate-200' : 'bg-[#17212b] border-[#242f3d]'
          }`}
        >
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-full bg-[#3390ec] flex items-center justify-center text-white shadow-xs">
              <Settings className="w-4 h-4" />
            </div>
            <div>
              <h2 className="text-base font-bold">تنظیمات تلگرام و سیستم هوش مصنوعی</h2>
              <p className={`text-xs ${isLight ? 'text-slate-500' : 'text-gray-400'}`}>
                مدیریت اتصال به ربات تلگرام، شخصی‌سازی تم و عامل‌های هوش مصنوعی
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            className={`p-1.5 rounded-xl transition-colors ${
              isLight ? 'hover:bg-slate-200 text-slate-500' : 'hover:bg-[#242f3d] text-gray-400 hover:text-white'
            }`}
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Tab Navigation Navigation */}
        <div
          className={`flex items-center border-b px-5 pt-2 gap-2 shrink-0 ${
            isLight ? 'bg-slate-100/70 border-slate-200' : 'bg-[#121922] border-[#202b37]'
          }`}
        >
          <button
            id="settings-tab-telegram"
            onClick={() => setActiveTab('telegram')}
            className={`flex items-center gap-2 px-4 py-2.5 text-xs font-semibold rounded-t-xl transition-all border-b-2 ${
              activeTab === 'telegram'
                ? 'border-[#3390ec] text-[#3390ec] bg-white/10'
                : isLight
                ? 'border-transparent text-slate-600 hover:text-slate-900'
                : 'border-transparent text-gray-400 hover:text-gray-200'
            }`}
          >
            <Bot className="w-4 h-4" />
            <span>ربات تلگرام (Bot Integration)</span>
            {telegramConfig.botInfo && (
              <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
            )}
          </button>

          <button
            id="settings-tab-theme"
            onClick={() => setActiveTab('theme')}
            className={`flex items-center gap-2 px-4 py-2.5 text-xs font-semibold rounded-t-xl transition-all border-b-2 ${
              activeTab === 'theme'
                ? 'border-[#3390ec] text-[#3390ec] bg-white/10'
                : isLight
                ? 'border-transparent text-slate-600 hover:text-slate-900'
                : 'border-transparent text-gray-400 hover:text-gray-200'
            }`}
          >
            <Palette className="w-4 h-4" />
            <span>ظاهر و تم تلگرام (Themes)</span>
          </button>

          <button
            id="settings-tab-agents"
            onClick={() => setActiveTab('agents')}
            className={`flex items-center gap-2 px-4 py-2.5 text-xs font-semibold rounded-t-xl transition-all border-b-2 ${
              activeTab === 'agents'
                ? 'border-[#3390ec] text-[#3390ec] bg-white/10'
                : isLight
                ? 'border-transparent text-slate-600 hover:text-slate-900'
                : 'border-transparent text-gray-400 hover:text-gray-200'
            }`}
          >
            <Sliders className="w-4 h-4" />
            <span>عامل‌های هوش مصنوعی ({agents.length})</span>
          </button>
        </div>

        {/* Modal Scrollable Body */}
        <div className="flex-1 overflow-y-auto p-5 space-y-6">
          {/* ================= TAB 1: TELEGRAM BOT INTEGRATION ================= */}
          {activeTab === 'telegram' && (
            <div className="space-y-6">
              {/* Bot Connection Card */}
              {telegramConfig.botInfo ? (
                <div
                  className={`p-4 rounded-2xl border flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 ${
                    isLight
                      ? 'bg-emerald-50/80 border-emerald-200 text-emerald-950'
                      : 'bg-emerald-950/30 border-emerald-800/50 text-emerald-100'
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <div className="w-12 h-12 rounded-full bg-emerald-600 text-white flex items-center justify-center font-bold text-lg shadow-sm">
                      {telegramConfig.botInfo.first_name?.charAt(0) || 'B'}
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <h3 className="font-bold text-sm">{telegramConfig.botInfo.first_name}</h3>
                        <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-500 text-white font-medium">
                          متصل و آنلاین
                        </span>
                      </div>
                      <p className="text-xs opacity-80 font-mono mt-0.5">
                        @{telegramConfig.botInfo.username || 'بدون نام کاربری'} • شناسه: {telegramConfig.botInfo.id}
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 self-end sm:self-center">
                    {telegramConfig.botInfo.username && (
                      <a
                        href={`https://t.me/${telegramConfig.botInfo.username}`}
                        target="_blank"
                        rel="noreferrer"
                        className="flex items-center gap-1.5 px-3 py-1.5 bg-[#3390ec] hover:bg-[#2881d8] text-white rounded-xl text-xs font-medium transition-colors shadow-xs"
                      >
                        <Send className="w-3.5 h-3.5" />
                        <span>باز کردن در تلگرام</span>
                        <ExternalLink className="w-3 h-3" />
                      </a>
                    )}
                    <button
                      onClick={handleDisconnectBot}
                      className="px-3 py-1.5 rounded-xl text-xs font-medium bg-rose-500/10 hover:bg-rose-500/20 text-rose-500 border border-rose-500/30 transition-colors"
                    >
                      قطع اتصال
                    </button>
                  </div>
                </div>
              ) : (
                <div
                  className={`p-4 rounded-2xl border ${
                    isLight ? 'bg-blue-50/70 border-blue-200 text-blue-950' : 'bg-[#202c3a]/70 border-[#2c3d50] text-blue-100'
                  }`}
                >
                  <div className="flex items-start gap-3">
                    <div className="w-8 h-8 rounded-full bg-[#3390ec] text-white flex items-center justify-center shrink-0 mt-0.5">
                      <Bot className="w-4 h-4" />
                    </div>
                    <div className="text-xs space-y-1.5">
                      <h3 className="font-bold text-sm">چگونه ربات تلگرام بسازیم و به این چت‌بات متصل کنیم؟</h3>
                      <ol className="list-decimal list-inside space-y-1 opacity-90 leading-relaxed">
                        <li>
                          در تلگرام به آیدی{' '}
                          <a
                            href="https://t.me/BotFather"
                            target="_blank"
                            rel="noreferrer"
                            className="font-semibold underline text-[#3390ec] inline-flex items-center gap-0.5"
                          >
                            @BotFather
                            <ExternalLink className="w-2.5 h-2.5" />
                          </a>{' '}
                          مراجعه کنید.
                        </li>
                        <li>دستور <code>/newbot</code> را بفرستید و یک نام و نام کاربری برای ربات خود انتخاب کنید.</li>
                        <li>توکن ارائه‌شده (مانند <code>123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11</code>) را کپی و در کادر زیر قرار دهید.</li>
                      </ol>
                    </div>
                  </div>
                </div>
              )}

              {/* Bot Token Input Form */}
              <div className="space-y-2">
                <label className="text-xs font-bold flex items-center justify-between">
                  <span className="flex items-center gap-1.5">
                    <Key className="w-3.5 h-3.5 text-[#3390ec]" />
                    <span>توکن ربات تلگرام (Telegram Bot Token):</span>
                  </span>
                  <span className={`text-[11px] font-normal ${isLight ? 'text-slate-500' : 'text-gray-400'}`}>
                    دریافتی از BotFather
                  </span>
                </label>

                <div className="relative">
                  <input
                    type={showToken ? 'text' : 'password'}
                    value={botToken}
                    onChange={(e) => setBotToken(e.target.value)}
                    placeholder="123456789:ABCdefGhIJKlmNoPQRsTUVwxyZ..."
                    className={`w-full pl-10 pr-3.5 py-2.5 rounded-xl text-xs font-mono outline-none transition-all ${
                      isLight
                        ? 'bg-slate-50 border border-slate-300 focus:border-[#3390ec] text-slate-900'
                        : 'bg-[#0e1621] border border-[#242f3d] focus:border-[#5288c1] text-white'
                    }`}
                  />
                  <button
                    type="button"
                    onClick={() => setShowToken(!showToken)}
                    className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-200"
                  >
                    {showToken ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>

                {/* Telegram Bot Custom Proxy / Worker URL Input */}
                <div className="space-y-1.5 pt-2">
                  <label className="text-xs font-bold flex items-center justify-between">
                    <span className="flex items-center gap-1.5">
                      <Globe className="w-3.5 h-3.5 text-sky-400" />
                      <span>آدرس پراکسی / ورکر کلودفلر (Custom Proxy / Cloudflare Worker URL):</span>
                    </span>
                    <span className={`text-[11px] font-normal ${isLight ? 'text-slate-500' : 'text-gray-400'}`}>
                      اختیاری (جهت عبور از تحریم و فیلترینگ)
                    </span>
                  </label>
                  <div className="relative">
                    <input
                      type="text"
                      value={customApiUrl}
                      onChange={(e) => setCustomApiUrl(e.target.value)}
                      placeholder="https://telegram-proxy.your-subdomain.workers.dev"
                      className={`w-full pl-3.5 pr-3.5 py-2.5 rounded-xl text-xs font-mono outline-none transition-all ${
                        isLight
                          ? 'bg-slate-50 border border-slate-300 focus:border-[#3390ec] text-slate-900'
                          : 'bg-[#0e1621] border border-[#242f3d] focus:border-[#5288c1] text-white'
                      }`}
                    />
                  </div>
                  <p className={`text-[11px] leading-relaxed ${isLight ? 'text-slate-500' : 'text-gray-400'}`}>
                    در صورت خالی بودن، به طور پیش‌فرض از سرور رسمی <code className="px-1 py-0.5 rounded bg-black/10 dark:bg-white/10 text-[10px]">https://api.telegram.org</code> استفاده خواهد شد.
                  </p>
                </div>

                <div className="flex items-center justify-between pt-1">
                  <button
                    id="test-telegram-bot-btn"
                    onClick={handleTestAndConnect}
                    disabled={isTestingBot}
                    className="flex items-center gap-2 px-4 py-2 bg-[#3390ec] hover:bg-[#2881d8] disabled:opacity-50 text-white rounded-xl text-xs font-medium shadow-xs transition-colors"
                  >
                    {isTestingBot ? (
                      <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <CheckCircle2 className="w-3.5 h-3.5" />
                    )}
                    <span>{isTestingBot ? 'در حال تست اتصال به تلگرام...' : 'تست و برقراری اتصال به تلگرام'}</span>
                  </button>

                  <div className="flex items-center gap-1 text-[11px] text-emerald-500">
                    <ShieldCheck className="w-3.5 h-3.5" />
                    <span>پشتیبانی از پروتکل رسمی Bot API</span>
                  </div>
                </div>

                {botTestResult && (
                  <div
                    className={`p-3 rounded-xl text-xs flex items-start gap-2 ${
                      botTestResult.ok
                        ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/30'
                        : 'bg-rose-500/10 text-rose-400 border border-rose-500/30'
                    }`}
                  >
                    {botTestResult.ok ? (
                      <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-500 mt-0.5" />
                    ) : (
                      <AlertCircle className="w-4 h-4 shrink-0 text-rose-500 mt-0.5" />
                    )}
                    <span>{botTestResult.message}</span>
                  </div>
                )}
              </div>

              {/* Automation and Agent Selection */}
              <div
                className={`p-4 rounded-2xl border space-y-4 ${
                  isLight ? 'bg-slate-50 border-slate-200' : 'bg-[#121922] border-[#202b37]'
                }`}
              >
                <div className="flex items-center justify-between">
                  <div>
                    <h4 className="text-xs font-bold flex items-center gap-1.5">
                      <Sparkles className="w-3.5 h-3.5 text-amber-500" />
                      <span>پاسخگویی خودکار هوش مصنوعی در تلگرام</span>
                    </h4>
                    <p className={`text-[11px] ${isLight ? 'text-slate-500' : 'text-gray-400'}`}>
                      هنگامی که کاربران به ربات شما در تلگرام پیام می‌دهند، هوش مصنوعی بلافاصله به آن‌ها پاسخ دهد.
                    </p>
                  </div>

                  <input
                    type="checkbox"
                    checked={autoReply}
                    onChange={(e) => {
                      setAutoReply(e.target.checked);
                      const updated = { ...telegramConfig, autoReply: e.target.checked };
                      onUpdateTelegramConfig(updated);
                      syncTelegramConfigToServer(updated);
                    }}
                    className="w-4 h-4 rounded text-[#3390ec] accent-[#3390ec] cursor-pointer"
                  />
                </div>

                {/* Default Agent for Telegram */}
                <div className="space-y-1.5 pt-2 border-t border-dashed border-gray-700/30">
                  <label className="text-xs font-semibold block">
                    عامل هوش مصنوعی پاسخ‌دهنده به کاربران تلگرام:
                  </label>
                  <select
                    value={selectedAgentId}
                    onChange={(e) => {
                      setSelectedAgentId(e.target.value);
                      const updated = { ...telegramConfig, defaultAgentId: e.target.value };
                      onUpdateTelegramConfig(updated);
                      syncTelegramConfigToServer(updated);
                    }}
                    className={`w-full px-3 py-2 rounded-xl text-xs outline-none ${
                      isLight
                        ? 'bg-white border border-slate-300 text-slate-800'
                        : 'bg-[#0e1621] border border-[#242f3d] text-white'
                    }`}
                  >
                    {agents.map((ag) => (
                      <option key={ag.id} value={ag.id}>
                        {ag.name} ({ag.model}) • {ag.provider.toUpperCase()}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Webhook and Polling Section */}
              <div
                className={`p-4 rounded-2xl border space-y-3 ${
                  isLight ? 'bg-slate-50 border-slate-200' : 'bg-[#121922] border-[#202b37]'
                }`}
              >
                <div className="flex items-center justify-between">
                  <div>
                    <h4 className="text-xs font-bold flex items-center gap-1.5">
                      <Radio className="w-3.5 h-3.5 text-cyan-500" />
                      <span>دریافت پیام‌ها (Webhook یا Long Polling)</span>
                    </h4>
                    <p className={`text-[11px] ${isLight ? 'text-slate-500' : 'text-gray-400'}`}>
                      پیام‌ها از طریق وبهوک یا بررسی مستقیم دریافت و با هوش مصنوعی پاسخ داده می‌شوند.
                    </p>
                  </div>

                  <button
                    onClick={handlePollUpdates}
                    disabled={isPolling}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-medium bg-[#3390ec]/20 hover:bg-[#3390ec]/30 text-[#3390ec] transition-colors"
                  >
                    <RefreshCw className={`w-3.5 h-3.5 ${isPolling ? 'animate-spin' : ''}`} />
                    <span>{isPolling ? 'در حال خواندن پیام‌ها...' : 'بررسی پیام‌های جدید'}</span>
                  </button>
                </div>

                {pollResult && (
                  <p className="text-xs px-3 py-1.5 rounded-lg bg-[#3390ec]/10 text-cyan-400">
                    {pollResult}
                  </p>
                )}

                <div className="space-y-1">
                  <span className={`text-[11px] ${isLight ? 'text-slate-500' : 'text-gray-400'}`}>
                    آدرس وب‌هوک (Webhook URL برای تنظیم مستقیم روی ربات تلگرام):
                  </span>
                  <div className="flex items-center gap-2">
                    <input
                      readOnly
                      value={webhookUrl}
                      className={`flex-1 px-3 py-1.5 rounded-xl text-xs font-mono outline-none ${
                        isLight ? 'bg-white border border-slate-300' : 'bg-[#0e1621] border border-[#242f3d]'
                      }`}
                    />
                    <button
                      onClick={handleCopyWebhook}
                      className="px-3 py-1.5 rounded-xl text-xs font-medium bg-[#3390ec] hover:bg-[#2881d8] text-white flex items-center gap-1"
                    >
                      {copiedWebhook ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                      <span>{copiedWebhook ? 'کپی شد' : 'کپی'}</span>
                    </button>
                  </div>
                </div>
              </div>

              {/* Send Test Message to Chat ID */}
              <div
                className={`p-4 rounded-2xl border space-y-3 ${
                  isLight ? 'bg-slate-50 border-slate-200' : 'bg-[#121922] border-[#202b37]'
                }`}
              >
                <h4 className="text-xs font-bold flex items-center gap-1.5">
                  <Send className="w-3.5 h-3.5 text-emerald-500" />
                  <span>ارسال پیام تستی به تلگرام</span>
                </h4>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                  <div className="sm:col-span-1">
                    <input
                      type="text"
                      value={testChatId}
                      onChange={(e) => setTestChatId(e.target.value)}
                      placeholder="شناسه چت عددی (Chat ID)..."
                      className={`w-full px-3 py-2 rounded-xl text-xs outline-none ${
                        isLight
                          ? 'bg-white border border-slate-300 text-slate-800'
                          : 'bg-[#0e1621] border border-[#242f3d] text-white'
                      }`}
                    />
                  </div>
                  <div className="sm:col-span-2 flex items-center gap-2">
                    <input
                      type="text"
                      value={testText}
                      onChange={(e) => setTestText(e.target.value)}
                      placeholder="متن پیام تستی..."
                      className={`flex-1 px-3 py-2 rounded-xl text-xs outline-none ${
                        isLight
                          ? 'bg-white border border-slate-300 text-slate-800'
                          : 'bg-[#0e1621] border border-[#242f3d] text-white'
                      }`}
                    />
                    <button
                      onClick={handleSendTestMessage}
                      disabled={isSendingTest}
                      className="px-3.5 py-2 rounded-xl text-xs font-medium bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white flex items-center gap-1.5 shrink-0 transition-colors shadow-xs"
                    >
                      {isSendingTest ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
                      <span>ارسال</span>
                    </button>
                  </div>
                </div>

                {sendResult && (
                  <div
                    className={`p-2.5 rounded-xl text-xs flex items-center gap-2 ${
                      sendResult.ok ? 'bg-emerald-500/10 text-emerald-400' : 'bg-rose-500/10 text-rose-400'
                    }`}
                  >
                    {sendResult.ok ? <CheckCircle2 className="w-3.5 h-3.5" /> : <AlertCircle className="w-3.5 h-3.5" />}
                    <span>{sendResult.message}</span>
                  </div>
                )}
              </div>

              {/* Recent Messages & Interaction Logs */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold flex items-center gap-1.5">
                    <MessageSquare className="w-3.5 h-3.5 text-[#3390ec]" />
                    <span>لاگ آخرین پیام‌های دریافتی از تلگرام ({logs.length})</span>
                  </span>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={loadLogs}
                      className={`text-[11px] hover:underline flex items-center gap-1 ${
                        isLight ? 'text-slate-600' : 'text-gray-400'
                      }`}
                    >
                      <RefreshCw className={`w-3 h-3 ${isLoadingLogs ? 'animate-spin' : ''}`} />
                      <span>بروزرسانی</span>
                    </button>
                    {logs.length > 0 && (
                      <button
                        onClick={handleClearLogs}
                        className="text-[11px] text-rose-400 hover:underline flex items-center gap-0.5"
                      >
                        <Trash2 className="w-3 h-3" />
                        <span>پاک کردن</span>
                      </button>
                    )}
                  </div>
                </div>

                <div
                  className={`max-h-40 overflow-y-auto rounded-xl border p-2 space-y-2 text-xs font-mono ${
                    isLight ? 'bg-slate-50 border-slate-200' : 'bg-[#0e1621] border-[#242f3d]'
                  }`}
                >
                  {logs.length === 0 ? (
                    <div className="text-center py-5 text-gray-500 text-[11px]">
                      هنوز پیامی از تلگرام دریافت نشده است.
                    </div>
                  ) : (
                    logs.map((item, idx) => (
                      <div
                        key={item.id || idx}
                        className={`p-2 rounded-lg border space-y-1 ${
                          isLight ? 'bg-white border-slate-200' : 'bg-[#17212b] border-[#202b37]'
                        }`}
                      >
                        <div className="flex items-center justify-between text-[10px] text-gray-400">
                          <span className="font-semibold text-[#3390ec]">{item.from}</span>
                          <span>{new Date(item.timestamp).toLocaleTimeString('fa-IR')}</span>
                        </div>
                        <p className="text-xs font-sans text-right">{item.text}</p>
                        {item.reply && (
                          <div className="text-[11px] text-emerald-400 border-r-2 border-emerald-500 pr-2 pt-0.5 mt-1 font-sans">
                            پاسخ AI: {item.reply}
                          </div>
                        )}
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>
          )}

          {/* ================= TAB 2: THEMES & APPEARANCE ================= */}
          {activeTab === 'theme' && (
            <div className="space-y-6">
              {/* Theme Presets Selection */}
              <div className="space-y-3">
                <label className="text-xs font-bold block">انتخاب تم سراسری تلگرام (Theme Preset):</label>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {THEME_OPTIONS.map((th) => {
                    const isSelected = themeSettings.theme === th.id;
                    return (
                      <button
                        key={th.id}
                        onClick={() => {
                          const updated = { ...themeSettings, theme: th.id };
                          onUpdateThemeSettings(updated);
                        }}
                        className={`p-3.5 rounded-2xl border text-right transition-all flex items-start gap-3 relative overflow-hidden ${
                          isSelected
                            ? 'border-[#3390ec] ring-2 ring-[#3390ec]/30 shadow-md'
                            : isLight
                            ? 'border-slate-200 hover:border-slate-300 bg-slate-50'
                            : 'border-[#242f3d] hover:border-[#334255] bg-[#121922]'
                        }`}
                      >
                        <div className="text-2xl mt-0.5">{th.icon}</div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center justify-between">
                            <span className="text-xs font-bold">{th.title}</span>
                            {isSelected && (
                              <div className="w-5 h-5 rounded-full bg-[#3390ec] text-white flex items-center justify-center">
                                <Check className="w-3 h-3" />
                              </div>
                            )}
                          </div>
                          <p className={`text-[11px] mt-1 ${isLight ? 'text-slate-500' : 'text-gray-400'}`}>
                            {th.desc}
                          </p>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Accent Colors */}
              <div className="space-y-3">
                <label className="text-xs font-bold block">رنگ برجسته دکمه‌ها و حباب پیام‌ها (Accent Color):</label>
                <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
                  {ACCENT_COLORS.map((ac) => {
                    const isSelected = themeSettings.accentColor === ac.id;
                    return (
                      <button
                        key={ac.id}
                        onClick={() => {
                          const updated = { ...themeSettings, accentColor: ac.id };
                          onUpdateThemeSettings(updated);
                        }}
                        className={`p-2.5 rounded-xl border flex flex-col items-center gap-1.5 transition-all ${
                          isSelected
                            ? `border-white ring-2 ${ac.ringClass} shadow-md`
                            : isLight
                            ? 'border-slate-200 bg-slate-50 hover:bg-slate-100'
                            : 'border-[#242f3d] bg-[#121922] hover:bg-[#1a2330]'
                        }`}
                      >
                        <div
                          className={`w-6 h-6 rounded-full ${ac.bgClass} flex items-center justify-center text-white shadow-xs`}
                        >
                          {isSelected && <Check className="w-3.5 h-3.5" />}
                        </div>
                        <span className="text-[11px] font-medium">{ac.name}</span>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Chat Pattern Background */}
              <div className="space-y-3">
                <label className="text-xs font-bold block">الگوی پس‌زمینه گفتگوها (Chat Background Pattern):</label>
                <div className="grid grid-cols-3 gap-2">
                  {[
                    { id: 'doodle' as TelegramChatPattern, name: 'الگوی تلگرام (Doodle)', desc: 'طرح نقاشی اختصاصی چت تلگرام' },
                    { id: 'gradient' as TelegramChatPattern, name: 'گرادیانت نرم', desc: 'طیف رنگی ملایم و مدرن' },
                    { id: 'none' as TelegramChatPattern, name: 'ساده مینیمال', desc: 'تک‌رنگ خالص و خلوت' },
                  ].map((pat) => {
                    const isSelected = themeSettings.chatPattern === pat.id;
                    return (
                      <button
                        key={pat.id}
                        onClick={() => {
                          const updated = { ...themeSettings, chatPattern: pat.id };
                          onUpdateThemeSettings(updated);
                        }}
                        className={`p-3 rounded-xl border text-right transition-all ${
                          isSelected
                            ? 'border-[#3390ec] ring-2 ring-[#3390ec]/30 shadow-md bg-[#3390ec]/10'
                            : isLight
                            ? 'border-slate-200 bg-slate-50 hover:bg-slate-100'
                            : 'border-[#242f3d] bg-[#121922] hover:bg-[#1a2330]'
                        }`}
                      >
                        <div className="flex items-center justify-between">
                          <span className="text-xs font-bold">{pat.name}</span>
                          {isSelected && <Check className="w-3.5 h-3.5 text-[#3390ec]" />}
                        </div>
                        <p className={`text-[10px] mt-1 ${isLight ? 'text-slate-500' : 'text-gray-400'}`}>
                          {pat.desc}
                        </p>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Font Size Selection */}
              <div className="space-y-3">
                <label className="text-xs font-bold block flex items-center gap-1.5">
                  <Type className="w-3.5 h-3.5 text-[#3390ec]" />
                  <span>اندازه قلم متن پیام‌ها (Message Font Size):</span>
                </label>
                <div className="flex items-center gap-2">
                  {[
                    { id: 'small' as TelegramFontSize, label: 'کوچک (14px)' },
                    { id: 'medium' as TelegramFontSize, label: 'استاندارد (15px)' },
                    { id: 'large' as TelegramFontSize, label: 'بزرگ (16px)' },
                  ].map((sz) => {
                    const isSelected = themeSettings.fontSize === sz.id;
                    return (
                      <button
                        key={sz.id}
                        onClick={() => {
                          const updated = { ...themeSettings, fontSize: sz.id };
                          onUpdateThemeSettings(updated);
                        }}
                        className={`flex-1 py-2 rounded-xl text-xs font-medium border transition-all ${
                          isSelected
                            ? 'bg-[#3390ec] text-white border-[#3390ec] shadow-xs'
                            : isLight
                            ? 'bg-slate-50 border-slate-200 text-slate-700 hover:bg-slate-100'
                            : 'bg-[#121922] border-[#242f3d] text-gray-300 hover:bg-[#1a2330]'
                        }`}
                      >
                        {sz.label}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Live Preview Card */}
              <div className="space-y-2 pt-2 border-t border-gray-700/30">
                <span className="text-xs font-bold block">پیش‌نمایش زنده چت تلگرام:</span>
                <div
                  className={`p-4 rounded-2xl border space-y-3 overflow-hidden ${
                    themeSettings.theme === 'light'
                      ? 'bg-[#f0f2f5] border-slate-200'
                      : themeSettings.theme === 'midnight'
                      ? 'bg-[#0b141d] border-[#162738]'
                      : themeSettings.theme === 'desert'
                      ? 'bg-[#1e1914] border-[#31271f]'
                      : 'bg-[#0e1621] border-[#242f3d]'
                  }`}
                >
                  {/* Incoming AI message preview */}
                  <div className="flex items-start gap-2 max-w-[85%]">
                    <div className="w-7 h-7 rounded-full bg-[#3390ec] text-white flex items-center justify-center text-xs font-bold shrink-0 shadow-xs">
                      AI
                    </div>
                    <div
                      className={`p-2.5 rounded-2xl rounded-tr-xs text-xs shadow-xs ${
                        themeSettings.theme === 'light'
                          ? 'bg-white text-slate-800 border border-slate-200'
                          : themeSettings.theme === 'midnight'
                          ? 'bg-[#121e2a] text-white border border-[#1e3042]'
                          : themeSettings.theme === 'desert'
                          ? 'bg-[#29221b] text-white border border-[#3e342a]'
                          : 'bg-[#182533] text-white border border-[#202e3e]'
                      }`}
                    >
                      <p>سلام! من آماده گفتگو هستم. تنظیمات ظاهر و تم تلگرام شما فوراً اعمال شد.</p>
                      <span className="text-[9px] text-gray-400 block text-left mt-1">12:30</span>
                    </div>
                  </div>

                  {/* Outgoing user message preview */}
                  <div className="flex items-end justify-start max-w-[85%] mr-auto">
                    <div
                      className={`p-2.5 rounded-2xl rounded-tl-xs text-xs text-white shadow-xs ${
                        themeSettings.accentColor === 'green'
                          ? 'bg-[#10b981]'
                          : themeSettings.accentColor === 'purple'
                          ? 'bg-[#a855f7]'
                          : themeSettings.accentColor === 'amber'
                          ? 'bg-[#f59e0b]'
                          : themeSettings.accentColor === 'rose'
                          ? 'bg-[#f43f5e]'
                          : themeSettings.accentColor === 'cyan'
                          ? 'bg-[#06b6d4]'
                          : 'bg-[#3390ec]'
                      }`}
                    >
                      <p>عالیه! رنگ و الگوی پس‌زمینه دقیقاً مثل تلگرام واقعی شد.</p>
                      <span className="text-[9px] text-white/80 block text-left mt-1">12:31 ✓✓</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* ================= TAB 3: AI AGENTS LIST & CONFIG ================= */}
          {activeTab === 'agents' && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-xs font-bold">عامل‌های هوش مصنوعی فعال</h3>
                  <p className={`text-[11px] ${isLight ? 'text-slate-500' : 'text-gray-400'}`}>
                    می‌توانید مدل‌ها، پرامپت‌ها و کلیدهای API هر عامل را ویرایش کنید.
                  </p>
                </div>
                <button
                  onClick={() => {
                    onClose();
                    onAddNewAgent();
                  }}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-[#3390ec] hover:bg-[#2881d8] text-white rounded-xl text-xs font-medium shadow-xs transition-colors"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>افزودن عامل جدید</span>
                </button>
              </div>

              {/* Server Key Status Banner */}
              <div
                className={`p-3 rounded-xl border flex items-center justify-between text-xs ${
                  isLight ? 'bg-slate-50 border-slate-200' : 'bg-[#121922] border-[#202b37]'
                }`}
              >
                <div className="flex items-center gap-2">
                  <ShieldCheck className="w-4 h-4 text-emerald-500" />
                  <span>وضعیت کلیدهای محیطی سرور:</span>
                </div>
                <div className="flex flex-wrap items-center gap-1.5 justify-end">
                  <span
                    className={`text-[10px] px-2 py-0.5 rounded-full font-mono font-medium ${
                      serverKeyStatus?.hasGeminiKey
                        ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                        : 'bg-gray-500/20 text-gray-400'
                    }`}
                  >
                    Gemini: {serverKeyStatus?.hasGeminiKey ? 'فعال' : 'ندارد'}
                  </span>
                  <span
                    className={`text-[10px] px-2 py-0.5 rounded-full font-mono font-medium ${
                      serverKeyStatus?.hasAnthropicKey
                        ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                        : 'bg-gray-500/20 text-gray-400'
                    }`}
                  >
                    Claude: {serverKeyStatus?.hasAnthropicKey ? 'فعال' : 'ندارد'}
                  </span>
                  <span
                    className={`text-[10px] px-2 py-0.5 rounded-full font-mono font-medium ${
                      serverKeyStatus?.hasOpenAIKey
                        ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                        : 'bg-gray-500/20 text-gray-400'
                    }`}
                  >
                    OpenAI: {serverKeyStatus?.hasOpenAIKey ? 'فعال' : 'ندارد'}
                  </span>
                  <span
                    className={`text-[10px] px-2 py-0.5 rounded-full font-mono font-medium ${
                      serverKeyStatus?.hasDeepSeekKey
                        ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                        : 'bg-gray-500/20 text-gray-400'
                    }`}
                  >
                    DeepSeek: {serverKeyStatus?.hasDeepSeekKey ? 'فعال' : 'ندارد'}
                  </span>
                  <span
                    className={`text-[10px] px-2 py-0.5 rounded-full font-mono font-medium ${
                      serverKeyStatus?.hasGroqKey
                        ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                        : 'bg-gray-500/20 text-gray-400'
                    }`}
                  >
                    Groq: {serverKeyStatus?.hasGroqKey ? 'فعال' : 'ندارد'}
                  </span>
                  <span
                    className={`text-[10px] px-2 py-0.5 rounded-full font-mono font-medium ${
                      serverKeyStatus?.hasOpenRouterKey
                        ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                        : 'bg-gray-500/20 text-gray-400'
                    }`}
                  >
                    OpenRouter: {serverKeyStatus?.hasOpenRouterKey ? 'فعال' : 'ندارد'}
                  </span>
                  <span
                    className={`text-[10px] px-2 py-0.5 rounded-full font-mono font-medium ${
                      serverKeyStatus?.hasXAIKey
                        ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                        : 'bg-gray-500/20 text-gray-400'
                    }`}
                  >
                    xAI: {serverKeyStatus?.hasXAIKey ? 'فعال' : 'ندارد'}
                  </span>
                  <span
                    className={`text-[10px] px-2 py-0.5 rounded-full font-mono font-medium ${
                      serverKeyStatus?.hasMistralKey
                        ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                        : 'bg-gray-500/20 text-gray-400'
                    }`}
                  >
                    Mistral: {serverKeyStatus?.hasMistralKey ? 'فعال' : 'ندارد'}
                  </span>
                </div>
              </div>

              {/* Agents List */}
              <div className="space-y-2">
                {agents.map((agent) => (
                  <div
                    key={agent.id}
                    className={`p-3 rounded-xl border flex items-center justify-between transition-all ${
                      isLight ? 'bg-white border-slate-200 hover:border-slate-300' : 'bg-[#121922] border-[#202b37] hover:border-[#2b3a4a]'
                    }`}
                  >
                    <div className="flex items-center gap-3">
                      <div
                        className={`w-9 h-9 rounded-full bg-gradient-to-tr ${agent.avatarColor} text-white flex items-center justify-center font-bold text-xs shadow-xs`}
                      >
                        {agent.name.charAt(0)}
                      </div>
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-bold">{agent.name}</span>
                          <span className="text-[10px] px-1.5 py-0.5 bg-[#3390ec]/20 text-[#3390ec] rounded font-mono">
                            {agent.model}
                          </span>
                        </div>
                        <p className={`text-[11px] truncate max-w-xs ${isLight ? 'text-slate-500' : 'text-gray-400'}`}>
                          {agent.description || agent.baseUrl}
                        </p>
                      </div>
                    </div>

                    <button
                      onClick={() => {
                        onClose();
                        onEditAgent(agent);
                      }}
                      className="px-3 py-1.5 rounded-xl text-xs font-medium bg-[#3390ec]/10 hover:bg-[#3390ec]/20 text-[#3390ec] transition-colors"
                    >
                      ویرایش و تنظیم کلید
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Modal Footer */}
        <div
          className={`px-5 py-3 border-t flex items-center justify-between shrink-0 ${
            isLight ? 'bg-slate-50 border-slate-200' : 'bg-[#17212b] border-[#242f3d]'
          }`}
        >
          <div className="text-[11px] text-emerald-500 flex items-center gap-1">
            <ShieldCheck className="w-3.5 h-3.5" />
            <span>تنظیمات به صورت خودکار در مرورگر شما ذخیره می‌شوند</span>
          </div>

          <button
            onClick={onClose}
            className="px-5 py-2 bg-[#3390ec] hover:bg-[#2881d8] text-white rounded-xl text-xs font-semibold shadow-xs transition-colors"
          >
            بستن و ذخیره
          </button>
        </div>
      </div>
    </div>
  );
};
