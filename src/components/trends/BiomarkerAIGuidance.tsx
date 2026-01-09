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
 * - Formatted markdown-like sections
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

    // Define section patterns and their icons
    const sectionPatterns = [
      { pattern: /\*\*What This Measures\*\*\s*([\s\S]*?)(?=\*\*|$)/i, title: 'What This Measures', icon: <BookOpen className="w-4 h-4" /> },
      { pattern: /\*\*Understanding Your Result\*\*\s*([\s\S]*?)(?=\*\*|$)/i, title: 'Understanding Your Result', icon: <Stethoscope className="w-4 h-4" /> },
      { pattern: /\*\*Trend Summary\*\*\s*([\s\S]*?)(?=\*\*|$)/i, title: 'Trend Summary', icon: <TrendingUp className="w-4 h-4" /> },
      { pattern: /\*\*Questions for Your Doctor\*\*\s*([\s\S]*?)(?=\*\*|$)/i, title: 'Questions for Your Doctor', icon: <MessageCircle className="w-4 h-4" /> },
      { pattern: /\*\*What You Can Do\*\*\s*([\s\S]*?)(?=\*\*|---|$)/i, title: 'What You Can Do', icon: <Heart className="w-4 h-4" /> },
      // Legacy pattern for backward compatibility
      { pattern: /\*\*General Wellness(?:\s*Information)?\*\*\s*([\s\S]*?)(?=\*\*|---|$)/i, title: 'What You Can Do', icon: <Heart className="w-4 h-4" /> },
    ];

    for (const { pattern, title, icon } of sectionPatterns) {
      const match = text.match(pattern);
      if (match && match[1]) {
        const content = match[1].trim();
        if (content) {
          sections.push({ title, icon, content });
        }
      }
    }

    return sections;
  };

  const sections = guidance ? parseGuidance(guidance) : [];

  return (
    <div className="mt-6 bg-gradient-to-br from-slate-50 to-slate-100 dark:from-slate-800 dark:to-slate-700 rounded-xl p-5 border border-slate-200 dark:border-slate-600">
      {/* Header */}
      <div className="flex items-center gap-2 mb-4">
        <Sparkles className="w-5 h-5 text-brand-500" />
        <h4 className="font-semibold text-slate-900 dark:text-white">AI Health Guide</h4>
        <span className="text-xs bg-brand-100 dark:bg-brand-900/30 text-brand-700 dark:text-brand-300 px-2 py-0.5 rounded-full">
          Educational
        </span>
      </div>

      {/* Loading State */}
      {isLoading && (
        <div className="space-y-4 animate-pulse">
          <div className="space-y-2">
            <div className="h-4 bg-slate-200 dark:bg-slate-600 rounded w-1/4"></div>
            <div className="h-3 bg-slate-200 dark:bg-slate-600 rounded w-3/4"></div>
            <div className="h-3 bg-slate-200 dark:bg-slate-600 rounded w-full"></div>
            <div className="h-3 bg-slate-200 dark:bg-slate-600 rounded w-5/6"></div>
          </div>
          <div className="space-y-2">
            <div className="h-4 bg-slate-200 dark:bg-slate-600 rounded w-1/3"></div>
            <div className="h-3 bg-slate-200 dark:bg-slate-600 rounded w-full"></div>
            <div className="h-3 bg-slate-200 dark:bg-slate-600 rounded w-4/5"></div>
          </div>
          <div className="space-y-2">
            <div className="h-4 bg-slate-200 dark:bg-slate-600 rounded w-1/4"></div>
            <div className="h-3 bg-slate-200 dark:bg-slate-600 rounded w-2/3"></div>
          </div>
        </div>
      )}

      {/* Error State */}
      {error && !isLoading && (
        <div className="flex items-center justify-between p-4 bg-red-50 dark:bg-red-900/20 rounded-lg border border-red-200 dark:border-red-800">
          <div className="flex items-center gap-3">
            <AlertCircle className="w-5 h-5 text-red-500 dark:text-red-400" />
            <span className="text-sm text-red-700 dark:text-red-300">{error}</span>
          </div>
          <button
            onClick={handleRetry}
            className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-red-700 dark:text-red-300 bg-red-100 dark:bg-red-900/30 rounded-lg hover:bg-red-200 dark:hover:bg-red-900/50 transition-colors"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            Retry
          </button>
        </div>
      )}

      {/* Guidance Content */}
      {guidance && !isLoading && !error && (
        <div className="space-y-4">
          {sections.map((section, idx) => (
            <div key={idx} className="space-y-2">
              <div className="flex items-center gap-2 text-slate-700 dark:text-slate-300">
                <span className="text-brand-500 dark:text-brand-400">{section.icon}</span>
                <h5 className="font-medium text-sm">{section.title}</h5>
              </div>
              <div className="text-sm text-slate-600 dark:text-slate-400 leading-relaxed pl-6">
                {section.title === 'Questions for Your Doctor' ? (
                  <ul className="space-y-1.5 list-disc list-inside">
                    {section.content.split('\n').filter(line => line.trim().startsWith('-')).map((line, i) => (
                      <li key={i} className="text-slate-600 dark:text-slate-400">
                        {line.replace(/^-\s*/, '').trim()}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p>{section.content.replace(/^-\s*/gm, '').trim()}</p>
                )}
              </div>
            </div>
          ))}

          {/* Disclaimer */}
          <div className="mt-4 pt-4 border-t border-slate-200 dark:border-slate-600">
            <p className="text-xs text-slate-500 dark:text-slate-400 italic">
              This information is for educational purposes only and is not medical advice. Please discuss your results with your healthcare provider.
            </p>
          </div>
        </div>
      )}

      {/* Empty state if no sections parsed but guidance exists */}
      {guidance && !isLoading && !error && sections.length === 0 && (
        <div className="text-sm text-slate-600 dark:text-slate-400 leading-relaxed whitespace-pre-wrap">
          {guidance}
          <div className="mt-4 pt-4 border-t border-slate-200 dark:border-slate-600">
            <p className="text-xs text-slate-500 dark:text-slate-400 italic">
              This information is for educational purposes only and is not medical advice. Please discuss your results with your healthcare provider.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
