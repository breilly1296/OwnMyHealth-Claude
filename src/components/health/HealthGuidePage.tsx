/**
 * HealthGuidePage - conversational Health Guide (chat UI).
 *
 * Single-page chat interface that streams responses from /ai/chat.
 * Conversation is kept in React state (not persisted), capped at 20
 * messages (10 exchanges) to match the backend history limit.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Sparkles,
  Send,
  RotateCcw,
  AlertCircle,
  User,
  Loader2,
  Stethoscope,
  ArrowRight,
} from 'lucide-react';
import type { Biomarker, InsurancePlan } from '../../types';
import {
  aiApi,
  settingsApi,
  type ConversationMessage,
  type UserHealthProfile,
} from '../../services/api';
import { renderMarkdown } from '../../utils/renderMarkdown';

interface HealthGuidePageProps {
  biomarkers?: Biomarker[];
  insurancePlans?: InsurancePlan[];
  /** Optional — when provided, the "set up" banner links here. */
  onNavigateToSettings?: () => void;
}

function summarizeProfile(profile: UserHealthProfile | null): string | null {
  if (!profile) return null;
  const activeConditions = profile.conditions.filter((c) => c.status !== 'resolved');
  const bits: string[] = [];
  if (activeConditions.length > 0) {
    const names = activeConditions.slice(0, 2).map((c) => c.name).join(', ');
    const extra = activeConditions.length > 2 ? ` +${activeConditions.length - 2}` : '';
    bits.push(`${names}${extra}`);
  }
  if (profile.medications.length > 0) {
    bits.push(`${profile.medications.length} medication${profile.medications.length === 1 ? '' : 's'}`);
  }
  return bits.length > 0 ? bits.join(' · ') : null;
}

type MessageRole = 'user' | 'assistant';

interface DisplayMessage {
  id: string;
  role: MessageRole;
  content: string;
  /** True while this assistant message is still streaming. */
  streaming?: boolean;
  /** True when the message ended via error and we want to show retry. */
  error?: boolean;
}

const HISTORY_CAP = 20; // must match backend Zod max

const DEFAULT_SUGGESTIONS = [
  'Give me a summary of my overall health',
  'What should I ask my doctor?',
];

function buildContextualSuggestions(
  biomarkers: Biomarker[] | undefined,
  plans: InsurancePlan[] | undefined
): string[] {
  const suggestions = new Set<string>(DEFAULT_SUGGESTIONS);

  const hasOutOfRange = biomarkers?.some((b) => b.value < b.normalRange.min || b.value > b.normalRange.max);
  if (hasOutOfRange) suggestions.add('Which biomarkers need attention?');
  if (plans && plans.length > 0) suggestions.add('What does my insurance cover?');
  if (biomarkers && biomarkers.length > 0) suggestions.add('How have my biomarkers trended recently?');

  return Array.from(suggestions).slice(0, 4);
}

