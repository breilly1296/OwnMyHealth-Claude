/**
 * BiomarkerAIGuidance Component
 *
 * Displays AI-powered educational guidance for a biomarker.
 * Collapsible sections with "Show More" for additional details.
 *
 * @module components/trends/BiomarkerAIGuidance
 */

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Sparkles, AlertCircle, RefreshCw, BookOpen, Stethoscope, TrendingUp, MessageCircle, Heart, ChevronDown, ChevronUp } from 'lucide-react';
import type { Biomarker } from '../../types';
import { biomarkersApi } from '../../services/api';

interface BiomarkerAIGuidanceProps {
  biomarker: Biomarker;
  allBiomarkers: Biomarker[];
}

interface GuidanceSection {
  title: string;
  icon: React.ReactNode;
  content: string;
  isDefault: boolean; // Show by default or in "Show More"
}

// Cache for guidance to avoid re-fetching
const guidanceCache = new Map<string, string>();

/**
 * Parse markdown text into React elements
 * Handles: # headings, ## subheadings, **bold**, *italic*, bullet lists, numbered lists
 */
function renderMarkdown(text: string): React.ReactNode {
  // Remove disclaimer text from AI response
  const disclaimerPatterns = [
    /---[\s\S]*$/i,
    /\*?\*?disclaimer\*?\*?:?[\s\S]*$/i,
    /please consult[\s\S]*healthcare provider[\s\S]*$/i,
    /this information is for educational purposes[\s\S]*$/i,
    /always consult[\s\S]*doctor[\s\S]*$/i,
    /consult your (healthcare provider|doctor|physician)[\s\S]*$/i,
  ];

  let cleanedText = text;
  for (const pattern of disclaimerPatterns) {
    cleanedText = cleanedText.replace(pattern, '').trim();
  }

  const lines = cleanedText.split('\n');
  const elements: React.ReactNode[] = [];
  let currentList: { type: 'ul' | 'ol'; items: React.ReactNode[] } | null = null;
  let key = 0;

  const processInlineMarkdown = (line: string): React.ReactNode => {
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
        parts.push(<strong key={partKey++} className="font-semibold text-slate-700 dark:text-slate-200">{boldMatch[1]}</strong>);
        remaining = remaining.slice(boldMatch.index! + boldMatch[0].length);
      } else if (italicMatch) {
        if (italicMatch.index! > 0) {
          parts.push(<span key={partKey++}>{remaining.slice(0, italicMatch.index)}</span>);
        }
        parts.push(<em key={partKey++} className="italic">{italicMatch[1]}</em>);
        remaining = remaining.slice(italicMatch.index! + italicMatch[0].length);
      } else {
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
    }
  };

  for (const line of lines) {
    const trimmedLine = line.trim();

    if (!trimmedLine) {
      flushList();
      continue;
    }

    // Check for ## subheading
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

    // Check for # heading
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

    // Check for bullet list
    const bulletMatch = trimmedLine.match(/^[-*•]\s+(.+)$/);
    if (bulletMatch) {
      if (!currentList || currentList.type !== 'ul') {
        flushList();
        currentList = { type: 'ul', items: [] };
      }
      currentList.items.push(processInlineMarkdown(bulletMatch[1]));
      continue;
    }

    // Check for numbered list
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
      <p key={key++} className="leading-relaxed">
        {processInlineMarkdown(trimmedLine)}
      </p>
    );
  }

  flushList();
  return <div className="space-y-1">{elements}</div>;
}

