import React, { useState, useRef, useEffect } from 'react';
import { Attachment } from '../types';
import {
  Paperclip,
  Send,
  Image as ImageIcon,
  FileText,
  X,
  Smile,
  Globe,
  Loader2,
} from 'lucide-react';

interface ChatInputProps {
  onSendMessage: (text: string, attachments: Attachment[]) => void;
  disabled?: boolean;
  webSearchEnabled: boolean;
  onToggleWebSearch: () => void;
  theme?: 'dark' | 'light';
}

const QUICK_EMOJIS = ['😊', '🤖', '🔥', '👍', '💡', '🚀', '🔍', '❤️', '⚡', '📝', '🧠', '✨', '🎉', '👏'];

export const ChatInput: React.FC<ChatInputProps> = ({
  onSendMessage,
  disabled = false,
  webSearchEnabled,
  onToggleWebSearch,
  theme = 'dark',
}) => {
  const isLight = theme === 'light';
  const [text, setText] = useState('');
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [showAttachMenu, setShowAttachMenu] = useState(false);
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [isReadingFile, setIsReadingFile] = useState(false);

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Auto-grow textarea
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 140)}px`;
    }
  }, [text]);

  const handleSend = () => {
    if ((!text.trim() && attachments.length === 0) || disabled || isReadingFile) return;

    onSendMessage(text.trim(), attachments);
    setText('');
    setAttachments([]);
    setShowEmojiPicker(false);
    setShowAttachMenu(false);

    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleImageSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    setIsReadingFile(true);
    setShowAttachMenu(false);

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const reader = new FileReader();

      reader.onload = () => {
        const base64 = reader.result as string;
        const newAttachment: Attachment = {
          id: `att-${Date.now()}-${i}`,
          name: file.name,
          type: 'image',
          mimeType: file.type || 'image/jpeg',
          size: file.size,
          base64,
        };
        setAttachments((prev) => [...prev, newAttachment]);
        setIsReadingFile(false);
      };

      reader.onerror = () => {
        console.error('Failed to read image');
        setIsReadingFile(false);
      };

      reader.readAsDataURL(file);
    }

    if (imageInputRef.current) imageInputRef.current.value = '';
  };

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    setIsReadingFile(true);
    setShowAttachMenu(false);

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const reader = new FileReader();

      // Read text-based content
      reader.onload = () => {
        const content = reader.result as string;
        const newAttachment: Attachment = {
          id: `att-${Date.now()}-${i}`,
          name: file.name,
          type: 'file',
          mimeType: file.type || 'text/plain',
          size: file.size,
          textContent: content,
        };
        setAttachments((prev) => [...prev, newAttachment]);
        setIsReadingFile(false);
      };

      reader.onerror = () => {
        console.error('Failed to read document');
        setIsReadingFile(false);
      };

      reader.readAsText(file);
    }

    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const removeAttachment = (id: string) => {
    setAttachments((prev) => prev.filter((a) => a.id !== id));
  };

  const insertEmoji = (emoji: string) => {
    setText((prev) => prev + emoji);
    setShowEmojiPicker(false);
    textareaRef.current?.focus();
  };

  return (
    <div
      className={`relative px-3 sm:px-4 py-2.5 border-t transition-colors ${
        isLight ? 'bg-white border-slate-200' : 'bg-[#17212b] border-[#242f3d]'
      }`}
      dir="rtl"
    >
      {/* Hidden File Inputs */}
      <input
        ref={imageInputRef}
        type="file"
        accept="image/*"
        multiple
        className="hidden"
        onChange={handleImageSelect}
      />
      <input
        ref={fileInputRef}
        type="file"
        multiple
        className="hidden"
        onChange={handleFileSelect}
      />

      {/* Attachment Menu Popup (Telegram Style) */}
      {showAttachMenu && (
        <div
          className={`absolute bottom-16 right-4 z-30 rounded-2xl p-2 shadow-2xl space-y-1 w-48 border animate-in fade-in zoom-in-95 duration-150 ${
            isLight
              ? 'bg-white border-slate-200 text-slate-800'
              : 'bg-[#242f3d] border-[#2e3c4d] text-white'
          }`}
        >
          <button
            type="button"
            onClick={() => imageInputRef.current?.click()}
            className={`w-full flex items-center gap-3 px-3 py-2 text-xs rounded-xl transition-colors text-right ${
              isLight ? 'hover:bg-slate-100 text-slate-800' : 'hover:bg-[#2e3c4d] text-white'
            }`}
          >
            <div className="w-7 h-7 rounded-lg bg-teal-500/20 text-teal-600 dark:text-teal-400 flex items-center justify-center">
              <ImageIcon className="w-4 h-4" />
            </div>
            <div>
              <span className="font-medium block">عکس و تصویر</span>
              <span className={`text-[10px] ${isLight ? 'text-slate-400' : 'text-gray-400'}`}>
                JPG, PNG, WebP...
              </span>
            </div>
          </button>

          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className={`w-full flex items-center gap-3 px-3 py-2 text-xs rounded-xl transition-colors text-right ${
              isLight ? 'hover:bg-slate-100 text-slate-800' : 'hover:bg-[#2e3c4d] text-white'
            }`}
          >
            <div className="w-7 h-7 rounded-lg bg-blue-500/20 text-blue-600 dark:text-blue-400 flex items-center justify-center">
              <FileText className="w-4 h-4" />
            </div>
            <div>
              <span className="font-medium block">فایل و سند متنی</span>
              <span className={`text-[10px] ${isLight ? 'text-slate-400' : 'text-gray-400'}`}>
                کد، متن، اسناد...
              </span>
            </div>
          </button>
        </div>
      )}

      {/* Emoji Picker Popup */}
      {showEmojiPicker && (
        <div
          className={`absolute bottom-16 left-4 z-30 rounded-2xl p-3 shadow-2xl border animate-in fade-in zoom-in-95 duration-150 ${
            isLight
              ? 'bg-white border-slate-200 text-slate-800'
              : 'bg-[#242f3d] border-[#2e3c4d] text-white'
          }`}
        >
          <div className={`text-[11px] mb-2 font-medium ${isLight ? 'text-slate-500' : 'text-gray-400'}`}>
            ایموجی‌های پرکاربرد:
          </div>
          <div className="grid grid-cols-7 gap-1.5 text-xl">
            {QUICK_EMOJIS.map((emoji) => (
              <button
                key={emoji}
                type="button"
                onClick={() => insertEmoji(emoji)}
                className={`w-8 h-8 flex items-center justify-center rounded-lg transition-colors ${
                  isLight ? 'hover:bg-slate-100' : 'hover:bg-[#2e3c4d]'
                }`}
              >
                {emoji}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Attachments Preview Bar */}
      {attachments.length > 0 && (
        <div className="flex items-center gap-2 mb-2 overflow-x-auto pb-1">
          {attachments.map((att) => (
            <div
              key={att.id}
              className={`relative flex items-center gap-2 px-2.5 py-1.5 rounded-xl text-xs shrink-0 group border ${
                isLight
                  ? 'bg-slate-100 border-slate-300 text-slate-800'
                  : 'bg-[#202b36] border-[#2e3c4d] text-white'
              }`}
            >
              {att.type === 'image' ? (
                <img
                  src={att.base64}
                  alt={att.name}
                  referrerPolicy="no-referrer"
                  className="w-6 h-6 rounded object-cover"
                />
              ) : (
                <FileText className="w-4 h-4 text-blue-500 shrink-0" />
              )}
              <span className="max-w-[120px] truncate text-[11px] font-medium">{att.name}</span>
              <button
                type="button"
                onClick={() => removeAttachment(att.id)}
                className={`p-0.5 rounded-full transition-colors ${
                  isLight ? 'text-slate-400 hover:text-rose-600' : 'text-gray-400 hover:text-rose-400'
                }`}
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          ))}

          {isReadingFile && (
            <div className="flex items-center gap-1.5 text-xs text-blue-500 px-2 py-1">
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
              <span>در حال بارگذاری فایل...</span>
            </div>
          )}
        </div>
      )}

      {/* Main Input Row */}
      <div className="flex items-end gap-2">
        {/* Paperclip Button */}
        <button
          id="attach-file-btn"
          type="button"
          onClick={() => {
            setShowAttachMenu(!showAttachMenu);
            setShowEmojiPicker(false);
          }}
          className={`p-2.5 rounded-full transition-colors ${
            showAttachMenu || attachments.length > 0
              ? isLight
                ? 'text-[#3390ec] bg-blue-50'
                : 'text-[#5288c1] bg-[#242f3d]'
              : isLight
              ? 'text-slate-500 hover:text-slate-900 hover:bg-slate-100'
              : 'text-gray-400 hover:text-white hover:bg-[#202b36]'
          }`}
          title="پیوست عکس یا فایل"
        >
          <Paperclip className="w-5 h-5 -rotate-45" />
        </button>

        {/* Web Search Quick Indicator Badge */}
        <button
          type="button"
          onClick={onToggleWebSearch}
          className={`p-2 rounded-xl text-xs flex items-center gap-1 transition-all ${
            webSearchEnabled
              ? isLight
                ? 'bg-cyan-50 text-cyan-700 border border-cyan-300 font-medium'
                : 'bg-[#2b5278] text-cyan-300 border border-[#5288c1]'
              : isLight
              ? 'text-slate-400 hover:text-slate-700 hover:bg-slate-100'
              : 'text-gray-500 hover:text-gray-300 hover:bg-[#202b36]'
          }`}
          title={webSearchEnabled ? 'جستجوی وب فعال است' : 'فعال‌سازی جستجوی وب'}
        >
          <Globe className={`w-4 h-4 ${webSearchEnabled ? 'text-cyan-500' : 'opacity-60'}`} />
          {webSearchEnabled && <span className="text-[10px] hidden sm:inline">وب سرچ</span>}
        </button>

        {/* Auto-expanding Textarea */}
        <div
          className={`flex-1 rounded-2xl px-3 py-1.5 flex items-center transition-all border ${
            isLight
              ? 'bg-slate-100 border-slate-200 focus-within:border-[#3390ec] focus-within:bg-white text-slate-900'
              : 'bg-[#0e1621] border-[#242f3d] focus-within:border-[#5288c1] text-white'
          }`}
        >
          <textarea
            ref={textareaRef}
            rows={1}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={handleKeyDown}
            disabled={disabled}
            placeholder="پیام خود را بنویسید... (Shift+Enter برای خط بعد)"
            className={`w-full bg-transparent outline-none resize-none text-sm max-h-36 leading-normal py-1 ${
              isLight ? 'text-slate-900 placeholder:text-slate-400' : 'text-white placeholder:text-gray-500'
            }`}
          />

          {/* Emoji button */}
          <button
            type="button"
            onClick={() => {
              setShowEmojiPicker(!showEmojiPicker);
              setShowAttachMenu(false);
            }}
            className={`p-1.5 transition-colors shrink-0 ${
              isLight
                ? 'text-slate-400 hover:text-amber-500'
                : 'text-gray-400 hover:text-yellow-400'
            }`}
            title="ایموجی"
          >
            <Smile className="w-4 h-4" />
          </button>
        </div>

        {/* Telegram Blue Send Button */}
        <button
          id="send-message-btn"
          type="button"
          onClick={handleSend}
          disabled={(!text.trim() && attachments.length === 0) || disabled || isReadingFile}
          className="w-10 h-10 rounded-full bg-[#3390ec] hover:bg-[#2881d8] disabled:opacity-40 disabled:hover:bg-[#3390ec] text-white flex items-center justify-center shadow-md transition-all shrink-0 active:scale-95"
          title="ارسال پیام"
        >
          <Send className="w-4 h-4 -rotate-90 -mr-0.5" />
        </button>
      </div>
    </div>
  );
};