export default function HealthGuidePage({
  biomarkers,
  insurancePlans,
  onNavigateToSettings,
}: HealthGuidePageProps) {
  const [messages, setMessages] = useState<DisplayMessage[]>([]);
  const [input, setInput] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);
  const [pageError, setPageError] = useState<string | null>(null);
  const [healthProfile, setHealthProfile] = useState<UserHealthProfile | null>(null);

  const abortRef = useRef<AbortController | null>(null);
  const endRef = useRef<HTMLDivElement | null>(null);

  // Pull the self-reported profile so we can surface a subtle indicator
  // of what context is active (or prompt to set one up). Silent fail —
  // the chat still works without profile data.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const profile = await settingsApi.getHealthProfile();
        if (!cancelled) setHealthProfile(profile);
      } catch {
        // swallow — the profile indicator is a nice-to-have
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const profileSummary = summarizeProfile(healthProfile);

  const suggestions = useMemo(
    () => buildContextualSuggestions(biomarkers, insurancePlans),
    [biomarkers, insurancePlans]
  );

  // Auto-scroll to the newest message / streaming edit.
  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [messages]);

  // Cancel any in-flight stream on unmount.
  useEffect(() => {
    return () => {
      abortRef.current?.abort();
    };
  }, []);

  const sendMessage = useCallback(
    async (content: string) => {
      const trimmed = content.trim();
      if (!trimmed || isStreaming) return;

      setPageError(null);

      const userMsg: DisplayMessage = {
        id: `user-${Date.now()}`,
        role: 'user',
        content: trimmed,
      };
      const assistantId = `assistant-${Date.now() + 1}`;
      const assistantMsg: DisplayMessage = {
        id: assistantId,
        role: 'assistant',
        content: '',
        streaming: true,
      };

      // Build history from the existing messages — only completed messages
      // (drop any lingering streaming or errored assistant placeholder).
      const history: ConversationMessage[] = messages
        .filter((m) => !m.streaming && !m.error)
        .slice(-HISTORY_CAP)
        .map((m) => ({ role: m.role, content: m.content }));

      setMessages((prev) => [...prev, userMsg, assistantMsg]);
      setInput('');
      setIsStreaming(true);

      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      await aiApi.chat(trimmed, history, {
        signal: controller.signal,
        onChunk: (chunk) => {
          setMessages((prev) =>
            prev.map((m) =>
              m.id === assistantId ? { ...m, content: m.content + chunk } : m
            )
          );
        },
        onComplete: () => {
          setMessages((prev) =>
            prev.map((m) => (m.id === assistantId ? { ...m, streaming: false } : m))
          );
          setIsStreaming(false);
        },
        onError: (err) => {
          setMessages((prev) =>
            prev.map((m) =>
              m.id === assistantId
                ? {
                    ...m,
                    streaming: false,
                    error: true,
                    content:
                      m.content ||
                      err.message ||
                      'The assistant is unavailable right now. Please try again.',
                  }
                : m
            )
          );
          setIsStreaming(false);
          setPageError(err.message || 'Something went wrong');
        },
      });
    },
    [isStreaming, messages]
  );

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    sendMessage(input);
  };

  const handleSuggestionClick = (suggestion: string) => {
    sendMessage(suggestion);
  };

  const handleRetryLast = () => {
    // Find the last user message and replay it, dropping any errored
    // assistant placeholder below it.
    const lastUserIdx = [...messages].reverse().findIndex((m) => m.role === 'user');
    if (lastUserIdx === -1) return;
    const idx = messages.length - 1 - lastUserIdx;
    const lastUser = messages[idx];
    const trimmed = messages.slice(0, idx);
    setMessages(trimmed);
    // send after state settles
    setTimeout(() => sendMessage(lastUser.content), 0);
  };

  const handleClear = () => {
    abortRef.current?.abort();
    setMessages([]);
    setInput('');
    setIsStreaming(false);
    setPageError(null);
  };

  const emptyConversation = messages.length === 0;

  return (
    <div className="max-w-3xl mx-auto animate-fade-in flex flex-col min-h-[calc(100vh-6rem)]">
      {/* Header */}
      <div className="flex items-start justify-between gap-3 mb-4">
        <div>
          <h1 className="text-3xl font-bold text-slate-900 dark:text-white flex items-center gap-2">
            <Sparkles className="w-7 h-7 text-brand-500" />
            Health Guide
          </h1>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
            Ask anything about your biomarkers, insurance, goals, or claims.
          </p>
        </div>
        {messages.length > 0 && (
          <button
            onClick={handleClear}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-lg transition-colors"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            Clear chat
          </button>
        )}
      </div>

      {/* Health profile indicator (active context chip or set-up prompt) */}
      {profileSummary ? (
        <button
          type="button"
          onClick={onNavigateToSettings}
          className="inline-flex items-center gap-1.5 self-start mb-3 px-3 py-1.5 text-xs text-slate-600 dark:text-slate-300 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 rounded-full border border-slate-200/60 dark:border-slate-700 transition-colors"
        >
          <Stethoscope className="w-3.5 h-3.5 text-wellness-600 dark:text-wellness-400" />
          <span>Profile: {profileSummary}</span>
        </button>
      ) : healthProfile !== null && (
        <button
          type="button"
          onClick={onNavigateToSettings}
          className="inline-flex items-center justify-between gap-2 self-start mb-3 px-3 py-2 text-xs text-slate-600 dark:text-slate-300 bg-brand-50 dark:bg-brand-900/20 hover:bg-brand-100 dark:hover:bg-brand-900/30 rounded-lg border border-brand-200 dark:border-brand-800 transition-colors w-full sm:w-auto"
        >
          <Stethoscope className="w-3.5 h-3.5 text-brand-500 dark:text-brand-400 flex-shrink-0" />
          <span className="flex-1 text-left">Set up your health profile for personalized insights.</span>
          <ArrowRight className="w-3.5 h-3.5" />
        </button>
      )}

      {/* Messages area */}
      <div className="flex-1 bg-white dark:bg-slate-800 rounded-2xl border border-slate-200/60 dark:border-slate-700 p-4 mb-4 overflow-y-auto min-h-[60vh] max-h-[70vh]">
        {emptyConversation ? (
          <EmptyState
            suggestions={suggestions}
            onSuggestionClick={handleSuggestionClick}
            disabled={isStreaming}
          />
        ) : (
          <div className="space-y-4">
            {messages.map((m) => (
              <MessageBubble key={m.id} message={m} onRetry={handleRetryLast} />
            ))}
            <div ref={endRef} />
          </div>
        )}
      </div>

      {pageError && !isStreaming && (
        <div className="mb-3 p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg flex items-start gap-2">
          <AlertCircle className="w-4 h-4 text-red-600 dark:text-red-400 flex-shrink-0 mt-0.5" />
          <p className="text-sm text-red-800 dark:text-red-200 flex-1">{pageError}</p>
        </div>
      )}

      {/* Input bar */}
      <form onSubmit={handleSubmit} className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200/60 dark:border-slate-700 p-3 flex items-end gap-2">
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              handleSubmit(e as unknown as React.FormEvent);
            }
          }}
          placeholder={isStreaming ? 'Waiting for response…' : 'Ask about your health data…'}
          rows={1}
          disabled={isStreaming}
          className="flex-1 resize-none bg-transparent text-sm text-slate-900 dark:text-white placeholder-slate-400 dark:placeholder-slate-500 focus:outline-none max-h-32 disabled:opacity-60"
          maxLength={2000}
        />
        <button
          type="submit"
          disabled={isStreaming || !input.trim()}
          className="flex-shrink-0 inline-flex items-center justify-center w-9 h-9 bg-brand-500 text-white rounded-lg hover:bg-brand-600 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          aria-label="Send message"
        >
          {isStreaming ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
        </button>
      </form>
    </div>
  );
}

