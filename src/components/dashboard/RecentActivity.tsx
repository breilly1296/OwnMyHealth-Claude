/**
 * RecentActivity - Condensed data event feed for the dashboard overview.
 *
 * Pure derivation: reads biomarkers + insurancePlans arrays already in
 * Dashboard state and surfaces the most recent additions with relative
 * timestamps. No new API calls.
 */

import { useMemo } from 'react';
import { Activity, Shield, FileUp, ChevronRight, TestTube } from 'lucide-react';
import type { Biomarker, InsurancePlan } from '../../types';
import { isInRange } from '../../utils/biomarkers/trendCalculations';

interface RecentActivityProps {
  biomarkers: Biomarker[];
  insurancePlans: InsurancePlan[];
  onViewAll: () => void;
  onOpenAddMeasurement: () => void;
  maxItems?: number;
}

type ActivityItem =
  | {
      kind: 'biomarker';
      id: string;
      name: string;
      value: number;
      unit: string;
      inRange: boolean;
      at: number;
    }
  | {
      kind: 'insurance';
      id: string;
      planName: string;
      insurerName: string;
      at: number;
    };

const RELATIVE_UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ['year', 365 * 24 * 60 * 60 * 1000],
  ['month', 30 * 24 * 60 * 60 * 1000],
  ['week', 7 * 24 * 60 * 60 * 1000],
  ['day', 24 * 60 * 60 * 1000],
  ['hour', 60 * 60 * 1000],
  ['minute', 60 * 1000],
];

function formatRelative(timestamp: number): string {
  const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });
  const diffMs = timestamp - Date.now();
  const absDiff = Math.abs(diffMs);
  if (absDiff < 60 * 1000) return 'Just now';
  for (const [unit, ms] of RELATIVE_UNITS) {
    if (absDiff >= ms) {
      return rtf.format(Math.round(diffMs / ms), unit);
    }
  }
  return 'Just now';
}

function toTimestamp(dateLike: string | undefined): number | null {
  if (!dateLike) return null;
  const parsed = new Date(dateLike).getTime();
  return Number.isNaN(parsed) ? null : parsed;
}

export default function RecentActivity({
  biomarkers,
  insurancePlans,
  onViewAll,
  onOpenAddMeasurement,
  maxItems = 8,
}: RecentActivityProps) {
  const items = useMemo<ActivityItem[]>(() => {
    const biomarkerItems: ActivityItem[] = biomarkers
      .map((b): ActivityItem | null => {
        const at = toTimestamp(b.date);
        if (at === null) return null;
        return {
          kind: 'biomarker',
          id: b.id,
          name: b.name,
          value: b.value,
          unit: b.unit,
          inRange: isInRange(b.value, b),
          at,
        };
      })
      .filter((i): i is ActivityItem => i !== null);

    const planItems: ActivityItem[] = insurancePlans
      .map((p): ActivityItem | null => {
        const at =
          toTimestamp((p as unknown as { createdAt?: string }).createdAt) ??
          toTimestamp(p.uploadDate) ??
          toTimestamp(p.effectiveDate);
        if (at === null) return null;
        return {
          kind: 'insurance',
          id: p.id,
          planName: p.planName,
          insurerName: p.insurerName,
          at,
        };
      })
      .filter((i): i is ActivityItem => i !== null);

    return [...biomarkerItems, ...planItems]
      .sort((a, b) => b.at - a.at)
      .slice(0, maxItems);
  }, [biomarkers, insurancePlans, maxItems]);

  if (items.length === 0) {
    return (
      <section className="mb-8">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-slate-900 dark:text-white">Recent activity</h2>
        </div>
        <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200/60 dark:border-slate-700 p-6 text-center">
          <Activity className="w-10 h-10 mx-auto mb-3 text-slate-300 dark:text-slate-600" />
          <p className="text-sm text-slate-500 dark:text-slate-400 mb-4">
            No recent activity — upload a lab report to get started.
          </p>
          <button
            onClick={onOpenAddMeasurement}
            className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-medium text-white bg-brand-600 hover:bg-brand-700 rounded-xl transition-colors"
          >
            <FileUp className="w-4 h-4" />
            Add Data
          </button>
        </div>
      </section>
    );
  }

  return (
    <section className="mb-8">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold text-slate-900 dark:text-white">Recent activity</h2>
        <button
          onClick={onViewAll}
          className="inline-flex items-center gap-1 text-sm text-brand-600 dark:text-brand-400 hover:text-brand-700 dark:hover:text-brand-300 transition-colors"
        >
          View all
          <ChevronRight className="w-4 h-4" />
        </button>
      </div>

      {/* Mobile: horizontal scroll cards */}
      <div className="flex md:hidden gap-3 overflow-x-auto pb-2 -mx-4 px-4 snap-x">
        {items.map((item) => (
          <ActivityCard key={`${item.kind}-${item.id}`} item={item} />
        ))}
      </div>

      {/* Desktop: compact vertical list */}
      <ul className="hidden md:flex flex-col divide-y divide-slate-200 dark:divide-slate-700 bg-white dark:bg-slate-800 rounded-2xl border border-slate-200/60 dark:border-slate-700 overflow-hidden">
        {items.map((item) => (
          <ActivityRow key={`${item.kind}-${item.id}`} item={item} />
        ))}
      </ul>
    </section>
  );
}

