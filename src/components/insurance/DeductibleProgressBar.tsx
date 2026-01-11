/**
 * DeductibleProgressBar - Visual tracker for deductible and OOP progress
 *
 * Displays a progress bar showing how much of the deductible and
 * out-of-pocket maximum has been met for the year.
 */

import React from 'react';
import { TrendingUp, CheckCircle } from 'lucide-react';

interface DeductibleProgressBarProps {
  label: string;
  current: number;
  total: number;
  type: 'deductible' | 'oop';
  className?: string;
}

export default function DeductibleProgressBar({
  label,
  current,
  total,
  type,
  className = '',
}: DeductibleProgressBarProps) {
  const percentage = total > 0 ? Math.min((current / total) * 100, 100) : 0;
  const remaining = Math.max(total - current, 0);
  const isMet = current >= total;

  // Color scheme based on type and progress
  const getColorClasses = () => {
    if (isMet) {
      return {
        bar: 'bg-green-500',
        bg: 'bg-green-100 dark:bg-green-900/20',
        text: 'text-green-700 dark:text-green-400',
        badge: 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400',
      };
    }

    if (type === 'deductible') {
      return {
        bar: 'bg-blue-500',
        bg: 'bg-blue-100 dark:bg-blue-900/20',
        text: 'text-blue-700 dark:text-blue-400',
        badge: 'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400',
      };
    }

    return {
      bar: 'bg-purple-500',
      bg: 'bg-purple-100 dark:bg-purple-900/20',
      text: 'text-purple-700 dark:text-purple-400',
      badge: 'bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-400',
    };
  };

  const colors = getColorClasses();

  return (
    <div className={`space-y-2 ${className}`}>
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          {isMet ? (
            <CheckCircle className={`w-4 h-4 ${colors.text}`} />
          ) : (
            <TrendingUp className={`w-4 h-4 ${colors.text}`} />
          )}
          <span className="text-sm font-medium text-gray-700 dark:text-slate-300">
            {label}
          </span>
        </div>
        <span className={`text-xs font-semibold px-2 py-1 rounded ${colors.badge}`}>
          {percentage.toFixed(0)}%
        </span>
      </div>

      {/* Progress Bar */}
      <div className={`h-3 rounded-full overflow-hidden ${colors.bg}`}>
        <div
          className={`h-full ${colors.bar} transition-all duration-500 ease-out`}
          style={{ width: `${percentage}%` }}
        />
      </div>

      {/* Stats */}
      <div className="flex items-center justify-between text-xs">
        <div className="flex items-center gap-1">
          <span className="text-gray-600 dark:text-slate-400">Current:</span>
          <span className="font-semibold text-gray-900 dark:text-white">
            ${current.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </span>
        </div>
        <div className="flex items-center gap-1">
          {isMet ? (
            <span className={`font-semibold ${colors.text}`}>Met!</span>
          ) : (
            <>
              <span className="text-gray-600 dark:text-slate-400">Remaining:</span>
              <span className="font-semibold text-gray-900 dark:text-white">
                ${remaining.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </span>
            </>
          )}
        </div>
      </div>

      {/* Total */}
      <div className="text-xs text-gray-500 dark:text-slate-500">
        of ${total.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} total
      </div>
    </div>
  );
}
