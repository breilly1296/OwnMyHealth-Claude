/**
 * InsuranceStatsGrid - top-of-hub stats cards.
 *
 * Four computed stats: active plan count, total covered services (from
 * benefits), estimated annual cost (first cost projection in the guide),
 * total potential savings (sum of optimization tip savings).
 */

import { useMemo } from 'react';
import { Shield, CheckCircle, DollarSign, TrendingDown } from 'lucide-react';
import type { InsurancePlan, PersonalizedInsuranceGuide } from '../../types';
import { formatCurrency } from './InsurancePlanCard';

interface InsuranceStatsGridProps {
  plans: InsurancePlan[];
  guide?: PersonalizedInsuranceGuide;
}

export default function InsuranceStatsGrid({ plans, guide }: InsuranceStatsGridProps) {
  const stats = useMemo(() => {
    const activeCount = plans.length;
    const coveredServices = plans.reduce((sum, p) => sum + (p.benefits?.length || 0), 0);

    const firstProjection = guide?.costProjections?.[0];
    const estimatedAnnualCost = firstProjection?.estimatedCosts.total;

    const totalSavings = (guide?.optimizationTips || [])
      .filter((tip) => typeof tip.potentialSavings === 'number')
      .reduce((sum, tip) => sum + (tip.potentialSavings || 0), 0);

    return { activeCount, coveredServices, estimatedAnnualCost, totalSavings };
  }, [plans, guide]);

  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
      <div className="bg-slate-900 dark:bg-slate-800 rounded-2xl p-5 text-white">
        <div className="flex items-center gap-2 mb-3">
          <Shield className="w-5 h-5 opacity-70" />
          <span className="text-sm font-medium opacity-70">Plans</span>
        </div>
        <div className="text-3xl font-bold">{stats.activeCount}</div>
        <p className="text-sm opacity-60 mt-1">active</p>
      </div>

      <div className="bg-wellness-500 rounded-2xl p-5 text-white">
        <div className="flex items-center gap-2 mb-3">
          <CheckCircle className="w-5 h-5 opacity-70" />
          <span className="text-sm font-medium opacity-70">Services</span>
        </div>
        <div className="text-3xl font-bold">{stats.coveredServices}</div>
        <p className="text-sm opacity-60 mt-1">covered</p>
      </div>

      <div className="bg-amber-500 rounded-2xl p-5 text-white">
        <div className="flex items-center gap-2 mb-3">
          <DollarSign className="w-5 h-5 opacity-70" />
          <span className="text-sm font-medium opacity-70">Est. Cost</span>
        </div>
        <div className="text-3xl font-bold">
          {typeof stats.estimatedAnnualCost === 'number' ? formatCurrency(stats.estimatedAnnualCost) : '--'}
        </div>
        <p className="text-sm opacity-60 mt-1">annual</p>
      </div>

      <div className="bg-blue-500 rounded-2xl p-5 text-white">
        <div className="flex items-center gap-2 mb-3">
          <TrendingDown className="w-5 h-5 opacity-70" />
          <span className="text-sm font-medium opacity-70">Savings</span>
        </div>
        <div className="text-3xl font-bold">
          {stats.totalSavings > 0 ? formatCurrency(stats.totalSavings) : '--'}
        </div>
        <p className="text-sm opacity-60 mt-1">potential</p>
      </div>
    </div>
  );
}
