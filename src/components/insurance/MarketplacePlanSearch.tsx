/**
 * MarketplacePlanSearch Component
 *
 * Searches for health insurance plans using the Healthcare.gov Marketplace API.
 * Features:
 * - Search by zipcode, age, income, and household size
 * - View plan details including premiums, deductibles, and benefits
 * - Compare plans by metal level
 *
 * @module components/insurance/MarketplacePlanSearch
 */

import React, { useState } from 'react';
import {
  Search,
  MapPin,
  DollarSign,
  Users,
  User,
  Loader2,
  AlertCircle,
  X,
  Shield,
  Star,
  ExternalLink,
  ChevronDown,
  ChevronUp,
  Heart,
  FileText,
  CheckCircle
} from 'lucide-react';
import {
  marketplaceApi,
  type MarketplaceSearchedPlan,
  type MarketplacePlanSearchResult,
  type MarketplacePlanSearchParams
} from '../../services/api';

const METAL_LEVEL_COLORS: Record<string, { bg: string; text: string; border: string }> = {
  catastrophic: { bg: 'bg-gray-100', text: 'text-gray-700', border: 'border-gray-300' },
  bronze: { bg: 'bg-amber-100', text: 'text-amber-700', border: 'border-amber-300' },
  silver: { bg: 'bg-slate-200', text: 'text-slate-700', border: 'border-slate-400' },
  gold: { bg: 'bg-yellow-100', text: 'text-yellow-700', border: 'border-yellow-400' },
  platinum: { bg: 'bg-indigo-100', text: 'text-indigo-700', border: 'border-indigo-300' },
};

