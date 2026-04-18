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

import { API_BASE_URL, getAuthToken, getCsrfToken } from './client';

export interface ConversationMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface ChatUsage {
  inputTokens: number;
  outputTokens: number;
}

export interface ChatStreamCallbacks {
  onChunk: (text: string) => void;
  onComplete: (usage: ChatUsage) => void;
  onError: (error: Error) => void;
  /** Optional AbortSignal to cancel the stream (e.g. user clicks "Stop"). */
  signal?: AbortSignal;
}

function parseSSELines(buffer: string): { events: string[]; rest: string } {
  // SSE events are separated by \n\n. We return fully-closed events and
  // keep the partial trailing buffer for the next chunk.
  const events: string[] = [];
  let rest = buffer;
  let idx: number;
  // eslint-disable-next-line no-cond-assign
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

    try {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        Accept: 'text/event-stream',
      };
      const authToken = getAuthToken();
      if (authToken) headers['Authorization'] = `Bearer ${authToken}`;
      const csrfToken = getCsrfToken();
      if (csrfToken) headers['x-csrf-token'] = csrfToken;

      const response = await fetch(`${API_BASE_URL}/ai/chat`, {
        method: 'POST',
        credentials: 'include',
        signal,
        headers,
        body: JSON.stringify({ message, conversationHistory }),
      });

      if (!response.ok) {
        // Try to surface the JSON error body if the server sent one.
        let errorMessage = `Chat request failed (${response.status})`;
        try {
          const errJson = await response.json();
          const nested = errJson?.error?.message ?? errJson?.error ?? errJson?.message;
          if (typeof nested === 'string') errorMessage = nested;
        } catch {
          // fall through — keep the status-based message
        }
        onError(new Error(errorMessage));
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

      // eslint-disable-next-line no-constant-condition
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
              onChunk(parsed.delta.text as string);
            } else if (parsed.type === 'message_stop' && parsed.usage) {
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
      onComplete(receivedUsage);
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        // Caller-initiated cancel — surface as a completion, not an error.
        onComplete({ inputTokens: 0, outputTokens: 0 });
        return;
      }
      onError(err instanceof Error ? err : new Error(String(err)));
    }
  },
};
