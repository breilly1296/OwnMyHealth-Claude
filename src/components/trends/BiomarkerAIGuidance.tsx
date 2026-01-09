/**
 * BiomarkerAIGuidance Component
 *
 * Displays AI-powered educational guidance for a biomarker.
 * Fetches guidance from the backend and displays formatted sections.
 *
 * Features:
 * - Loading state with skeleton
 * - Error handling with retry
 * - Cached guidance to avoid re-fetching
 * - Proper markdown rendering
 * - Clear medical disclaimer
 *
 * @module components/trends/BiomarkerAIGuidance
 */

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Sparkles, AlertCircle, RefreshCw, BookOpen, Stethoscope, TrendingUp, MessageCircle, Heart } from 'lucide-react';
import type { Biomarker } from '../../types';
import { biomarkersApi } from '../../services/api';

interface BiomarkerAIGuidanceProps {
  /** The biomarker to get guidance for */
  biomarker: Biomarker;
  /** All biomarkers for context about related markers */
  allBiomarkers: Biomarker[];
}

interface GuidanceSection {
  title: string;
  icon: React.ReactNode;
  content: string;
}

// Cache for guidance to avoid re-fetching
const guidanceCache = new Map<string, string>();

/**
 * Parse markdown text into React elements
 * Handles: **bold**, *italic*, - bullet lists, numbered lists
 */
function renderMarkdown(text: string): React.ReactNode {
  // Remove any disclaimer text from the AI response (we add our own)
  const disclaimerPatterns = [
    /---[\s\S]*$/i, // Everything after ---
    /\*?disclaimer\*?:?[\s\S]*$/i,
    /please consult[\s\S]*healthcare provider[\s\S]*$/i,
    /this information is for educational purposes[\s\S]*$/i,
    /always consult[\s\S]*doctor[\s\S]*$/i,
  ];

  let cleanedText = text;
  for (const pattern of disclaimerPatterns) {
    cleanedText = cleanedText.replace(pattern, '').trim();
  }

  // Split into lines for processing
  const lines = cleanedText.split('\n');
  const elements: React.ReactNode[] = [];
  let currentList: { type: 'ul' | 'ol'; items: React.ReactNode[] } | null = null;
  let key = 0;

  const processInlineMarkdown = (line: string): React.ReactNode => {
    // Process bold (**text**) and italic (*text*)
    const parts: React.ReactNode[] = [];
    let remaining = line;
    let partKey = 0;

    while (remaining.length > 0) {
      // Check for bold
      const boldMatch = remaining.match(/\*\*(.+?)\*\*/);
      // Check for italic (single asterisk, but not part of bold)
      const italicMatch = remaining.match(/(?<!\*)\*([^*]+)\*(?!\*)/);

      if (boldMatch && (!italicMatch || boldMatch.index! <= italicMatch.index!)) {
        // Add text before bold
        if (boldMatch.index! > 0) {
          parts.push(<span key={partKey++}>{remaining.slice(0, boldMatch.index)}</span>);
        }
        // Add bold text
        parts.push(<strong key={partKey++} className="font-semibold text-slate-700 dark:text-slate-200">{boldMatch[1]}</strong>);
        remaining = remaining.slice(boldMatch.index! + boldMatch[0].length);
      } else if (italicMatch) {
        // Add text before italic
        if (italicMatch.index! > 0) {
          parts.push(<span key={partKey++}>{remaining.slice(0, italicMatch.index)}</span>);
        }
        // Add italic text
        parts.push(<em key={partKey++} className="italic">{italicMatch[1]}</em>);
        remaining = remaining.slice(italicMatch.index! + italicMatch[0].length);
      } else {
        // No more markdown, add remaining text
        parts.push(<span key={partKey++}>{remaining}</span>);
        break;
      }
    }

    return parts.length === 1 ? parts[0] : <>{parts}</>;
  };

  const flushList = () => {
    if (currentList) {
      if (currentList.type === 'ul') {
        elements.push(
          <ul key={key++} className="space-y-2 my-3">
            {currentList.items.map((item, i) => (
              <li key={i} className="flex items-start gap-2">
                <span className="text-brand-500 mt-1.5 text-xs">&#9679;</span>
                <span className="flex-1">{item}</span>
              </li>
            ))}
          </ul>
        );
      } else {
        elements.push(
          <ol key={key++} className="space-y-2 my-3">
            {currentList.items.map((item, i) => (
              <li key={i} className="flex items-start gap-2">
                <span className="text-brand-500 font-medium min-w-[1.25rem]">{i + 1}.</span>
                <span className="flex-1">{item}</span>
              </li>
            ))}
          </ol>
        );
      }
      currentList = null;
    }
  };

  for (const line of lines) {
    const trimmedLine = line.trim();

    // Skip empty lines
    if (!trimmedLine) {
      flushList();
      continue;
    }

    // Check for bullet list item
    const bulletMatch = trimmedLine.match(/^[-*]\s+(.+)$/);
    if (bulletMatch) {
      if (!currentList || currentList.type !== 'ul') {
        flushList();
        currentList = { type: 'ul', items: [] };
      }
      currentList.items.push(processInlineMarkdown(bulletMatch[1]));
      continue;
    }

    // Check for numbered list item
    const numberedMatch = trimmedLine.match(/^\d+[.)]\s+(.+)$/);
    if (numberedMatch) {
      if (!currentList || currentList.type !== 'ol') {
        flushList();
        currentList = { type: 'ol', items: [] };
      }
      currentList.items.push(processInlineMarkdown(numberedMatch[1]));
      continue;
    }

    // Regular paragraph
    flushList();
    elements.push(
      <p key={key++} className="my-2 leading-relaxed">
        {processInlineMarkdown(trimmedLine)}
      </p>
    );
  }

  // Flush any remaining list
  flushList();

  return <div className="space-y-1">{elements}</div>;
}

