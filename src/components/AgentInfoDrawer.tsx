import React, { useState } from 'react';
import { AIAgent } from '../types';
import {
  X,
  Bot,
  Globe,
  Key,
  Terminal,
  Copy,
  Check,
  Settings,
  Trash2,
  FileText,
  ShieldCheck,
  AlertTriangle,
} from 'lucide-react';

interface AgentInfoDrawerProps {
  agent: AIAgent;
  isOpen: boolean;
  onClose: () => void;
  onEditAgent: () => void;
  onClearHistory: () => void;
  theme?: 'dark' | 'light';
}

export const AgentInfoDrawer: React.FC<AgentInfoDrawerProps> = ({
  agent,
  isOpen,
  onClose,
  onEditAgent,
  onClearHistory,
  theme = 'dark',
}) => {
  const isLight = theme === 'light';
  const [copiedKey, setCopiedKey] = useState(false);
  const [copiedUrl, setCopiedUrl] = useState(false);

  if (!isOpen) return null;

  const handleCopyUrl = () => {
    navigator.clipboard.writeText(agent.baseUrl);
    setCopiedUrl(true);
    setTimeout(() => setCopiedUrl(false), 2000);
  };

  const hasKey = Boolean(agent.apiKey && agent.apiKey.trim().length > 0);

  return (
    <div
      id="agent-info-drawer-backdrop"
      className="fixed inset-0 z-40 bg-black/50 backdrop-blur-xs flex justify-start md:static md:bg-transparent"
      dir="rtl"
    >
      <div
        id="agent-info-drawer"
        className={`w-80 md:w-80 h-full border-r flex flex-col shadow-2xl transition-colors ${
          isLight
            ? 'bg-white border-slate-200 text-slate-800'
            : 'bg-[#17212b] border-[#242f3d] text-white'
        }`}
      >
        {/* Header */}
        <div
          className={`p-4 border-b flex items-center justify-between ${
            isLight ? 'border-slate-200 text-slate-900 bg-slate-50' : 'border-[#242f3d] text-white bg-[#1b2734]'
          }`}
        >
          <h2 className="text-sm font-semibold">پروفایل و مشخصات عامل</h2>
          <button
            onClick={onClose}
            className={`p-1.5 rounded-lg transition-colors ${
              isLight
                ? 'text-slate-500 hover:text-slate-800 hover:bg-slate-200'
                : 'text-gray-400 hover:text-white hover:bg-[#242f3d]'
            }`}
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Profile Card */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4 text-xs">
          {/* Avatar & Main Info */}
          <div className={`text-center py-3 border-b ${isLight ? 'border-slate-200' : 'border-[#242f3d]'}`}>
            <div
              className={`w-20 h-20 mx-auto rounded-full bg-gradient-to-tr ${agent.avatarColor} flex items-center justify-center text-white text-3xl font-bold shadow-lg mb-2`}
            >
              {agent.name.charAt(0) || <Bot className="w-10 h-10" />}
            </div>
            <h3 className={`text-base font-bold mb-0.5 ${isLight ? 'text-slate-900' : 'text-white'}`}>
              {agent.name}
            </h3>
            <span className="text-xs text-emerald-600 dark:text-emerald-400 font-medium">
              آنلاین • ربات هوش مصنوعی
            </span>
          </div>

          {/* Key & Security Status */}
          <div
            className={`p-3 rounded-2xl border space-y-2 ${
              isLight ? 'bg-slate-50 border-slate-200' : 'bg-[#0e1621] border-[#242f3d]'
            }`}
          >
            <div className="flex items-center justify-between">
              <span className={`flex items-center gap-1 ${isLight ? 'text-slate-600' : 'text-gray-400'}`}>
                <Key className="w-3.5 h-3.5 text-emerald-500" />
                وضعیت API Key:
              </span>
              {hasKey ? (
                <span className="text-emerald-600 dark:text-emerald-400 font-medium flex items-center gap-1">
                  <ShieldCheck className="w-3 h-3" />
                  تنظیم شده
                </span>
              ) : (
                <span className="text-amber-600 dark:text-amber-400 font-medium flex items-center gap-1">
                  <AlertTriangle className="w-3 h-3" />
                  تنظیم نشده
                </span>
              )}
            </div>

            <button
              onClick={onEditAgent}
              className="w-full py-1.5 bg-[#3390ec] hover:bg-[#2881d8] text-white rounded-xl text-xs font-medium transition-colors flex items-center justify-center gap-1.5 shadow-2xs"
            >
              <Settings className="w-3.5 h-3.5" />
              <span>{hasKey ? 'ویرایش یا تغییر کلید' : 'افزودن API Key'}</span>
            </button>
          </div>

          {/* Base URL */}
          <div className="space-y-1">
            <span className={`flex items-center gap-1 text-[11px] ${isLight ? 'text-slate-600' : 'text-gray-400'}`}>
              <Globe className="w-3.5 h-3.5 text-blue-500" />
              آدرس سرور پایه (Base URL):
            </span>
            <div
              className={`flex items-center justify-between p-2 rounded-xl border ${
                isLight ? 'bg-slate-50 border-slate-200' : 'bg-[#0e1621] border-[#242f3d]'
              }`}
            >
              <span className={`font-mono text-[11px] truncate ${isLight ? 'text-slate-700' : 'text-gray-300'}`} dir="ltr">
                {agent.baseUrl}
              </span>
              <button
                onClick={handleCopyUrl}
                className={`p-1 transition-colors ${
                  isLight ? 'text-slate-400 hover:text-slate-700' : 'text-gray-400 hover:text-white'
                }`}
                title="کپی آدرس"
              >
                {copiedUrl ? <Check className="w-3.5 h-3.5 text-emerald-500" /> : <Copy className="w-3.5 h-3.5" />}
              </button>
            </div>
          </div>

          {/* Model Name */}
          <div className="space-y-1">
            <span className={`flex items-center gap-1 text-[11px] ${isLight ? 'text-slate-600' : 'text-gray-400'}`}>
              <Terminal className="w-3.5 h-3.5 text-purple-500" />
              شناسه مدل (Model):
            </span>
            <div
              className={`p-2 rounded-xl border font-mono text-[11px] ${
                isLight
                  ? 'bg-slate-50 border-slate-200 text-purple-700'
                  : 'bg-[#0e1621] border-[#242f3d] text-purple-300'
              }`}
              dir="ltr"
            >
              {agent.model}
            </div>
          </div>

          {/* System Prompt */}
          {agent.systemPrompt && (
            <div className="space-y-1">
              <span className={`flex items-center gap-1 text-[11px] ${isLight ? 'text-slate-600' : 'text-gray-400'}`}>
                <FileText className="w-3.5 h-3.5 text-gray-400" />
                پرامپت سیستمی:
              </span>
              <div
                className={`p-2.5 rounded-xl border text-[11px] max-h-24 overflow-y-auto leading-relaxed ${
                  isLight
                    ? 'bg-slate-50 border-slate-200 text-slate-700'
                    : 'bg-[#0e1621] border-[#242f3d] text-gray-300'
                }`}
              >
                {agent.systemPrompt}
              </div>
            </div>
          )}

          {/* Parameters */}
          <div className="grid grid-cols-2 gap-2 text-[11px]">
            <div className={`p-2 rounded-xl border ${isLight ? 'bg-slate-50 border-slate-200' : 'bg-[#0e1621] border-[#242f3d]'}`}>
              <span className={`block mb-0.5 ${isLight ? 'text-slate-500' : 'text-gray-400'}`}>خلاقیت:</span>
              <span className="text-blue-500 font-mono font-medium">{agent.temperature}</span>
            </div>
            <div className={`p-2 rounded-xl border ${isLight ? 'bg-slate-50 border-slate-200' : 'bg-[#0e1621] border-[#242f3d]'}`}>
              <span className={`block mb-0.5 ${isLight ? 'text-slate-500' : 'text-gray-400'}`}>پروتکل:</span>
              <span className="text-teal-600 dark:text-teal-400 font-mono uppercase font-medium">
                {agent.provider}
              </span>
            </div>
          </div>

          {/* Actions */}
          <div className={`pt-2 border-t space-y-2 ${isLight ? 'border-slate-200' : 'border-[#242f3d]'}`}>
            <button
              onClick={onEditAgent}
              className={`w-full py-2 rounded-xl transition-colors flex items-center justify-center gap-1.5 border ${
                isLight
                  ? 'bg-slate-100 hover:bg-slate-200 text-slate-800 border-slate-200'
                  : 'bg-[#202b36] hover:bg-[#283645] text-gray-200 border-transparent'
              }`}
            >
              <Settings className="w-3.5 h-3.5" />
              <span>ویرایش مشخصات عامل</span>
            </button>

            <button
              onClick={onClearHistory}
              className={`w-full py-2 rounded-xl transition-colors flex items-center justify-center gap-1.5 border ${
                isLight
                  ? 'bg-rose-50 hover:bg-rose-100 text-rose-700 border-rose-200'
                  : 'bg-rose-950/40 hover:bg-rose-900/50 text-rose-300 border-rose-900/40'
              }`}
            >
              <Trash2 className="w-3.5 h-3.5" />
              <span>پاک‌سازی تاریخچه گفتگو</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
