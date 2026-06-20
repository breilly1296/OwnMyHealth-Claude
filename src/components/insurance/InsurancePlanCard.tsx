/**
 * InsurancePlanCard - single-plan summary card rendered on the Plans tab.
 *
 * Extracted from InsuranceHub. Shows plan header, deductible/OOP progress,
 * quick-view copay grid, and (optionally) a delete action. All dollar
 * values render as "--" when missing to match the design guideline.
 */

import React from 'react';
import {
  Shield,
  Trash2,
  ChevronRight,
  Stethoscope,
  UserCheck,
  Ambulance,
  Pill,
  AlertTriangle,
  Clock,
} from 'lucide-react';
import type { InsurancePlan } from '../../types';
import { formatCurrency, formatCopay, formatPercent } from './planFormatters';

interface InsurancePlanCardProps {
  plan: InsurancePlan;
  onSelect: (plan: InsurancePlan) => void;
  onDelete?: (plan: InsurancePlan) => void;
  isDeleting?: boolean;
}

const PLAN_TYPE_BADGE: Record<InsurancePlan['planType'], string> = {
  HMO: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300',
  PPO: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300',
  EPO: 'bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-300',
  POS: 'bg-indigo-100 text-indigo-800 dark:bg-indigo-900/30 dark:text-indigo-300',
  HDHP: 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300',
  Other: 'bg-slate-100 text-slate-800 dark:bg-slate-700 dark:text-slate-200',
};

function formatRelativeDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

function ProgressBar({
  label,
  met,
  max,
  fillClass,
}: {
  label: string;
  met: number | undefined | null;
  max: number | undefined | null;
  fillClass: string;
}) {
  const hasMax = typeof max === 'number' && max > 0;
  const metSafe = typeof met === 'number' ? met : 0;
  const percent = hasMax ? Math.min(100, Math.max(0, (metSafe / max!) * 100)) : 0;

  return (
    <div>
      <div className="flex justify-between items-center mb-1.5">
        <p className="text-xs text-slate-400 dark:text-slate-500">{label}</p>
        <p className="text-xs font-medium text-slate-600 dark:text-slate-300">
          {formatCurrency(met)} / {formatCurrency(max)} met
        </p>
      </div>
      <div className="h-1 bg-slate-200 dark:bg-slate-700 rounded-full overflow-hidden">
        <div
          className={`h-full ${fillClass} rounded-full transition-all`}
          style={{ width: `${percent}%` }}
        />
      </div>
    </div>
  );
}