export default function BiomarkerAIGuidance({ biomarker, allBiomarkers }: BiomarkerAIGuidanceProps) {
  const [guidance, setGuidance] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isExpanded, setIsExpanded] = useState(false);
  const isMountedRef = useRef(true);

  const fetchGuidance = useCallback(async (skipCache = false) => {
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
        guidanceCache.set(cacheKey, result.guidance);
        setGuidance(result.guidance);
      }
    } catch (err) {
      if (isMountedRef.current) {
        setError(err instanceof Error ? err.message : 'Unable to load guidance.');
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
    return () => { isMountedRef.current = false; };
  }, [fetchGuidance]);

  const handleRetry = () => {
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

    const sectionPatterns = [
      { pattern: /(?:^|\n)\s*\d*\.?\s*\*\*What This Measures\*\*:?\s*([\s\S]*?)(?=\n\s*\d*\.?\s*\*\*|$)/i, title: 'What This Measures', icon: <BookOpen className="w-4 h-4" />, isDefault: true },
      { pattern: /(?:^|\n)\s*\d*\.?\s*\*\*Understanding Your Result\*\*:?\s*([\s\S]*?)(?=\n\s*\d*\.?\s*\*\*|$)/i, title: 'Understanding Your Result', icon: <Stethoscope className="w-4 h-4" />, isDefault: true },
      { pattern: /(?:^|\n)\s*\d*\.?\s*\*\*Trend Summary\*\*:?\s*([\s\S]*?)(?=\n\s*\d*\.?\s*\*\*|$)/i, title: 'Trend Summary', icon: <TrendingUp className="w-4 h-4" />, isDefault: false },
      { pattern: /(?:^|\n)\s*\d*\.?\s*\*\*Questions for Your Doctor\*\*:?\s*([\s\S]*?)(?=\n\s*\d*\.?\s*\*\*|$)/i, title: 'Questions for Your Doctor', icon: <MessageCircle className="w-4 h-4" />, isDefault: false },
      { pattern: /(?:^|\n)\s*\d*\.?\s*\*\*What You Can Do\*\*:?\s*([\s\S]*?)(?=\n\s*\d*\.?\s*\*\*|---|$)/i, title: 'What You Can Do', icon: <Heart className="w-4 h-4" />, isDefault: false },
      { pattern: /(?:^|\n)\s*\d*\.?\s*\*\*General Wellness(?:\s*Information)?\*\*:?\s*([\s\S]*?)(?=\n\s*\d*\.?\s*\*\*|---|$)/i, title: 'What You Can Do', icon: <Heart className="w-4 h-4" />, isDefault: false },
    ];

    for (const { pattern, title, icon, isDefault } of sectionPatterns) {
      if (seenTitles.has(title)) continue;
      const match = text.match(pattern);
      if (match && match[1]?.trim()) {
        sections.push({ title, icon, content: match[1].trim(), isDefault });
        seenTitles.add(title);
      }
    }

    return sections;
  };

  const sections = guidance ? parseGuidance(guidance) : [];
  const defaultSections = sections.filter(s => s.isDefault);
  const extraSections = sections.filter(s => !s.isDefault);
  const hasMoreSections = extraSections.length > 0;

  return (
    <div className="mt-4 bg-gradient-to-br from-slate-50 to-slate-100 dark:from-slate-800 dark:to-slate-700 rounded-xl p-4 border border-slate-200 dark:border-slate-600">
      {/* Header */}
      <div className="flex items-center gap-2 mb-4">
        <div className="p-1 bg-brand-100 dark:bg-brand-900/40 rounded-md">
          <Sparkles className="w-3.5 h-3.5 text-brand-600 dark:text-brand-400" />
        </div>
        <h4 className="font-semibold text-sm text-slate-900 dark:text-white">AI Health Guide</h4>
        <span className="text-[10px] bg-brand-100 dark:bg-brand-900/30 text-brand-700 dark:text-brand-300 px-1.5 py-0.5 rounded-full font-medium">
          Educational
        </span>
      </div>

      {/* Loading State */}
      {isLoading && (
        <div className="space-y-4 animate-pulse">
          {[1, 2].map((i) => (
            <div key={i} className="space-y-2">
              <div className="h-3 bg-slate-200 dark:bg-slate-600 rounded w-1/4"></div>
              <div className="h-2.5 bg-slate-200 dark:bg-slate-600 rounded w-full"></div>
              <div className="h-2.5 bg-slate-200 dark:bg-slate-600 rounded w-4/5"></div>
            </div>
          ))}
        </div>
      )}

      {/* Error State */}
      {error && !isLoading && (
        <div className="flex items-center justify-between p-3 bg-red-50 dark:bg-red-900/20 rounded-lg border border-red-200 dark:border-red-800">
          <div className="flex items-center gap-2">
            <AlertCircle className="w-4 h-4 text-red-500 dark:text-red-400" />
            <span className="text-xs text-red-700 dark:text-red-300">{error}</span>
          </div>
          <button
            onClick={handleRetry}
            className="flex items-center gap-1 px-2 py-1 text-xs font-medium text-red-700 dark:text-red-300 bg-red-100 dark:bg-red-900/30 rounded hover:bg-red-200 dark:hover:bg-red-900/50 transition-colors"
          >
            <RefreshCw className="w-3 h-3" />
            Retry
          </button>
        </div>
      )}

      {/* Guidance Content */}
      {guidance && !isLoading && !error && sections.length > 0 && (
        <div className="space-y-4">
          {/* Default sections (always visible) */}
          {defaultSections.map((section, idx) => (
            <div key={idx}>
              <div className="flex items-center gap-1.5 mb-1.5">
                <span className="text-brand-500 dark:text-brand-400">{section.icon}</span>
                <h5 className="font-medium text-xs text-slate-700 dark:text-slate-300">{section.title}</h5>
              </div>
              <div className="text-sm text-slate-600 dark:text-slate-400 pl-5">
                {renderMarkdown(section.content)}
              </div>
            </div>
          ))}

          {/* Expandable sections */}
          {hasMoreSections && (
            <>
              {isExpanded && (
                <div className="space-y-4 pt-2 border-t border-slate-200 dark:border-slate-600">
                  {extraSections.map((section, idx) => (
                    <div key={idx}>
                      <div className="flex items-center gap-1.5 mb-1.5">
                        <span className="text-brand-500 dark:text-brand-400">{section.icon}</span>
                        <h5 className="font-medium text-xs text-slate-700 dark:text-slate-300">{section.title}</h5>
                      </div>
                      <div className="text-sm text-slate-600 dark:text-slate-400 pl-5">
                        {renderMarkdown(section.content)}
                      </div>
                    </div>
                  ))}
                </div>
              )}

              <button
                onClick={() => setIsExpanded(!isExpanded)}
                className="flex items-center gap-1 text-xs font-medium text-brand-600 dark:text-brand-400 hover:text-brand-700 dark:hover:text-brand-300 transition-colors mt-2"
              >
                {isExpanded ? (
                  <>
                    <ChevronUp className="w-3.5 h-3.5" />
                    Show Less
                  </>
                ) : (
                  <>
                    <ChevronDown className="w-3.5 h-3.5" />
                    Show More ({extraSections.length})
                  </>
                )}
              </button>
            </>
          )}

          {/* Disclaimer */}
          <div className="pt-3 border-t border-slate-200 dark:border-slate-600">
            <p className="text-[10px] text-slate-400 dark:text-slate-500 italic">
              For educational purposes only. Discuss results with your healthcare provider.
            </p>
          </div>
        </div>
      )}

      {/* Fallback */}
      {guidance && !isLoading && !error && sections.length === 0 && (
        <div className="text-sm text-slate-600 dark:text-slate-400">
          {renderMarkdown(guidance)}
          <div className="pt-3 mt-3 border-t border-slate-200 dark:border-slate-600">
            <p className="text-[10px] text-slate-400 dark:text-slate-500 italic">
              For educational purposes only. Discuss results with your healthcare provider.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