export default function BiomarkerAIGuidance({ biomarker, allBiomarkers }: BiomarkerAIGuidanceProps) {
  const [guidance, setGuidance] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isMountedRef = useRef(true);

  const fetchGuidance = useCallback(async (skipCache = false) => {
    // Check cache first
    const cacheKey = `${biomarker.id}-${biomarker.value}`;
    if (!skipCache && guidanceCache.has(cacheKey)) {
      setGuidance(guidanceCache.get(cacheKey)!);
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const result = await biomarkersApi.getGuidance(biomarker.id, biomarker, allBiomarkers);

      if (isMountedRef.current) {
        // Cache the result
        guidanceCache.set(cacheKey, result.guidance);
        setGuidance(result.guidance);
      }
    } catch (err) {
      if (isMountedRef.current) {
        const message = err instanceof Error ? err.message : 'Unable to load guidance. Please try again.';
        setError(message);
      }
    } finally {
      if (isMountedRef.current) {
        setIsLoading(false);
      }
    }
  }, [biomarker, allBiomarkers]);

  useEffect(() => {
    isMountedRef.current = true;
    fetchGuidance();

    return () => {
      isMountedRef.current = false;
    };
  }, [fetchGuidance]);

  const handleRetry = () => {
    // Clear cache for this biomarker
    const cacheKey = `${biomarker.id}-${biomarker.value}`;
    guidanceCache.delete(cacheKey);
    setGuidance(null);
    setError(null);
    fetchGuidance(true);
  };

  // Parse guidance into sections
  const parseGuidance = (text: string): GuidanceSection[] => {
    const sections: GuidanceSection[] = [];
    const seenTitles = new Set<string>();

    // Define section patterns and their icons
    const sectionPatterns = [
      { pattern: /(?:^|\n)\s*\d*\.?\s*\*\*What This Measures\*\*:?\s*([\s\S]*?)(?=\n\s*\d*\.?\s*\*\*|$)/i, title: 'What This Measures', icon: <BookOpen className="w-4 h-4" /> },
      { pattern: /(?:^|\n)\s*\d*\.?\s*\*\*Understanding Your Result\*\*:?\s*([\s\S]*?)(?=\n\s*\d*\.?\s*\*\*|$)/i, title: 'Understanding Your Result', icon: <Stethoscope className="w-4 h-4" /> },
      { pattern: /(?:^|\n)\s*\d*\.?\s*\*\*Trend Summary\*\*:?\s*([\s\S]*?)(?=\n\s*\d*\.?\s*\*\*|$)/i, title: 'Trend Summary', icon: <TrendingUp className="w-4 h-4" /> },
      { pattern: /(?:^|\n)\s*\d*\.?\s*\*\*Questions for Your Doctor\*\*:?\s*([\s\S]*?)(?=\n\s*\d*\.?\s*\*\*|$)/i, title: 'Questions for Your Doctor', icon: <MessageCircle className="w-4 h-4" /> },
      { pattern: /(?:^|\n)\s*\d*\.?\s*\*\*What You Can Do\*\*:?\s*([\s\S]*?)(?=\n\s*\d*\.?\s*\*\*|---|$)/i, title: 'What You Can Do', icon: <Heart className="w-4 h-4" /> },
      // Legacy pattern for backward compatibility
      { pattern: /(?:^|\n)\s*\d*\.?\s*\*\*General Wellness(?:\s*Information)?\*\*:?\s*([\s\S]*?)(?=\n\s*\d*\.?\s*\*\*|---|$)/i, title: 'What You Can Do', icon: <Heart className="w-4 h-4" /> },
    ];

    for (const { pattern, title, icon } of sectionPatterns) {
      // Skip if we already have this section
      if (seenTitles.has(title)) continue;

      const match = text.match(pattern);
      if (match && match[1]) {
        const content = match[1].trim();
        if (content) {
          sections.push({ title, icon, content });
          seenTitles.add(title);
        }
      }
    }

    return sections;
  };

  const sections = guidance ? parseGuidance(guidance) : [];

  return (
    <div className="mt-6 bg-gradient-to-br from-slate-50 to-slate-100 dark:from-slate-800 dark:to-slate-700 rounded-xl p-5 border border-slate-200 dark:border-slate-600 shadow-sm">
      {/* Header */}
      <div className="flex items-center gap-2 mb-5">
        <div className="p-1.5 bg-brand-100 dark:bg-brand-900/40 rounded-lg">
          <Sparkles className="w-4 h-4 text-brand-600 dark:text-brand-400" />
        </div>
        <h4 className="font-semibold text-slate-900 dark:text-white">AI Health Guide</h4>
        <span className="text-xs bg-brand-100 dark:bg-brand-900/30 text-brand-700 dark:text-brand-300 px-2 py-0.5 rounded-full font-medium">
          Educational
        </span>
      </div>

      {/* Loading State */}
      {isLoading && (
        <div className="space-y-5 animate-pulse">
          {[1, 2, 3].map((i) => (
            <div key={i} className="space-y-2">
              <div className="h-4 bg-slate-200 dark:bg-slate-600 rounded w-1/4"></div>
              <div className="h-3 bg-slate-200 dark:bg-slate-600 rounded w-full"></div>
              <div className="h-3 bg-slate-200 dark:bg-slate-600 rounded w-5/6"></div>
            </div>
          ))}
        </div>
      )}

      {/* Error State */}
      {error && !isLoading && (
        <div className="flex items-center justify-between p-4 bg-red-50 dark:bg-red-900/20 rounded-lg border border-red-200 dark:border-red-800">
          <div className="flex items-center gap-3">
            <AlertCircle className="w-5 h-5 text-red-500 dark:text-red-400 flex-shrink-0" />
            <span className="text-sm text-red-700 dark:text-red-300">{error}</span>
          </div>
          <button
            onClick={handleRetry}
            className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-red-700 dark:text-red-300 bg-red-100 dark:bg-red-900/30 rounded-lg hover:bg-red-200 dark:hover:bg-red-900/50 transition-colors flex-shrink-0"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            Retry
          </button>
        </div>
      )}

      {/* Guidance Content */}
      {guidance && !isLoading && !error && sections.length > 0 && (
        <div className="space-y-5">
          {sections.map((section, idx) => (
            <div key={idx} className="group">
              <div className="flex items-center gap-2 mb-2">
                <span className="text-brand-500 dark:text-brand-400">{section.icon}</span>
                <h5 className="font-semibold text-sm text-slate-800 dark:text-slate-200">{section.title}</h5>
              </div>
              <div className="text-sm text-slate-600 dark:text-slate-400 pl-6">
                {renderMarkdown(section.content)}
              </div>
            </div>
          ))}

          {/* Single Disclaimer */}
          <div className="mt-5 pt-4 border-t border-slate-200 dark:border-slate-600">
            <p className="text-xs text-slate-500 dark:text-slate-400 italic flex items-start gap-2">
              <AlertCircle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
              <span>This information is for educational purposes only and is not medical advice. Please discuss your results with your healthcare provider.</span>
            </p>
          </div>
        </div>
      )}

      {/* Fallback if no sections parsed */}
      {guidance && !isLoading && !error && sections.length === 0 && (
        <div className="text-sm text-slate-600 dark:text-slate-400">
          {renderMarkdown(guidance)}

          {/* Single Disclaimer */}
          <div className="mt-5 pt-4 border-t border-slate-200 dark:border-slate-600">
            <p className="text-xs text-slate-500 dark:text-slate-400 italic flex items-start gap-2">
              <AlertCircle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
              <span>This information is for educational purposes only and is not medical advice. Please discuss your results with your healthcare provider.</span>
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