export default function InsurancePlanCard({
  plan,
  onSelect,
  onDelete,
  isDeleting,
}: InsurancePlanCardProps) {
  const hasSpendingData =
    typeof plan.deductibleMetIndividual === 'number' ||
    typeof plan.oopMetIndividual === 'number';

  const hasDeductibleTarget = typeof plan.deductibleIndividual === 'number' && plan.deductibleIndividual > 0;
  const hasOopTarget = typeof plan.oopMaxIndividual === 'number' && plan.oopMaxIndividual > 0;
  const priorAuthCount = plan.benefits?.filter((b) => b.priorAuthRequired).length ?? 0;

  const handleCardClick = () => onSelect(plan);
  const handleDeleteClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    onDelete?.(plan);
  };

  return (
    <div
      // A11Y-4: this card opens plan details on click. It nests action buttons
      // (delete) and inline triggers, so it can't be a <button>; expose it as a
      // keyboard-operable button instead.
      role="button"
      tabIndex={0}
      aria-label={`${plan.planName}, ${plan.insurerName}`}
      onClick={handleCardClick}
      onKeyDown={(e) => {
        // Only the card itself opens details — a keystroke on a nested button
        // (delete / update link) must not bubble up and also open details
        // (those only stopPropagation on click, not keydown).
        if (e.target !== e.currentTarget) return;
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          handleCardClick();
        }
      }}
      className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200/60 dark:border-slate-700 p-6 hover:border-blue-200 dark:hover:border-blue-500 transition-all cursor-pointer group focus:outline-none focus-visible:ring-2 focus-visible:ring-red-400"
    >
      <div className="flex items-start justify-between">
        <div className="flex items-start gap-4">
          <div className="w-12 h-12 bg-gradient-to-br from-blue-500 to-indigo-600 rounded-xl flex items-center justify-center flex-shrink-0">
            <Shield className="w-6 h-6 text-white" />
          </div>
          <div>
            <h3 className="font-semibold text-slate-900 dark:text-white mb-1">{plan.planName}</h3>
            <p className="text-sm text-slate-500 dark:text-slate-400 mb-3">{plan.insurerName}</p>
            <div className="flex items-center gap-3 flex-wrap">
              <span
                className={`text-xs font-medium px-2.5 py-1 rounded-lg ${PLAN_TYPE_BADGE[plan.planType] ?? PLAN_TYPE_BADGE.Other}`}
              >
                {plan.planType}
              </span>
              <span className="text-xs text-slate-400 dark:text-slate-500 inline-flex items-center gap-1">
                <Clock className="w-3 h-3" />
                Effective {formatRelativeDate(plan.effectiveDate)}
              </span>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {onDelete && (
            <button
              onClick={handleDeleteClick}
              disabled={isDeleting}
              className="p-2 text-slate-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg transition-colors opacity-0 group-hover:opacity-100 focus-visible:opacity-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-red-400 disabled:opacity-50"
              title="Delete plan"
              aria-label="Delete plan"
            >
              <Trash2 className="w-4 h-4" />
            </button>
          )}
          <ChevronRight className="w-5 h-5 text-slate-300 dark:text-slate-600 group-hover:text-blue-500 dark:group-hover:text-blue-400 transition-colors" />
        </div>
      </div>

      {/* Deductible & OOP Progress */}
      <div className="mt-5 pt-5 border-t border-slate-100 dark:border-slate-700">
        {hasSpendingData ? (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {hasDeductibleTarget && (
              <ProgressBar
                label="Deductible"
                met={plan.deductibleMetIndividual}
                max={plan.deductibleIndividual}
                fillClass="bg-green-500"
              />
            )}
            {hasOopTarget && (
              <ProgressBar
                label="Out-of-pocket"
                met={plan.oopMetIndividual}
                max={plan.oopMaxIndividual}
                fillClass="bg-blue-500"
              />
            )}
          </div>
        ) : (
          <p className="text-xs text-slate-400 dark:text-slate-500">
            Not tracking spending —{' '}
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onSelect(plan);
              }}
              className="underline cursor-pointer hover:text-brand-500 dark:hover:text-brand-400 focus:outline-none focus-visible:ring-2 focus-visible:ring-red-400 rounded"
            >
              update in plan details
            </button>
          </p>
        )}
      </div>

      {/* Copay Quick View */}
      <div className="mt-4 pt-4 border-t border-slate-100 dark:border-slate-700">
        <p className="text-xs text-slate-400 dark:text-slate-500 mb-3">Quick Coverage</p>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          <div className="text-center p-2 bg-slate-50 dark:bg-slate-900/50 rounded-lg">
            <Stethoscope className="w-4 h-4 mx-auto text-blue-500 mb-1" />
            <p className="text-xs text-slate-500 dark:text-slate-400">Primary</p>
            <p className="text-sm font-semibold text-slate-900 dark:text-white">
              {formatCopay(plan.copayPrimaryCare)}
            </p>
          </div>
          <div className="text-center p-2 bg-slate-50 dark:bg-slate-900/50 rounded-lg">
            <UserCheck className="w-4 h-4 mx-auto text-purple-500 mb-1" />
            <p className="text-xs text-slate-500 dark:text-slate-400">Specialist</p>
            <p className="text-sm font-semibold text-slate-900 dark:text-white">
              {formatCopay(plan.copaySpecialist)}
            </p>
          </div>
          <div className="text-center p-2 bg-slate-50 dark:bg-slate-900/50 rounded-lg">
            <Ambulance className="w-4 h-4 mx-auto text-red-500 mb-1" />
            <p className="text-xs text-slate-500 dark:text-slate-400">Emergency</p>
            <p className="text-sm font-semibold text-slate-900 dark:text-white">
              {formatCopay(plan.copayEmergency)}
            </p>
          </div>
          <div className="text-center p-2 bg-slate-50 dark:bg-slate-900/50 rounded-lg">
            <Pill className="w-4 h-4 mx-auto text-green-500 mb-1" />
            <p className="text-xs text-slate-500 dark:text-slate-400">Coinsurance</p>
            <p className="text-sm font-semibold text-slate-900 dark:text-white">
              {formatPercent(plan.coinsuranceRate)}
            </p>
          </div>
        </div>
      </div>

      {/* Prior Auth Warning */}
      {priorAuthCount > 0 && (
        <div className="mt-3 flex items-center gap-2 text-xs text-amber-600 dark:text-amber-400">
          <AlertTriangle className="w-3.5 h-3.5" />
          <span>
            {priorAuthCount} service{priorAuthCount !== 1 ? 's' : ''} require prior authorization
          </span>
        </div>
      )}
    </div>
  );
}