function ActivityIcon({ item }: { item: ActivityItem }) {
  if (item.kind === 'biomarker') {
    return (
      <div className="w-9 h-9 rounded-xl bg-brand-50 dark:bg-brand-900/30 flex items-center justify-center flex-shrink-0">
        <TestTube className="w-4 h-4 text-brand-600 dark:text-brand-400" />
      </div>
    );
  }
  return (
    <div className="w-9 h-9 rounded-xl bg-purple-50 dark:bg-purple-900/30 flex items-center justify-center flex-shrink-0">
      <Shield className="w-4 h-4 text-purple-600 dark:text-purple-400" />
    </div>
  );
}

function ActivityDescription({ item }: { item: ActivityItem }) {
  if (item.kind === 'biomarker') {
    return (
      <>
        <span className="font-medium">{item.name}</span>
        <span className="text-slate-500 dark:text-slate-400"> — {item.value} {item.unit}</span>
      </>
    );
  }
  return (
    <>
      <span className="font-medium">Insurance plan uploaded</span>
      <span className="text-slate-500 dark:text-slate-400"> — {item.insurerName} {item.planName}</span>
    </>
  );
}

function StatusBadge({ item }: { item: ActivityItem }) {
  if (item.kind !== 'biomarker') return null;
  return (
    <span
      className={`px-2 py-0.5 rounded-full text-xs font-medium flex-shrink-0 ${
        item.inRange
          ? 'bg-wellness-100 dark:bg-wellness-900/30 text-wellness-700 dark:text-wellness-400'
          : 'bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400'
      }`}
    >
      {item.inRange ? 'In range' : 'Out of range'}
    </span>
  );
}

function ActivityRow({ item }: { item: ActivityItem }) {
  return (
    <li className="flex items-center gap-3 px-4 py-3 hover:bg-slate-50 dark:hover:bg-slate-900/40 transition-colors">
      <ActivityIcon item={item} />
      <div className="flex-1 min-w-0">
        <p className="text-sm text-slate-900 dark:text-white truncate">
          <ActivityDescription item={item} />
        </p>
        <p className="text-xs text-slate-400 dark:text-slate-500 mt-0.5">{formatRelative(item.at)}</p>
      </div>
      <StatusBadge item={item} />
    </li>
  );
}

function ActivityCard({ item }: { item: ActivityItem }) {
  return (
    <div className="snap-start flex-shrink-0 w-64 bg-white dark:bg-slate-800 rounded-2xl border border-slate-200/60 dark:border-slate-700 p-4">
      <div className="flex items-start gap-3 mb-3">
        <ActivityIcon item={item} />
        <StatusBadge item={item} />
      </div>
      <p className="text-sm text-slate-900 dark:text-white">
        <ActivityDescription item={item} />
      </p>
      <p className="text-xs text-slate-400 dark:text-slate-500 mt-1">{formatRelative(item.at)}</p>
    </div>
  );
}
