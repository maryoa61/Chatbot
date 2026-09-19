/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, {
  useState,
  useEffect,
  useMemo,
  useCallback,
  lazy,
  Suspense,
} from 'react';
import { AIAgent, Attachment, ChatMessage, TelegramBotConfig, ThemeSettings } from './types';
import { PRESET_AGENTS } from './data/presetAgents';
import {
  loadSavedAgents,
  saveAgentsToStorage,
  loadSavedChats,
  saveChatsToStorage,
  loadActiveAgentId,
  saveActiveAgentId,
  sendChatMessage,
  loadSavedTheme,
  saveThemeToStorage,
  getServerKeyStatus,
  ServerKeyStatus,
  loadSavedTelegramConfig,
  saveTelegramConfigToStorage,
  loadSavedThemeSettings,
  saveThemeSettingsToStorage,
  updateTelegramConfig,
} from './services/apiService';
import { Sidebar } from './components/Sidebar';
import { ChatHeader } from './components/ChatHeader';
import { ChatMessages } from './components/ChatMessages';
import { ChatInput } from './components/ChatInput';
import { Menu } from 'lucide-react';

/* ============================================================
   Lazy-loaded heavy modals (only downloaded on first open)
   ============================================================ */
// ✅ اصلاح: حذف (m as any) تا TypeScript نوع پراپ‌ها را بشناسد
const AgentModal = lazy(() =>
  import('./components/AgentModal').then((m) => ({
    default: m.AgentModal,
  }))
);
const AgentInfoDrawer = lazy(() =>
  import('./components/AgentInfoDrawer').then((m) => ({
    default: m.AgentInfoDrawer,
  }))
);
const SettingsModal = lazy(() =>
  import('./components/SettingsModal').then((m) => ({
    default: m.SettingsModal,
  }))
);

type SettingsTab = 'telegram' | 'theme' | 'agents';

