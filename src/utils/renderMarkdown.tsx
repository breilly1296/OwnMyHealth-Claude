/**
 * Lightweight markdown → React renderer shared across AI-response surfaces.
 *
 * Handles: # h1 / ## h2, **bold**, *italic*, bullet lists, numbered lists.
 * Strips trailing disclaimer blocks (handled separately by callers who want
 * a consistent disclaimer pill).
 *
 * Extracted from BiomarkerAIGuidance so the AI chat Health Guide page can
 * reuse the exact same rendering without duplicating ~140 lines of logic.
 */

import React from 'react';

export interface RenderMarkdownOptions {
  /** When true (default), strips trailing "Disclaimer:" / "consult your doctor" blocks. */
  stripDisclaimer?: boolean;
}

const DISCLAIMER_PATTERNS: RegExp[] = [
  /---[\s\S]*$/i,
  /\*?\*?disclaimer\*?\*?:?[\s\S]*$/i,
  /please consult[\s\S]*healthcare provider[\s\S]*$/i,
  /this information is for educational purposes[\s\S]*$/i,
  /always consult[\s\S]*doctor[\s\S]*$/i,
  /consult your (healthcare provider|doctor|physician)[\s\S]*$/i,
];

function processInlineMarkdown(line: string): React.ReactNode {
  const parts: React.ReactNode[] = [];
  let remaining = line;
  let partKey = 0;

  while (remaining.length > 0) {
    const boldMatch = remaining.match(/\*\*(.+?)\*\*/);
    const italicMatch = remaining.match(/(?<!\*)\*([^*]+)\*(?!\*)/);

    if (boldMatch && (!italicMatch || boldMatch.index! <= italicMatch.index!)) {
      if (boldMatch.index! > 0) {
        parts.push(<span key={partKey++}>{remaining.slice(0, boldMatch.index)}</span>);
      }
      parts.push(
        <strong key={partKey++} className="font-semibold text-slate-700 dark:text-slate-200">
          {boldMatch[1]}
        </strong>
      );
      remaining = remaining.slice(boldMatch.index! + boldMatch[0].length);
    } else if (italicMatch) {
      if (italicMatch.index! > 0) {
        parts.push(<span key={partKey++}>{remaining.slice(0, italicMatch.index)}</span>);
      }
      parts.push(
        <em key={partKey++} className="italic">
          {italicMatch[1]}
        </em>
      );
      remaining = remaining.slice(italicMatch.index! + italicMatch[0].length);
    } else {
      parts.push(<span key={partKey++}>{remaining}</span>);
      break;
    }
  }

  return parts.length === 1 ? parts[0] : <>{parts}</>;
}

export function renderMarkdown(text: string, options: RenderMarkdownOptions = {}): React.ReactNode {
  const stripDisclaimer = options.stripDisclaimer !== false;
  let cleanedText = text;
  if (stripDisclaimer) {
    for (const pattern of DISCLAIMER_PATTERNS) {
      cleanedText = cleanedText.replace(pattern, '').trim();
    }
  }

  const lines = cleanedText.split('\n');
  const elements: React.ReactNode[] = [];
  let currentList: { type: 'ul' | 'ol'; items: React.ReactNode[] } | null = null;
  let key = 0;

  const flushList = () => {
    if (!currentList) return;
    if (currentList.type === 'ul') {
      elements.push(
        <ul key={key++} className="space-y-1.5 my-2">
          {currentList.items.map((item, i) => (
            <li key={i} className="flex items-start gap-2">
              <span className="text-brand-500 mt-1 text-[10px]">●</span>
              <span className="flex-1">{item}</span>
            </li>
          ))}
        </ul>
      );
    } else {
      elements.push(
        <ol key={key++} className="space-y-1.5 my-2">
          {currentList.items.map((item, i) => (
            <li key={i} className="flex items-start gap-2">
              <span className="text-brand-500 font-medium min-w-[1rem] text-xs">{i + 1}.</span>
              <span className="flex-1">{item}</span>
            </li>
          ))}
        </ol>
      );
    }
    currentList = null;
  };

  for (const line of lines) {
    const trimmedLine = line.trim();

    if (!trimmedLine) {
      flushList();
      continue;
    }

    const h2Match = trimmedLine.match(/^##\s+(.+)$/);
    if (h2Match) {
      flushList();
      elements.push(
        <h6 key={key++} className="font-medium text-slate-700 dark:text-slate-300 mt-3 mb-1">
          {processInlineMarkdown(h2Match[1])}
        </h6>
      );
      continue;
    }

    const h1Match = trimmedLine.match(/^#\s+(.+)$/);
    if (h1Match) {
      flushList();
      elements.push(
        <h5 key={key++} className="font-semibold text-slate-800 dark:text-slate-200 mt-3 mb-1">
          {processInlineMarkdown(h1Match[1])}
        </h5>
      );
      continue;
    }

    const bulletMatch = trimmedLine.match(/^[-*•]\s+(.+)$/);
    if (bulletMatch) {
      if (!currentList || currentList.type !== 'ul') {
        flushList();
        currentList = { type: 'ul', items: [] };
      }
      currentList.items.push(processInlineMarkdown(bulletMatch[1]));
      continue;
    }

    const numberedMatch = trimmedLine.match(/^\d+[.)]\s+(.+)$/);
    if (numberedMatch) {
      if (!currentList || currentList.type !== 'ol') {
        flushList();
        currentList = { type: 'ol', items: [] };
      }
      currentList.items.push(processInlineMarkdown(numberedMatch[1]));
      continue;
    }

    flushList();
    elements.push(
      <p key={key++} className="leading-relaxed">
        {processInlineMarkdown(trimmedLine)}
      </p>
    );
  }

  flushList();
  return <div className="space-y-1">{elements}</div>;
}
