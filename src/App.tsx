/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from 'react';
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
import { AgentModal } from './components/AgentModal';
import { AgentInfoDrawer } from './components/AgentInfoDrawer';
import { SettingsModal } from './components/SettingsModal';
import { Menu } from 'lucide-react';

export default function App() {
  // 1. State for Theme Settings (Dark, Light, Midnight, Desert, Accents, Wallpaper, Font Size)
  const [themeSettings, setThemeSettings] = useState<ThemeSettings>(() => loadSavedThemeSettings());
  const theme = themeSettings.theme === 'light' ? 'light' : 'dark';

  useEffect(() => {
    // Remove previous theme classes
    document.documentElement.classList.remove('light', 'dark', 'midnight', 'desert');

    // Add active theme class
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

  const toggleTheme = () => {
    setThemeSettings((prev) => ({
      ...prev,
      theme: prev.theme === 'light' ? 'dark' : 'light',
    }));
  };

  const handleUpdateThemeSettings = (newSettings: ThemeSettings) => {
    setThemeSettings(newSettings);
  };

  // 2. Telegram Bot Configuration State
  const [telegramConfig, setTelegramConfig] = useState<TelegramBotConfig>(() => loadSavedTelegramConfig());

  const handleUpdateTelegramConfig = async (newConfig: TelegramBotConfig) => {
    setTelegramConfig(newConfig);
    saveTelegramConfigToStorage(newConfig);
    try {
      await updateTelegramConfig(newConfig);
    } catch (err) {
      console.error('Failed to sync telegram config to server:', err);
    }
  };

  // 3. Settings Modal State (Telegram, Theme, Agents)
  const [isSettingsModalOpen, setIsSettingsModalOpen] = useState(false);
  const [settingsModalTab, setSettingsModalTab] = useState<'telegram' | 'theme' | 'agents'>('telegram');

  const openSettingsModal = (tab: 'telegram' | 'theme' | 'agents' = 'telegram') => {
    setSettingsModalTab(tab);
    setIsSettingsModalOpen(true);
  };

  // 4. Server Key Status (Runtime Environment)
  const [serverKeyStatus, setServerKeyStatus] = useState<ServerKeyStatus>({
    hasGeminiKey: false,
    hasOpenAIKey: false,
    hasAnthropicKey: false,
  });

  useEffect(() => {
    getServerKeyStatus().then(setServerKeyStatus);
  }, []);

  // 3. State for Agents
  const [agents, setAgents] = useState<AIAgent[]>(() => loadSavedAgents(PRESET_AGENTS));
  const [activeAgentId, setActiveAgentId] = useState<string>(() =>
    loadActiveAgentId(PRESET_AGENTS[0]?.id || 'gemini-pro')
  );

  // 4. State for Chats (Real User & AI Messages only)
  const [chats, setChats] = useState<Record<string, ChatMessage[]>>(() => loadSavedChats());

  // 5. UI states
  const [isTyping, setIsTyping] = useState(false);
  const [isSearching, setIsSearching] = useState(false);
  const [webSearchEnabled, setWebSearchEnabled] = useState(false);
  const [isChatSearchOpen, setIsChatSearchOpen] = useState(true);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [agentToEdit, setAgentToEdit] = useState<AIAgent | null>(null);
  const [isInfoDrawerOpen, setIsInfoDrawerOpen] = useState(false);
  const [isMobileSidebarOpen, setIsMobileSidebarOpen] = useState(false);

  // Active agent reference
  const activeAgent = agents.find((a) => a.id === activeAgentId) || agents[0];

  // Check if agent is ready to call (has user key, server environment key, or local endpoint)
  const isAgentReady = (agent?: AIAgent | null) => {
    if (!agent) return false;
    if (agent.apiKey && agent.apiKey.trim().length > 0) return true;
    if (
      agent.baseUrl &&
      (agent.baseUrl.includes('localhost') || agent.baseUrl.includes('127.0.0.1') || agent.baseUrl.includes(':11434'))
    ) {
      return true;
    }
    if (agent.provider === 'gemini' && serverKeyStatus.hasGeminiKey) return true;
    if (agent.provider === 'openai' && serverKeyStatus.hasOpenAIKey && agent.baseUrl.includes('openai.com')) return true;
    if (agent.provider === 'anthropic' && serverKeyStatus.hasAnthropicKey) return true;
    return false;
  };

  // Active chat messages
  const activeMessages = activeAgent ? chats[activeAgent.id] || [] : [];

  // Persist agents when changed
  useEffect(() => {
    saveAgentsToStorage(agents);
  }, [agents]);

  // Persist activeAgentId
  useEffect(() => {
    saveActiveAgentId(activeAgentId);
  }, [activeAgentId]);

  // Send message handler
  const handleSendMessage = async (text: string, attachments: Attachment[] = []) => {
    if (!activeAgent) return;

    // Verify if API Key / Endpoint is ready
    if (!isAgentReady(activeAgent)) {
      setAgentToEdit(activeAgent);
      setIsModalOpen(true);
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
    if (webSearchEnabled) {
      setIsSearching(true);
    }

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
        content: `⚠️ **خطا در دریافت پاسخ:**\n${err.message || 'ارتباط با API یا سرور با خطا مواجه شد.'}\n\nلطفاً کلید API و آدرس Base URL را بررسی فرمایید.`,
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
  };

  // Save or update an agent
  const handleSaveAgent = (savedAgent: AIAgent) => {
    setAgents((prev) => {
      const exists = prev.some((a) => a.id === savedAgent.id);
      if (exists) {
        return prev.map((a) => (a.id === savedAgent.id ? savedAgent : a));
      }
      return [savedAgent, ...prev];
    });
    setActiveAgentId(savedAgent.id);
  };

  // Delete an agent
  const handleDeleteAgent = (agentId: string) => {
    if (confirm('آیا از حذف این عامل هوش مصنوعی اطمینان دارید؟')) {
      setAgents((prev) => prev.filter((a) => a.id !== agentId));
      if (activeAgentId === agentId) {
        const remaining = agents.filter((a) => a.id !== agentId);
        if (remaining.length > 0) {
          setActiveAgentId(remaining[0].id);
        }
      }
    }
  };

  // Clear chat history for active agent
  const handleClearChat = () => {
    if (!activeAgent) return;
    if (confirm(`آیا تاریخچه پیام‌های گفتگو با "${activeAgent.name}" پاک شود؟`)) {
      const updated = { ...chats, [activeAgent.id]: [] };
      setChats(updated);
      saveChatsToStorage(updated);
    }
  };

  return (
    <div
      id="telegram-app-root"
      className={`flex h-screen w-screen overflow-hidden font-sans transition-colors ${
        theme === 'light' ? 'bg-[#eef2f5] text-slate-900' : 'bg-[#0e1621] text-[#f5f5f5]'
      }`}
      dir="rtl"
    >
      {/* Mobile Top Header Toggle (visible on small screens) */}
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

      {/* Telegram Sidebar (Chat & Agent List) */}
      <Sidebar
        agents={agents}
        activeAgentId={activeAgentId}
        onSelectAgent={(id) => setActiveAgentId(id)}
        onAddNewAgent={() => {
          setAgentToEdit(null);
          setIsModalOpen(true);
        }}
        onEditAgent={(agent) => {
          setAgentToEdit(agent);
          setIsModalOpen(true);
        }}
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

      {/* Main Telegram Chat Window */}
      <main className="flex-1 flex flex-col h-full overflow-hidden relative">
        {activeAgent ? (
          <>
            {/* Telegram Header */}
            <ChatHeader
              agent={activeAgent}
              isSearching={isSearching}
              isTyping={isTyping}
              webSearchEnabled={webSearchEnabled}
              onToggleWebSearch={() => setWebSearchEnabled(!webSearchEnabled)}
              onOpenSettings={() => {
                setAgentToEdit(activeAgent);
                setIsModalOpen(true);
              }}
              onToggleInfo={() => setIsInfoDrawerOpen(!isInfoDrawerOpen)}
              onClearChat={handleClearChat}
              theme={theme}
              onToggleTheme={toggleTheme}
              isSearchOpen={isChatSearchOpen}
              onToggleSearch={() => setIsChatSearchOpen((prev) => !prev)}
              onOpenSettingsModal={openSettingsModal}
              telegramConfig={telegramConfig}
            />

            {/* Chat Messages Stream */}
            <ChatMessages
              messages={activeMessages}
              agent={activeAgent}
              isTyping={isTyping}
              isSearching={isSearching}
              onSendPresetPrompt={(prompt) => handleSendMessage(prompt)}
              onOpenSettings={() => {
                setAgentToEdit(activeAgent);
                setIsModalOpen(true);
              }}
              theme={theme}
              themeSettings={themeSettings}
              isSearchOpen={isChatSearchOpen}
              onToggleSearch={() => setIsChatSearchOpen((prev) => !prev)}
              onCloseSearch={() => setIsChatSearchOpen(false)}
              isAgentReady={isAgentReady(activeAgent)}
            />

            {/* Bottom Message Composer */}
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

      {/* Agent Info Drawer (Telegram Right Sidebar) */}
      {activeAgent && (
        <AgentInfoDrawer
          agent={activeAgent}
          isOpen={isInfoDrawerOpen}
          onClose={() => setIsInfoDrawerOpen(false)}
          onEditAgent={() => {
            setAgentToEdit(activeAgent);
            setIsModalOpen(true);
          }}
          onClearHistory={handleClearChat}
          theme={theme}
        />
      )}

      {/* Modal to Register / Edit Agent */}
      <AgentModal
        isOpen={isModalOpen}
        onClose={() => {
          setIsModalOpen(false);
          setAgentToEdit(null);
        }}
        onSave={handleSaveAgent}
        agentToEdit={agentToEdit}
        theme={theme}
        serverKeyStatus={serverKeyStatus}
      />

      {/* General Settings Modal (Telegram Bot, Themes & Customization, AI Agents) */}
      <SettingsModal
        isOpen={isSettingsModalOpen}
        onClose={() => setIsSettingsModalOpen(false)}
        initialTab={settingsModalTab}
        agents={agents}
        onEditAgent={(agent) => {
          setIsSettingsModalOpen(false);
          setAgentToEdit(agent);
          setIsModalOpen(true);
        }}
        onAddNewAgent={() => {
          setIsSettingsModalOpen(false);
          setAgentToEdit(null);
          setIsModalOpen(true);
        }}
        themeSettings={themeSettings}
        onUpdateThemeSettings={handleUpdateThemeSettings}
        telegramConfig={telegramConfig}
        onUpdateTelegramConfig={handleUpdateTelegramConfig}
        serverKeyStatus={serverKeyStatus}
      />
    </div>
  );
}