export default function App() {
  // ============================================================
  // Theme
  // ============================================================
  const [themeSettings, setThemeSettings] = useState<ThemeSettings>(() =>
    loadSavedThemeSettings()
  );
  const theme = themeSettings.theme === 'light' ? 'light' : 'dark';

  useEffect(() => {
    document.documentElement.classList.remove('light', 'dark', 'midnight', 'desert');
    document.documentElement.classList.add(themeSettings.theme);
    if (themeSettings.theme === 'light') {
      document.documentElement.classList.add('light');
      document.documentElement.classList.remove('dark');
    } else {
      document.documentElement.classList.add('dark');
      document.documentElement.classList.remove('light');
    }
    saveThemeSettingsToStorage(themeSettings);
    saveThemeToStorage(themeSettings.theme === 'light' ? 'light' : 'dark');
  }, [themeSettings]);

  const toggleTheme = useCallback(() => {
    setThemeSettings((prev) => ({
      ...prev,
      theme: prev.theme === 'light' ? 'dark' : 'light',
    }));
  }, []);

  const handleUpdateThemeSettings = useCallback((newSettings: ThemeSettings) => {
    setThemeSettings(newSettings);
  }, []);

  // ============================================================
  // Telegram Bot Configuration
  // ============================================================
  const [telegramConfig, setTelegramConfig] = useState<TelegramBotConfig>(() =>
    loadSavedTelegramConfig()
  );

  const handleUpdateTelegramConfig = useCallback(async (newConfig: TelegramBotConfig) => {
    setTelegramConfig(newConfig);
    saveTelegramConfigToStorage(newConfig);
    try {
      await updateTelegramConfig(newConfig);
    } catch (err) {
      console.error('Failed to sync telegram config to server:', err);
    }
  }, []);

  // ============================================================
  // Server Key Status
  // ============================================================
  const [serverKeyStatus, setServerKeyStatus] = useState<ServerKeyStatus>({
    hasGeminiKey: false,
    hasOpenAIKey: false,
    hasAnthropicKey: false,
  });

  useEffect(() => {
    getServerKeyStatus().then(setServerKeyStatus);
  }, []);

  // ============================================================
  // Agents & Chats
  // ============================================================
  const [agents, setAgents] = useState<AIAgent[]>(() => loadSavedAgents(PRESET_AGENTS));
  const [activeAgentId, setActiveAgentId] = useState<string>(() =>
    loadActiveAgentId(PRESET_AGENTS[0]?.id || 'gemini-pro')
  );
  const [chats, setChats] = useState<Record<string, ChatMessage[]>>(() => loadSavedChats());

  // ============================================================
  // UI States
  // ============================================================
  const [isTyping, setIsTyping] = useState(false);
  const [isSearching, setIsSearching] = useState(false);
  const [webSearchEnabled, setWebSearchEnabled] = useState(false);
  const [isChatSearchOpen, setIsChatSearchOpen] = useState(true);

  // AgentModal
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [agentToEdit, setAgentToEdit] = useState<AIAgent | null>(null);
  /**
   * Tracks whether AgentModal was opened FROM Settings.
   * If true, closing AgentModal re-opens Settings on the "agents" tab.
   */
  const [agentModalFromSettings, setAgentModalFromSettings] = useState(false);

  // Drawer & Mobile sidebar
  const [isInfoDrawerOpen, setIsInfoDrawerOpen] = useState(false);
  const [isMobileSidebarOpen, setIsMobileSidebarOpen] = useState(false);

  // SettingsModal
  const [isSettingsModalOpen, setIsSettingsModalOpen] = useState(false);
  const [settingsModalTab, setSettingsModalTab] = useState<SettingsTab>('telegram');

  // ============================================================
  // Derived values (memoized)
  // ============================================================
  const activeAgent = useMemo(
    () => agents.find((a) => a.id === activeAgentId) || agents[0],
    [agents, activeAgentId]
  );

  const activeMessages = useMemo(
    () => (activeAgent ? chats[activeAgent.id] || [] : []),
    [activeAgent, chats]
  );

  const isAgentReady = useCallback(
    (agent?: AIAgent | null) => {
      if (!agent) return false;
      if (agent.apiKey && agent.apiKey.trim().length > 0) return true;
      if (
        agent.baseUrl &&
        (agent.baseUrl.includes('localhost') ||
          agent.baseUrl.includes('127.0.0.1') ||
          agent.baseUrl.includes(':11434'))
      ) {
        return true;
      }
      if (agent.provider === 'gemini' && serverKeyStatus.hasGeminiKey) return true;
      if (
        agent.provider === 'openai' &&
        serverKeyStatus.hasOpenAIKey &&
        agent.baseUrl.includes('openai.com')
      )
        return true;
      if (agent.provider === 'anthropic' && serverKeyStatus.hasAnthropicKey) return true;
      return false;
    },
    [serverKeyStatus]
  );

  // ============================================================
  // Persist effects
  // ============================================================
  useEffect(() => {
    saveAgentsToStorage(agents);
  }, [agents]);

  useEffect(() => {
    saveActiveAgentId(activeAgentId);
  }, [activeAgentId]);

  // ============================================================
  // Modal openers
  // ============================================================
  const openSettingsModal = useCallback((tab: SettingsTab = 'telegram') => {
    setSettingsModalTab(tab);
    setIsSettingsModalOpen(true);
  }, []);

  /** Open AgentModal from the main UI (NOT settings) */
  const openAgentModalFromMain = useCallback((agent: AIAgent | null) => {
    setAgentModalFromSettings(false);
    setAgentToEdit(agent);
    setIsModalOpen(true);
  }, []);

  /** Open AgentModal from Settings — remember to go back on close */
  const openAgentModalFromSettings = useCallback((agent: AIAgent | null) => {
    setAgentModalFromSettings(true);
    setIsSettingsModalOpen(false);
    setAgentToEdit(agent);
    setIsModalOpen(true);
  }, []);

  /** Unified close handler for AgentModal */
  const closeAgentModal = useCallback(() => {
    setIsModalOpen(false);
    setAgentToEdit(null);
    if (agentModalFromSettings) {
      setAgentModalFromSettings(false);
      setSettingsModalTab('agents');
      setIsSettingsModalOpen(true);
    }
  }, [agentModalFromSettings]);

  // ============================================================
  // Chat
  // ============================================================
  const handleSendMessage = useCallback(
    async (text: string, attachments: Attachment[] = []) => {
      if (!activeAgent) return;

      if (!isAgentReady(activeAgent)) {
        openAgentModalFromMain(activeAgent);
        return;
      }

      const userMessage: ChatMessage = {
        id: `msg-${Date.now()}-user`,
        role: 'user',
        content: text,
        timestamp: Date.now(),
        agentId: activeAgent.id,
        attachments,
        status: 'sent',
      };

      const updatedWithUser = [...activeMessages, userMessage];
      const newChats = { ...chats, [activeAgent.id]: updatedWithUser };
      setChats(newChats);
      saveChatsToStorage(newChats);

      setIsTyping(true);
      if (webSearchEnabled) setIsSearching(true);

      try {
        const result = await sendChatMessage({
          agent: activeAgent,
          messages: updatedWithUser,
          newUserMessage: text,
          attachments,
          enableWebSearch: webSearchEnabled,
        });

        const assistantMessage: ChatMessage = {
          id: `msg-${Date.now()}-ai`,
          role: 'assistant',
          content: result.reply,
          timestamp: Date.now(),
          agentId: activeAgent.id,
          webSources: result.webSources,
          status: 'sent',
        };

        const finalMessages = [...updatedWithUser, assistantMessage];
        const finalChats = { ...chats, [activeAgent.id]: finalMessages };
        setChats(finalChats);
        saveChatsToStorage(finalChats);
      } catch (err: any) {
        console.error('Chat error:', err);
        const errorMessage: ChatMessage = {
          id: `msg-${Date.now()}-err`,
          role: 'assistant',
          content: `⚠️ **خطا در دریافت پاسخ:**\n${
            err.message || 'ارتباط با API یا سرور با خطا مواجه شد.'
          }\n\nلطفاً کلید API و آدرس Base URL را بررسی فرمایید.`,
          timestamp: Date.now(),
          agentId: activeAgent.id,
          error: err.message,
        };

        const finalMessages = [...updatedWithUser, errorMessage];
        const finalChats = { ...chats, [activeAgent.id]: finalMessages };
        setChats(finalChats);
        saveChatsToStorage(finalChats);
      } finally {
        setIsTyping(false);
        setIsSearching(false);
      }
    },
    [
      activeAgent,
      activeMessages,
      chats,
      webSearchEnabled,
      isAgentReady,
      openAgentModalFromMain,
    ]
  );

  // ============================================================
  // Agent CRUD
  // ============================================================
  const handleSaveAgent = useCallback((savedAgent: AIAgent) => {
    setAgents((prev) => {
      const exists = prev.some((a) => a.id === savedAgent.id);
      if (exists) {
        return prev.map((a) => (a.id === savedAgent.id ? savedAgent : a));
      }
      return [savedAgent, ...prev];
    });
    setActiveAgentId(savedAgent.id);
  }, []);

  const handleDeleteAgent = useCallback(
    (agentId: string) => {
      if (!confirm('آیا از حذف این عامل هوش مصنوعی اطمینان دارید؟')) return;
      setAgents((prev) => prev.filter((a) => a.id !== agentId));
      if (activeAgentId === agentId) {
        const remaining = agents.filter((a) => a.id !== agentId);
        if (remaining.length > 0) setActiveAgentId(remaining[0].id);
      }
    },
    [activeAgentId, agents]
  );

  const handleClearChat = useCallback(() => {
    if (!activeAgent) return;
    if (confirm(`آیا تاریخچه پیام‌های گفتگو با "${activeAgent.name}" پاک شود؟`)) {
      const updated = { ...chats, [activeAgent.id]: [] };
      setChats(updated);
      saveChatsToStorage(updated);
    }
  }, [activeAgent, chats]);

  // ============================================================
  // Render
  // ============================================================
  return (
    <div
      id="telegram-app-root"
      className={`flex h-screen w-screen overflow-hidden font-sans transition-colors ${
        theme === 'light' ? 'bg-[#eef2f5] text-slate-900' : 'bg-[#0e1621] text-[#f5f5f5]'
      }`}
      dir="rtl"
    >
      {/* Mobile menu toggle */}
      <div className="md:hidden fixed top-3 left-3 z-30">
        <button
          onClick={() => setIsMobileSidebarOpen(!isMobileSidebarOpen)}
          className={`p-2 rounded-xl shadow-lg border transition-colors ${
            theme === 'light'
              ? 'bg-white text-slate-800 border-slate-300'
              : 'bg-[#242f3d] text-white border-[#2e3c4d]'
          }`}
          title="منوی گفتگوها"
        >
          <Menu className="w-5 h-5" />
        </button>
      </div>

      <Sidebar
        agents={agents}
        activeAgentId={activeAgentId}
        onSelectAgent={setActiveAgentId}
        onAddNewAgent={() => openAgentModalFromMain(null)}
        onEditAgent={(agent) => openAgentModalFromMain(agent)}
        onDeleteAgent={handleDeleteAgent}
        chats={chats}
        isOpenMobile={isMobileSidebarOpen}
        onCloseMobile={() => setIsMobileSidebarOpen(false)}
        theme={theme}
        onToggleTheme={toggleTheme}
        serverKeyStatus={serverKeyStatus}
        onOpenSettingsModal={openSettingsModal}
        telegramConfig={telegramConfig}
        themeSettings={themeSettings}
      />

      <main className="flex-1 flex flex-col h-full overflow-hidden relative">
        {activeAgent ? (
          <>
            <ChatHeader
              agent={activeAgent}
              isSearching={isSearching}
              isTyping={isTyping}
              webSearchEnabled={webSearchEnabled}
              onToggleWebSearch={() => setWebSearchEnabled(!webSearchEnabled)}
              onOpenSettings={() => openAgentModalFromMain(activeAgent)}
              onToggleInfo={() => setIsInfoDrawerOpen(!isInfoDrawerOpen)}
              onClearChat={handleClearChat}
              theme={theme}
              onToggleTheme={toggleTheme}
              isSearchOpen={isChatSearchOpen}
              onToggleSearch={() => setIsChatSearchOpen((prev) => !prev)}
              onOpenSettingsModal={openSettingsModal}
              telegramConfig={telegramConfig}
            />

            <ChatMessages
              messages={activeMessages}
              agent={activeAgent}
              isTyping={isTyping}
              isSearching={isSearching}
              onSendPresetPrompt={(prompt) => handleSendMessage(prompt)}
              onOpenSettings={() => openAgentModalFromMain(activeAgent)}
              theme={theme}
              themeSettings={themeSettings}
              isSearchOpen={isChatSearchOpen}
              onToggleSearch={() => setIsChatSearchOpen((prev) => !prev)}
              onCloseSearch={() => setIsChatSearchOpen(false)}
              isAgentReady={isAgentReady(activeAgent)}
            />

            <ChatInput
              onSendMessage={handleSendMessage}
              disabled={isTyping || isSearching}
              webSearchEnabled={webSearchEnabled}
              onToggleWebSearch={() => setWebSearchEnabled(!webSearchEnabled)}
              theme={theme}
            />
          </>
        ) : (
          <div className="flex-1 flex items-center justify-center text-gray-400">
            عاملی انتخاب نشده است.
          </div>
        )}
      </main>

      <Suspense fallback={null}>
        {/* Agent Info Drawer */}
        {activeAgent && isInfoDrawerOpen && (
          <AgentInfoDrawer
            agent={activeAgent}
            isOpen={isInfoDrawerOpen}
            onClose={() => setIsInfoDrawerOpen(false)}
            onEditAgent={() => openAgentModalFromMain(activeAgent)}
            onClearHistory={handleClearChat}
            theme={theme}
          />
        )}

        {/* Agent Modal (add / edit) */}
        {isModalOpen && (
          <AgentModal
            isOpen={isModalOpen}
            onClose={closeAgentModal}
            onSave={handleSaveAgent}
            agentToEdit={agentToEdit}
            theme={theme}
            serverKeyStatus={serverKeyStatus}
          />
        )}

        {/* Settings Modal */}
        {isSettingsModalOpen && (
          <SettingsModal
            isOpen={isSettingsModalOpen}
            onClose={() => setIsSettingsModalOpen(false)}
            initialTab={settingsModalTab}
            agents={agents}
            onEditAgent={(agent: AIAgent) => openAgentModalFromSettings(agent)}
            onAddNewAgent={() => openAgentModalFromSettings(null)}
            themeSettings={themeSettings}
            onUpdateThemeSettings={handleUpdateThemeSettings}
            telegramConfig={telegramConfig}
            onUpdateTelegramConfig={handleUpdateTelegramConfig}
            serverKeyStatus={serverKeyStatus}
          />
        )}
      </Suspense>
    </div>
  );
}
