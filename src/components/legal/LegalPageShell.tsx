/**
 * LegalPageShell - shared dark-themed layout for the static Privacy / Terms pages.
 * Public (no auth). Renders a header with a back-to-app link, a draft-review banner,
 * the "last updated" line, and the page body.
 */
import React from 'react';
import { Heart, ArrowLeft, AlertTriangle } from 'lucide-react';
import { LEGAL_LAST_UPDATED } from '../../constants/legal';

interface LegalPageShellProps {
  title: string;
  onBack: () => void;
  children: React.ReactNode;
}

export default function LegalPageShell({ title, onBack, children }: LegalPageShellProps) {
  return (
    <div className="min-h-screen bg-slate-950 flex flex-col">
      <header className="p-6 border-b border-slate-800">
        <div className="max-w-3xl mx-auto flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-gradient-to-br from-brand-500 to-brand-600 rounded-xl flex items-center justify-center shadow-lg shadow-brand-500/25">
              <Heart className="w-5 h-5 text-white" />
            </div>
            <span className="text-xl font-bold text-white">OwnMyHealth</span>
          </div>
          <button
            type="button"
            onClick={onBack}
            className="inline-flex items-center gap-2 text-sm font-medium text-brand-400 hover:text-brand-300 transition-colors"
          >
            <ArrowLeft className="w-4 h-4" />
            Back to app
          </button>
        </div>
      </header>

      <main id="main-content" className="flex-1 px-4 py-10">
        <div className="max-w-3xl mx-auto">
          <h1 className="text-3xl font-bold text-white mb-1">{title}</h1>
          <p className="text-sm text-slate-500 mb-6">Last updated: {LEGAL_LAST_UPDATED}</p>

          {/* DRAFT banner — this content is a factual, engineering-accurate draft and is
              NOT a substitute for review by qualified legal counsel before launch. */}
          <div className="mb-8 p-4 rounded-xl border border-amber-500/30 bg-amber-500/10 flex items-start gap-3">
            <AlertTriangle className="w-5 h-5 text-amber-400 flex-shrink-0 mt-0.5" />
            <p className="text-sm text-amber-200/90">
              <strong>Draft for review.</strong> This document is a working draft prepared from the
              product&apos;s actual data practices. It must be reviewed and finalized by qualified
              legal counsel before public launch.
            </p>
          </div>

          <div className="space-y-6 text-slate-300 leading-relaxed [&_h2]:text-xl [&_h2]:font-semibold [&_h2]:text-white [&_h2]:mt-8 [&_h2]:mb-2 [&_h3]:text-base [&_h3]:font-semibold [&_h3]:text-slate-100 [&_h3]:mt-4 [&_ul]:list-disc [&_ul]:pl-6 [&_ul]:space-y-1 [&_a]:text-cyan-400 [&_a]:underline hover:[&_a]:text-cyan-300">
            {children}
          </div>
        </div>
      </main>
    </div>
  );
}
