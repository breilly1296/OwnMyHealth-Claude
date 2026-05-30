/**
 * Custom hook for InsuranceKnowledgeBase business logic
 */

import { useState, useMemo, useCallback } from 'react';
import type { InsurancePlan } from '../../types';
import {
  InsuranceKnowledgeBase,
  type NormalizedInsurancePlan,
  type PlanSearchCriteria,
  type PlanSearchResult,
  type BenefitCategory
} from '../../utils/insurance/insuranceKnowledgeBase';
import type { TabType } from './insuranceKnowledgeBaseConstants';

export function useInsuranceKnowledgeBase(plans: InsurancePlan[]) {
  const [activeTab, setActiveTab] = useState<TabType>('search');
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<PlanSearchResult[]>([]);
  const [selectedCategory, setSelectedCategory] = useState<BenefitCategory | null>(null);
  const [selectedPlanIds, setSelectedPlanIds] = useState<string[]>([]);
  const [showFilters, setShowFilters] = useState(false);
  const [filters, setFilters] = useState<PlanSearchCriteria>({});

  // Build a FRESH knowledge base scoped to exactly the current `plans`.
  // The previous code fed plans into a module-level singleton that was never
  // cleared, so deleted or cross-session plans lingered in search results
  // forever (#25). Rebuilding per `plans` keeps the KB and search in sync.
  const { kb, normalizedPlans } = useMemo(() => {
    const instance = new InsuranceKnowledgeBase();
    const normalized = plans.map(plan => instance.addPlan(plan));
    return { kb: instance, normalizedPlans: normalized };
  }, [plans]);

  // Get unique categories from plans
  const availableCategories = useMemo(() => {
    const categories = new Set<BenefitCategory>();
    normalizedPlans.forEach(plan => {
      plan.normalizedBenefits.forEach(benefit => {
        categories.add(benefit.category);
      });
    });
    return Array.from(categories);
  }, [normalizedPlans]);

  // Handle search
  const handleSearch = useCallback(() => {
    const query = searchQuery.trim().toLowerCase();
    if (!query && Object.keys(filters).length === 0) {
      setSearchResults([]);
      return;
    }
    let results = kb.searchPlans(filters);
    // searchPlans only takes structured criteria; apply the free-text query
    // here so the search box actually does something (#25 — it was ignored).
    if (query) {
      results = results.filter(
        r =>
          r.plan.planName.toLowerCase().includes(query) ||
          r.plan.insurerName.toLowerCase().includes(query)
      );
    }
    setSearchResults(results);
  }, [searchQuery, filters, kb]);

  // Clear search results
  const clearSearchResults = useCallback(() => {
    setSearchResults([]);
  }, []);

  // Clear filters
  const clearFilters = useCallback(() => {
    setFilters({});
  }, []);

  // Toggle filter visibility
  const toggleFilters = useCallback(() => {
    setShowFilters(prev => !prev);
  }, []);

  // Get benefits by category
  const getBenefitsByCategory = useCallback((category: BenefitCategory) => {
    const benefits: { planName: string; benefit: NormalizedInsurancePlan['normalizedBenefits'][0] }[] = [];
    normalizedPlans.forEach(plan => {
      plan.normalizedBenefits
        .filter(b => b.category === category)
        .forEach(benefit => {
          benefits.push({ planName: plan.planName, benefit });
        });
    });
    return benefits;
  }, [normalizedPlans]);

  // Toggle plan selection for comparison
  const togglePlanSelection = useCallback((planId: string) => {
    setSelectedPlanIds(prev =>
      prev.includes(planId)
        ? prev.filter(id => id !== planId)
        : [...prev, planId]
    );
  }, []);

  // Toggle category selection
  const toggleCategory = useCallback((category: BenefitCategory) => {
    setSelectedCategory(prev => prev === category ? null : category);
  }, []);

  // Clear selected category
  const clearSelectedCategory = useCallback(() => {
    setSelectedCategory(null);
  }, []);

  // Get selected plans for comparison
  const selectedPlans = useMemo(() => {
    return selectedPlanIds.map(id => normalizedPlans.find(p => p.id === id)).filter(Boolean) as NormalizedInsurancePlan[];
  }, [selectedPlanIds, normalizedPlans]);

  // Calculate average coverage
  const avgCoverage = useMemo(() => {
    if (!normalizedPlans || normalizedPlans.length === 0) return 0;
    return Math.round(
      normalizedPlans.reduce((sum, p) => sum + p.keyMetrics.coverageComprehensiveness, 0) / normalizedPlans.length
    );
  }, [normalizedPlans]);

  // Calculate average premium
  const avgPremium = useMemo(() => {
    if (!normalizedPlans || normalizedPlans.length === 0) return 0;
    return normalizedPlans.reduce((sum, p) => {
      const premium = p.normalizedCosts.find(c => c.costType === 'premium')?.amount || 0;
      return sum + premium;
    }, 0) / normalizedPlans.length;
  }, [normalizedPlans]);

  return {
    // State
    activeTab,
    searchQuery,
    normalizedPlans,
    searchResults,
    selectedCategory,
    selectedPlanIds,
    showFilters,
    filters,
    availableCategories,
    selectedPlans,
    avgCoverage,
    avgPremium,

    // Actions
    setActiveTab,
    setSearchQuery,
    setFilters,
    handleSearch,
    clearSearchResults,
    clearFilters,
    toggleFilters,
    getBenefitsByCategory,
    togglePlanSelection,
    toggleCategory,
    clearSelectedCategory
  };
}

// Utility functions
export function formatCurrency(amount: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0
  }).format(amount);
}

export function getCoverageColor(percentage: number): string {
  if (percentage >= 80) return 'text-wellness-600 bg-wellness-50 border-wellness-200';
  if (percentage >= 50) return 'text-amber-600 bg-amber-50 border-amber-200';
  return 'text-red-600 bg-red-50 border-red-200';
}

export function getCoverageBarColor(percentage: number): string {
  if (percentage >= 80) return 'bg-wellness-500';
  if (percentage >= 50) return 'bg-amber-500';
  return 'bg-red-500';
}