export default function MarketplacePlanSearch() {
  const [zipcode, setZipcode] = useState('');
  const [age, setAge] = useState('');
  const [income, setIncome] = useState('');
  const [householdSize, setHouseholdSize] = useState('1');
  const [gender, setGender] = useState<'Male' | 'Female'>('Male');
  const [usesTobacco, setUsesTobacco] = useState(false);
  const [isSearching, setIsSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [results, setResults] = useState<MarketplacePlanSearchResult | null>(null);
  const [expandedPlanId, setExpandedPlanId] = useState<string | null>(null);

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0
    }).format(amount);
  };

  const handleSearch = async () => {
    if (!zipcode || !/^\d{5}$/.test(zipcode)) {
      setSearchError('Please enter a valid 5-digit zipcode');
      return;
    }

    const ageNum = parseInt(age, 10);
    if (!age || isNaN(ageNum) || ageNum < 0 || ageNum > 120) {
      setSearchError('Please enter a valid age (0-120)');
      return;
    }

    const incomeNum = parseInt(income.replace(/,/g, ''), 10);
    if (!income || isNaN(incomeNum) || incomeNum < 0) {
      setSearchError('Please enter a valid annual income');
      return;
    }

    setIsSearching(true);
    setSearchError(null);
    setResults(null);

    try {
      const params: MarketplacePlanSearchParams = {
        zipcode,
        age: ageNum,
        income: incomeNum,
        householdSize: parseInt(householdSize, 10),
        gender,
        usesTobacco,
      };

      const data = await marketplaceApi.searchPlans(params);
      setResults(data);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to search plans';
      setSearchError(message);
    } finally {
      setIsSearching(false);
    }
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleSearch();
    }
  };

  const getMetalLevelStyle = (metalLevel: string) => {
    return METAL_LEVEL_COLORS[metalLevel.toLowerCase()] || METAL_LEVEL_COLORS.bronze;
  };

  const renderStars = (rating?: number) => {
    if (!rating) return null;
    const stars = [];
    for (let i = 1; i <= 5; i++) {
      stars.push(
        <Star
          key={i}
          className={`w-4 h-4 ${i <= rating ? 'text-yellow-400 fill-yellow-400' : 'text-gray-300'}`}
        />
      );
    }
    return <div className="flex gap-0.5">{stars}</div>;
  };

  return (
    <div className="space-y-6">
      {/* Search Form */}
      <div className="bg-white rounded-2xl border border-slate-200/60 p-6">
        <div className="flex items-center gap-3 mb-5">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center">
            <Search className="w-5 h-5 text-white" />
          </div>
          <div>
            <h3 className="font-semibold text-slate-900">Find Health Insurance Plans</h3>
            <p className="text-sm text-slate-500">Search the Healthcare.gov marketplace</p>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {/* Zipcode */}
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-2">
              Zipcode *
            </label>
            <div className="relative">
              <MapPin className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
              <input
                type="text"
                value={zipcode}
                onChange={(e) => setZipcode(e.target.value.replace(/\D/g, '').slice(0, 5))}
                onKeyPress={handleKeyPress}
                placeholder="12345"
                className="w-full pl-10 pr-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-300"
              />
            </div>
          </div>

          {/* Age */}
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-2">
              Your Age *
            </label>
            <div className="relative">
              <User className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
              <input
                type="number"
                value={age}
                onChange={(e) => setAge(e.target.value)}
                onKeyPress={handleKeyPress}
                placeholder="27"
                min="0"
                max="120"
                className="w-full pl-10 pr-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-300"
              />
            </div>
          </div>

          {/* Annual Income */}
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-2">
              Annual Household Income *
            </label>
            <div className="relative">
              <DollarSign className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
              <input
                type="text"
                value={income}
                onChange={(e) => {
                  const val = e.target.value.replace(/[^0-9,]/g, '');
                  setIncome(val);
                }}
                onKeyPress={handleKeyPress}
                placeholder="52,000"
                className="w-full pl-10 pr-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-300"
              />
            </div>
          </div>

          {/* Household Size */}
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-2">
              Household Size
            </label>
            <div className="relative">
              <Users className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
              <select
                value={householdSize}
                onChange={(e) => setHouseholdSize(e.target.value)}
                className="w-full pl-10 pr-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-300 appearance-none"
              >
                {[1, 2, 3, 4, 5, 6, 7, 8].map((n) => (
                  <option key={n} value={n}>{n} {n === 1 ? 'person' : 'people'}</option>
                ))}
              </select>
            </div>
          </div>

          {/* Gender */}
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-2">
              Gender
            </label>
            <select
              value={gender}
              onChange={(e) => setGender(e.target.value as 'Male' | 'Female')}
              className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-300"
            >
              <option value="Male">Male</option>
              <option value="Female">Female</option>
            </select>
          </div>

          {/* Tobacco Use */}
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-2">
              Tobacco Use
            </label>
            <div className="flex items-center gap-3 h-[42px]">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={usesTobacco}
                  onChange={(e) => setUsesTobacco(e.target.checked)}
                  className="w-4 h-4 text-blue-600 border-slate-300 rounded focus:ring-blue-500"
                />
                <span className="text-sm text-slate-700">I use tobacco products</span>
              </label>
            </div>
          </div>
        </div>

        <div className="mt-5 pt-5 border-t border-slate-100 flex items-center justify-between">
          <p className="text-xs text-slate-400">
            * Required fields. Results show estimated premiums including tax credits.
          </p>

          <button
            onClick={handleSearch}
            disabled={isSearching || !zipcode || !age || !income}
            className="flex items-center gap-2 px-6 py-2.5 bg-gradient-to-r from-blue-500 to-indigo-600 text-white text-sm font-medium rounded-xl hover:from-blue-600 hover:to-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed transition-all shadow-lg shadow-blue-500/25"
          >
            {isSearching ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Search className="w-4 h-4" />
            )}
            Search Plans
          </button>
        </div>
      </div>

      {/* Error Message */}
      {searchError && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-4 flex items-center gap-3">
          <AlertCircle className="w-5 h-5 text-red-500 flex-shrink-0" />
          <p className="text-red-700 text-sm">{searchError}</p>
          <button
            onClick={() => setSearchError(null)}
            className="ml-auto text-red-500 hover:text-red-700"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Results Summary */}
      {results && (
        <div className="flex items-center justify-between">
          <h3 className="font-semibold text-slate-900">
            {results.total} plan{results.total !== 1 ? 's' : ''} found
          </h3>
          {results.ranges?.premiums && (
            <span className="text-sm text-slate-500">
              Premiums from {formatCurrency(results.ranges.premiums.min)}/mo to {formatCurrency(results.ranges.premiums.max)}/mo
            </span>
          )}
        </div>
      )}

      {/* Results */}
      {results && results.plans.length > 0 && (
        <div className="space-y-4">
          {results.plans.map((plan) => {
            const metalStyle = getMetalLevelStyle(plan.metalLevel);
            const isExpanded = expandedPlanId === plan.id;

            return (
              <div
                key={plan.id}
                className={`bg-white rounded-2xl border ${isExpanded ? 'border-blue-300 shadow-lg' : 'border-slate-200/60'} overflow-hidden transition-all`}
              >
                {/* Plan Header */}
                <div className="p-6">
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex items-start gap-4">
                      <div className={`w-12 h-12 rounded-xl ${metalStyle.bg} flex items-center justify-center flex-shrink-0`}>
                        <Shield className={`w-6 h-6 ${metalStyle.text}`} />
                      </div>
                      <div>
                        <h4 className="font-semibold text-slate-900">{plan.name}</h4>
                        <p className="text-sm text-slate-500">{plan.issuer}</p>
                        <div className="flex items-center gap-2 mt-2">
                          <span className={`text-xs font-medium px-2.5 py-1 rounded-lg ${metalStyle.bg} ${metalStyle.text} capitalize`}>
                            {plan.metalLevel}
                          </span>
                          <span className="text-xs text-slate-400">{plan.planType}</span>
                          {plan.hsaEligible && (
                            <span className="text-xs px-2 py-1 bg-green-50 text-green-700 rounded-lg">
                              HSA Eligible
                            </span>
                          )}
                        </div>
                      </div>
                    </div>

                    <div className="text-right">
                      <div className="text-2xl font-bold text-slate-900">
                        {formatCurrency(plan.premiumWithCredit ?? plan.premium)}<span className="text-sm font-normal text-slate-500">/mo</span>
                      </div>
                      {plan.premiumWithCredit && plan.premium !== plan.premiumWithCredit && (
                        <p className="text-xs text-slate-400 line-through">
                          {formatCurrency(plan.premium)}/mo without credit
                        </p>
                      )}
                      {plan.qualityRating && (
                        <div className="mt-2">
                          {renderStars(plan.qualityRating)}
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Key Stats */}
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-5 pt-5 border-t border-slate-100">
                    <div>
                      <p className="text-xs text-slate-400 mb-1">Deductible</p>
                      <p className="font-semibold text-slate-900">{formatCurrency(plan.deductible)}</p>
                    </div>
                    <div>
                      <p className="text-xs text-slate-400 mb-1">Out-of-Pocket Max</p>
                      <p className="font-semibold text-slate-900">{formatCurrency(plan.outOfPocketMax)}</p>
                    </div>
                    <div>
                      <p className="text-xs text-slate-400 mb-1">Annual Premium</p>
                      <p className="font-semibold text-slate-900">{formatCurrency((plan.premiumWithCredit ?? plan.premium) * 12)}</p>
                    </div>
                    <div>
                      <p className="text-xs text-slate-400 mb-1">Est. Annual Cost</p>
                      <p className="font-semibold text-slate-900">{formatCurrency(((plan.premiumWithCredit ?? plan.premium) * 12) + plan.deductible)}</p>
                    </div>
                  </div>

                  {/* Expand Button */}
                  <button
                    onClick={() => setExpandedPlanId(isExpanded ? null : plan.id)}
                    className="mt-4 w-full flex items-center justify-center gap-2 py-2 text-sm text-slate-600 hover:text-slate-900 transition-colors"
                  >
                    {isExpanded ? (
                      <>
                        <ChevronUp className="w-4 h-4" />
                        Show less
                      </>
                    ) : (
                      <>
                        <ChevronDown className="w-4 h-4" />
                        Show more details
                      </>
                    )}
                  </button>
                </div>

                {/* Expanded Details */}
                {isExpanded && (
                  <div className="px-6 pb-6 space-y-5">
                    {/* Benefits */}
                    {plan.benefits && plan.benefits.length > 0 && (
                      <div>
                        <h5 className="text-sm font-semibold text-slate-900 mb-3 flex items-center gap-2">
                          <Heart className="w-4 h-4 text-pink-500" />
                          Benefits Highlights
                        </h5>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                          {plan.benefits.slice(0, 8).map((benefit, i) => (
                            <div key={i} className="flex items-center gap-2 text-sm">
                              {benefit.covered ? (
                                <CheckCircle className="w-4 h-4 text-green-500 flex-shrink-0" />
                              ) : (
                                <X className="w-4 h-4 text-red-500 flex-shrink-0" />
                              )}
                              <span className="text-slate-700">{benefit.name}</span>
                              {benefit.costSharingDisplay && (
                                <span className="text-slate-400 text-xs">({benefit.costSharingDisplay})</span>
                              )}
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Additional Features */}
                    <div className="flex flex-wrap gap-2">
                      {plan.pediatricDentalCoverage && (
                        <span className="text-xs px-3 py-1.5 bg-blue-50 text-blue-700 rounded-lg">
                          Pediatric Dental Included
                        </span>
                      )}
                    </div>

                    {/* External Links */}
                    <div className="flex flex-wrap gap-3 pt-4 border-t border-slate-100">
                      {plan.urls?.brochure && (
                        <a
                          href={plan.urls?.brochure}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-2 text-sm text-blue-600 hover:text-blue-700"
                        >
                          <FileText className="w-4 h-4" />
                          Plan Brochure
                          <ExternalLink className="w-3 h-3" />
                        </a>
                      )}
                      {plan.urls?.formulary && (
                        <a
                          href={plan.urls?.formulary}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-2 text-sm text-blue-600 hover:text-blue-700"
                        >
                          <FileText className="w-4 h-4" />
                          Drug Formulary
                          <ExternalLink className="w-3 h-3" />
                        </a>
                      )}
                      {plan.urls?.network && (
                        <a
                          href={plan.urls?.network}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-2 text-sm text-blue-600 hover:text-blue-700"
                        >
                          <Users className="w-4 h-4" />
                          Provider Network
                          <ExternalLink className="w-3 h-3" />
                        </a>
                      )}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Empty Results */}
      {results && results.plans.length === 0 && (
        <div className="bg-slate-50 rounded-2xl p-12 text-center">
          <Shield className="w-12 h-12 text-slate-300 mx-auto mb-4" />
          <p className="text-slate-600 font-medium">No plans found</p>
          <p className="text-sm text-slate-400 mt-1">Try adjusting your search criteria</p>
        </div>
      )}

      {/* Initial State */}
      {!results && !isSearching && !searchError && (
        <div className="bg-gradient-to-br from-blue-50 to-indigo-50 rounded-2xl p-12 text-center border border-blue-100">
          <div className="w-16 h-16 bg-white rounded-2xl shadow-lg flex items-center justify-center mx-auto mb-4">
            <Shield className="w-8 h-8 text-blue-500" />
          </div>
          <h3 className="text-lg font-semibold text-slate-900 mb-2">Find Your Perfect Plan</h3>
          <p className="text-slate-500 text-sm max-w-md mx-auto">
            Enter your information above to search for health insurance plans available in your area through the Healthcare.gov marketplace.
          </p>
        </div>
      )}
    </div>
  );
}
