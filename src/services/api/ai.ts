/**
 * AI API client — streaming chat for the Health Guide.
 *
 * Uses fetch + ReadableStream to read SSE from /ai/chat. The backend
 * emits `data: {...}\n\n` framed events with:
 *   - { type: 'content_block_delta', delta: { text: '...' } }
 *   - { type: 'message_stop', usage: { input_tokens, output_tokens } }
 *   - { type: 'error', message: '...' }
 *
 * Callers pass `onChunk` / `onComplete` / `onError` callbacks to surface
 * streaming progress without a full Promise-based wait.
 */

import { API_BASE_URL, getAuthToken } from './client';

export interface ConversationMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface ChatUsage {
  inputTokens: number;
  outputTokens: number;
}

/**
 * Error shape we attach extra context to when the chat stream fails.
 * Callers can read `code` to decide whether retry makes sense (timeouts
 * are retriable; `SERVICE_UNAVAILABLE` is not).
 */
export type ChatStreamError = Error & {
  code?: string;
  planLimit?: { limit: number; current: number; feature: string; upgradeRequired: boolean };
};

export interface ChatStreamCallbacks {
  onChunk: (text: string) => void;
  onComplete: (usage: ChatUsage) => void;
  onError: (error: ChatStreamError) => void;
  /** Optional AbortSignal to cancel the stream (e.g. user clicks "Stop"). */
  signal?: AbortSignal;
}

/**
 * Hard ceiling for a single chat round-trip. Beyond this, we surface a
 * timeout error instead of letting the connection hang. Anthropic's
 * server-side timeout is longer than what proxies/Cloud Run will hold,
 * so without this the user sees an indefinite spinner when the upstream
 * stalls. 60s is comfortably above a normal answer's tail latency.
 */
const CHAT_TIMEOUT_MS = 60_000;

function parseSSELines(buffer: string): { events: string[]; rest: string } {
  // SSE events are separated by \n\n. We return fully-closed events and
  // keep the partial trailing buffer for the next chunk.
  const events: string[] = [];
  let rest = buffer;
  let idx: number;
   
  while ((idx = rest.indexOf('\n\n')) >= 0) {
    events.push(rest.slice(0, idx));
    rest = rest.slice(idx + 2);
  }
  return { events, rest };
}

function extractDataPayload(event: string): string | null {
  // An SSE event block is a collection of `field: value\n` lines. We only
  // care about the `data:` field for this feature.
  const lines = event.split('\n');
  for (const line of lines) {
    if (line.startsWith('data:')) {
      return line.slice(5).trim();
    }
  }
  return null;
}

export const aiApi = {
  /**
   * POST /ai/chat — streams Claude's response chunk-by-chunk.
   * Returns a Promise that resolves when the stream is complete or errors.
   */
  async chat(
    message: string,
    conversationHistory: ConversationMessage[],
    callbacks: ChatStreamCallbacks
  ): Promise<void> {
    const { onChunk, onComplete, onError, signal } = callbacks;

    // Compose a chained AbortController: caller's signal OR our timeout
    // can both abort the in-flight stream. We track which one fired so
    // the catch block can distinguish a user-cancel from a timeout.
    let timedOut = false;
    const timeoutController = new AbortController();
    const timeoutId = setTimeout(() => {
      timedOut = true;
      timeoutController.abort();
    }, CHAT_TIMEOUT_MS);
    if (signal) {
      if (signal.aborted) {
        timeoutController.abort();
      } else {
        signal.addEventListener('abort', () => timeoutController.abort(), { once: true });
      }
    }

    try {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        Accept: 'text/event-stream',
      };
      const authToken = getAuthToken();
      if (authToken) headers['Authorization'] = `Bearer ${authToken}`;

      const response = await fetch(`${API_BASE_URL}/ai/chat`, {
        method: 'POST',
        credentials: 'include',
        signal: timeoutController.signal,
        headers,
        body: JSON.stringify({ message, conversationHistory }),
      });

      if (!response.ok) {
        // Try to surface the JSON error body if the server sent one.
        let errorMessage = `Chat request failed (${response.status})`;
        let errorCode: string | undefined;
        let planLimit: { limit: number; current: number; feature: string; upgradeRequired: boolean } | undefined;
        try {
          const errJson = await response.json();
          const nested = errJson?.error?.message ?? errJson?.error ?? errJson?.message;
          if (typeof nested === 'string') errorMessage = nested;
          const code = errJson?.error?.code;
          if (typeof code === 'string') errorCode = code;
          if (code === 'PLAN_LIMIT_EXCEEDED' && typeof errJson.error === 'object') {
            planLimit = {
              limit: Number(errJson.error.limit) || 0,
              current: Number(errJson.error.current) || 0,
              feature: String(errJson.error.feature || ''),
              upgradeRequired: errJson.error.upgradeRequired === true,
            };
            // Friendlier default message for the chat surface.
            errorMessage =
              planLimit.limit > 0
                ? `You've used your ${planLimit.limit} free AI chats for today. Upgrade to Pro for unlimited conversations.`
                : 'AI chat is not available on your current plan. Upgrade to continue.';
          }
        } catch {
          // fall through — keep the status-based message
        }
        // Attach plan-limit context on the Error so the chat UI can render
        // an upgrade CTA instead of a generic retry button.
        const error = new Error(errorMessage) as Error & {
          code?: string;
          planLimit?: typeof planLimit;
        };
        error.code = errorCode;
        error.planLimit = planLimit;
        onError(error);
        return;
      }

      if (!response.body) {
        onError(new Error('Stream not supported in this environment.'));
        return;
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let receivedUsage: ChatUsage = { inputTokens: 0, outputTokens: 0 };
      let streamError: string | null = null;
      let receivedAnyContent = false;
      let receivedMessageStop = false;


      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        const { events, rest } = parseSSELines(buffer);
        buffer = rest;

        for (const event of events) {
          const payload = extractDataPayload(event);
          if (!payload) continue;
          try {
            const parsed = JSON.parse(payload);
            if (parsed.type === 'content_block_delta' && parsed.delta?.text) {
              receivedAnyContent = true;
              onChunk(parsed.delta.text as string);
            } else if (parsed.type === 'message_stop' && parsed.usage) {
              receivedMessageStop = true;
              receivedUsage = {
                inputTokens: parsed.usage.input_tokens ?? 0,
                outputTokens: parsed.usage.output_tokens ?? 0,
              };
            } else if (parsed.type === 'error') {
              streamError = parsed.message || 'Stream error';
            }
          } catch {
            // ignore malformed JSON frames — SSE can include comments/pings
          }
        }
      }

      if (streamError) {
        onError(new Error(streamError));
        return;
      }
      // Silent close: backend dropped the connection without sending a
      // `message_stop` or an explicit error frame, and we never streamed
      // any tokens. Treat this as an error rather than a happy completion
      // — otherwise the UI shows an empty assistant bubble with no signal
      // that anything went wrong.
      if (!receivedMessageStop && !receivedAnyContent) {
        onError(new Error('The Health Guide stopped responding. Please try again.'));
        return;
      }
      onComplete(receivedUsage);
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        if (timedOut) {
          onError(new Error('The Health Guide took too long to respond. Please try again.'));
          return;
        }
        // Caller-initiated cancel — surface as a completion, not an error.
        onComplete({ inputTokens: 0, outputTokens: 0 });
        return;
      }
      onError(err instanceof Error ? err : new Error(String(err)));
    } finally {
      clearTimeout(timeoutId);
    }
  },
};