// ---------- sub-components ----------

function EmptyState({
  suggestions,
  onSuggestionClick,
  disabled,
}: {
  suggestions: string[];
  onSuggestionClick: (s: string) => void;
  disabled: boolean;
}) {
  return (
    <div className="flex flex-col items-center justify-center text-center py-12 gap-4">
      <div className="w-16 h-16 bg-gradient-to-br from-brand-500 to-purple-600 rounded-2xl flex items-center justify-center">
        <Sparkles className="w-8 h-8 text-white" />
      </div>
      <div className="max-w-md">
        <h2 className="text-lg font-semibold text-slate-900 dark:text-white mb-2">
          Welcome! I'm your Health Guide.
        </h2>
        <p className="text-sm text-slate-500 dark:text-slate-400">
          I have access to your biomarkers, insurance, expenses, goals, and tracked health needs.
          Ask me anything about your health data.
        </p>
      </div>
      <div className="w-full mt-2">
        <p className="text-xs uppercase tracking-wide text-slate-400 dark:text-slate-500 mb-3">
          Suggested questions
        </p>
        <div className="flex flex-wrap gap-2 justify-center">
          {suggestions.map((s) => (
            <button
              key={s}
              onClick={() => onSuggestionClick(s)}
              disabled={disabled}
              className="bg-slate-100 dark:bg-slate-700 border border-slate-200/60 dark:border-slate-600 text-slate-700 dark:text-slate-200 hover:border-brand-300 dark:hover:border-brand-500 hover:bg-slate-50 dark:hover:bg-slate-600 rounded-full px-4 py-2 text-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {s}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

function MessageBubble({ message, onRetry }: { message: DisplayMessage; onRetry: () => void }) {
  const isUser = message.role === 'user';
  if (isUser) {
    return (
      <div className="flex items-start justify-end gap-2">
        <div className="max-w-[85%] bg-brand-500 text-white rounded-2xl rounded-tr-md px-4 py-2.5 text-sm">
          {message.content}
        </div>
        <div className="w-7 h-7 rounded-full bg-slate-200 dark:bg-slate-700 flex items-center justify-center flex-shrink-0">
          <User className="w-3.5 h-3.5 text-slate-600 dark:text-slate-300" />
        </div>
      </div>
    );
  }

  return (
    <div className="flex items-start gap-2">
      <div className="w-7 h-7 rounded-full bg-gradient-to-br from-brand-500 to-purple-600 flex items-center justify-center flex-shrink-0">
        <Sparkles className="w-3.5 h-3.5 text-white" />
      </div>
      <div className="flex-1 min-w-0 max-w-[85%]">
        <div
          className={`rounded-2xl rounded-tl-md px-4 py-2.5 text-sm border ${
            message.error
              ? 'bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800 text-red-800 dark:text-red-200'
              : 'bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-800 dark:text-slate-200'
          }`}
        >
          {message.streaming && !message.content ? (
            <TypingDots />
          ) : (
            <div className="prose-sm">
              {renderMarkdown(message.content, { stripDisclaimer: false })}
            </div>
          )}
        </div>
        {message.error && (
          <button
            onClick={onRetry}
            className="mt-1.5 text-xs text-red-600 dark:text-red-400 hover:underline"
          >
            Retry
          </button>
        )}
        {!message.error && !message.streaming && (
          <p className="text-[10px] text-slate-400 dark:text-slate-500 italic mt-1.5">
            Educational only. Always consult your healthcare provider for medical advice.
          </p>
        )}
      </div>
    </div>
  );
}

function TypingDots() {
  return (
    <div className="flex items-center gap-1 py-1">
      <span className="w-1.5 h-1.5 rounded-full bg-slate-400 animate-pulse" style={{ animationDelay: '0ms' }} />
      <span className="w-1.5 h-1.5 rounded-full bg-slate-400 animate-pulse" style={{ animationDelay: '150ms' }} />
      <span className="w-1.5 h-1.5 rounded-full bg-slate-400 animate-pulse" style={{ animationDelay: '300ms' }} />
    </div>
  );
}
