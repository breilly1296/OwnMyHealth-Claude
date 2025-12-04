/**
 * InsurancePlanViewer Component
 *
 * A detailed viewer for browsing insurance plan benefits and coverage information.
 * Displays plan cards that can be expanded to show full details.
 *
 * Features:
 * - Plan header showing name, insurer, type, effective date, and extraction confidence
 * - Key features summary (specialist visits, imaging, ER, preventive care) in compact cards
 * - Expandable details view with search and category filtering
 * - Costs section displaying deductibles, premiums, OOP maximums
 * - Benefits list with coverage status (color-coded), in-network/out-of-network details,
 *   and requirement badges (prior auth, referral required)
 *
 * Coverage colors indicate cost level:
 * - Green: Low cost (copay ≤$50, coinsurance ≤30%)
 * - Yellow/Orange: Moderate cost
 * - Red: Not covered
 *
 * @module components/insurance/InsurancePlanViewer
 */

import React, { useState } from 'react';
import { Shield, DollarSign, FileText, AlertCircle, CheckCircle, X, Eye, Search, Filter } from 'lucide-react';
import type { InsurancePlan, InsuranceBenefit } from '../../types';
import { getKeyPlanFeatures, formatCoverageDisplay } from '../../utils/insurance/sbcParser';

interface InsurancePlanViewerProps {
  plans: InsurancePlan[];
  isOpen: boolean;
  onClose: () => void;
}

const BENEFIT_CATEGORIES = [
  'All',
  'Primary Care',
  'Specialist Care',
  'Emergency Care',
  'Urgent Care',
  'Preventive Care',
  'Diagnostic Tests',
  'Imaging',
  'Lab Tests',
  'Prescription Drugs',
  'Mental Health',
  'Maternity',
  'Surgery',
  'Hospital Stay'
];

export default function InsurancePlanViewer({ plans, isOpen, onClose }: InsurancePlanViewerProps) {
  const [selectedPlan, setSelectedPlan] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('All');

  if (!isOpen) return null;

  const filteredBenefits = (plan: InsurancePlan) => {
    let benefits = plan.benefits;
    
    if (selectedCategory !== 'All') {
      benefits = benefits.filter(b => b.category === selectedCategory);
    }
    
    if (searchTerm) {
      benefits = benefits.filter(b => 
        b.serviceName.toLowerCase().includes(searchTerm.toLowerCase()) ||
        b.description.toLowerCase().includes(searchTerm.toLowerCase())
      );
    }
    
    return benefits;
  };

  const getCoverageColor = (benefit: InsuranceBenefit) => {
    if (!benefit.inNetworkCoverage.covered) return 'text-red-600 bg-red-50';
    if (benefit.inNetworkCoverage.copay && benefit.inNetworkCoverage.copay > 50) return 'text-orange-600 bg-orange-50';
    if (benefit.inNetworkCoverage.coinsurance && benefit.inNetworkCoverage.coinsurance > 30) return 'text-yellow-600 bg-yellow-50';
    return 'text-green-600 bg-green-50';
  };

  const renderPlanCard = (plan: InsurancePlan) => {
    const keyFeatures = getKeyPlanFeatures(plan);
    const isExpanded = selectedPlan === plan.id;

    return (
      <div key={plan.id} className="border border-gray-200 rounded-lg overflow-hidden">
        {/* Plan Header */}
        <div className="p-6 bg-gradient-to-r from-blue-50 to-indigo-50 border-b border-gray-200">
          <div className="flex justify-between items-start">
            <div>
              <h3 className="text-xl font-semibold text-gray-900">{plan.planName}</h3>
              <p className="text-gray-600 mt-1">{plan.insurerName}</p>
              <div className="flex items-center mt-2 space-x-4">
                <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-800">
                  {plan.planType}
                </span>
                <span className="text-sm text-gray-500">
                  Effective: {new Date(plan.effectiveDate).toLocaleDateString()}
                </span>
                <span className="text-sm text-gray-500">
                  {Math.round(plan.extractionConfidence * 100)}% confidence
                </span>
              </div>
            </div>
            <button
              onClick={() => setSelectedPlan(isExpanded ? null : plan.id)}
              className="text-blue-600 hover:text-blue-800"
            >
              <Eye className="w-5 h-5" />
            </button>
          </div>

          {/* Key Features Summary */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-4">
            {keyFeatures.specialistCoverage && (
              <div className="text-center p-3 bg-white rounded-lg shadow-sm">
                <p className="text-xs text-gray-600 mb-1">Specialist Visits</p>
                <p className="text-sm font-medium text-gray-900">
                  {formatCoverageDisplay(keyFeatures.specialistCoverage.inNetworkCoverage)}
                </p>
              </div>
            )}
            {keyFeatures.imagingCoverage.length > 0 && (
              <div className="text-center p-3 bg-white rounded-lg shadow-sm">
                <p className="text-xs text-gray-600 mb-1">Imaging</p>
                <p className="text-sm font-medium text-gray-900">
                  {formatCoverageDisplay(keyFeatures.imagingCoverage[0].inNetworkCoverage)}
                </p>
              </div>
            )}
            {keyFeatures.emergencyCoverage && (
              <div className="text-center p-3 bg-white rounded-lg shadow-sm">
                <p className="text-xs text-gray-600 mb-1">Emergency Room</p>
                <p className="text-sm font-medium text-gray-900">
                  {formatCoverageDisplay(keyFeatures.emergencyCoverage.inNetworkCoverage)}
                </p>
              </div>
            )}
            {keyFeatures.preventiveCoverage && (
              <div className="text-center p-3 bg-white rounded-lg shadow-sm">
                <p className="text-xs text-gray-600 mb-1">Preventive Care</p>
                <p className="text-sm font-medium text-gray-900">
                  {formatCoverageDisplay(keyFeatures.preventiveCoverage.inNetworkCoverage)}
                </p>
              </div>
            )}
          </div>
        </div>

        {/* Expanded Details */}
        {isExpanded && (
          <div className="p-6">
            {/* Search and Filter */}
            <div className="flex flex-col sm:flex-row gap-4 mb-6">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-4 h-4" />
                <input
                  type="text"
                  placeholder="Search benefits..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500"
                />
              </div>
              <div className="relative">
                <Filter className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-4 h-4" />
                <select
                  value={selectedCategory}
                  onChange={(e) => setSelectedCategory(e.target.value)}
                  className="pl-10 pr-8 py-2 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500"
                >
                  {BENEFIT_CATEGORIES.map(category => (
                    <option key={category} value={category}>{category}</option>
                  ))}
                </select>
              </div>
            </div>

            {/* Costs Section */}
            {plan.costs.length > 0 && (
              <div className="mb-6">
                <h4 className="text-lg font-medium text-gray-900 mb-3 flex items-center">
                  <DollarSign className="w-5 h-5 mr-2 text-green-600" />
                  Plan Costs
                </h4>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                  {plan.costs.map((cost, index) => (
                    <div key={index} className="p-4 border border-gray-200 rounded-lg">
                      <p className="text-sm text-gray-600 mb-1">{cost.type}</p>
                      <p className="text-2xl font-bold text-gray-900">
                        ${cost.amount.toLocaleString()}
                      </p>
                      {cost.frequency && (
                        <p className="text-sm text-gray-500">{cost.frequency}</p>
                      )}
                      <p className="text-xs text-gray-500 mt-1">{cost.appliesTo}</p>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Benefits Section */}
            <div>
              <h4 className="text-lg font-medium text-gray-900 mb-3 flex items-center">
                <Shield className="w-5 h-5 mr-2 text-blue-600" />
                Benefits Coverage ({filteredBenefits(plan).length})
              </h4>
              
              <div className="space-y-3">
                {filteredBenefits(plan).map((benefit, index) => (
                  <div key={index} className="border border-gray-200 rounded-lg p-4">
                    <div className="flex justify-between items-start">
                      <div className="flex-1">
                        <div className="flex items-center space-x-3">
                          <h5 className="font-medium text-gray-900">{benefit.serviceName}</h5>
                          <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-gray-100 text-gray-800">
                            {benefit.category}
                          </span>
                        </div>
                        <p className="text-sm text-gray-600 mt-1">{benefit.description}</p>
                        
                        {/* Coverage Details */}
                        <div className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-4">
                          <div>
                            <p className="text-xs font-medium text-gray-700 mb-1">In-Network Coverage</p>
                            <div className={`inline-flex items-center px-2.5 py-1 rounded-full text-sm font-medium ${getCoverageColor(benefit)}`}>
                              {benefit.inNetworkCoverage.covered ? (
                                <CheckCircle className="w-3 h-3 mr-1" />
                              ) : (
                                <X className="w-3 h-3 mr-1" />
                              )}
                              {formatCoverageDisplay(benefit.inNetworkCoverage)}
                            </div>
                          </div>
                          
                          {benefit.outOfNetworkCoverage && (
                            <div>
                              <p className="text-xs font-medium text-gray-700 mb-1">Out-of-Network Coverage</p>
                              <div className="inline-flex items-center px-2.5 py-1 rounded-full text-sm font-medium bg-gray-100 text-gray-700">
                                {benefit.outOfNetworkCoverage.covered ? (
                                  <CheckCircle className="w-3 h-3 mr-1" />
                                ) : (
                                  <X className="w-3 h-3 mr-1" />
                                )}
                                {formatCoverageDisplay(benefit.outOfNetworkCoverage)}
                              </div>
                            </div>
                          )}
                        </div>

                        {/* Requirements */}
                        {(benefit.priorAuthRequired || benefit.referralRequired) && (
                          <div className="mt-2 flex space-x-4">
                            {benefit.priorAuthRequired && (
                              <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-yellow-100 text-yellow-800">
                                <AlertCircle className="w-3 h-3 mr-1" />
                                Prior Auth Required
                              </span>
                            )}
                            {benefit.referralRequired && (
                              <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-blue-100 text-blue-800">
                                <FileText className="w-3 h-3 mr-1" />
                                Referral Required
                              </span>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>

              {filteredBenefits(plan).length === 0 && (
                <div className="text-center py-8 text-gray-500">
                  <FileText className="w-12 h-12 mx-auto mb-4 text-gray-300" />
                  <p>No benefits found matching your search criteria.</p>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg w-full max-w-7xl max-h-[90vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="flex justify-between items-center p-6 border-b border-gray-200">
          <div>
            <h2 className="text-2xl font-semibold text-gray-900">Insurance Plans</h2>
            <p className="text-sm text-gray-600 mt-1">
              View and compare your insurance plan benefits and coverage details
            </p>
          </div>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-700">
            <X className="w-6 h-6" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6">
          {plans.length === 0 ? (
            <div className="text-center py-12">
              <Shield className="w-16 h-16 mx-auto mb-4 text-gray-300" />
              <h3 className="text-lg font-medium text-gray-900 mb-2">No Insurance Plans</h3>
              <p className="text-gray-600">Upload your Summary of Benefits documents to get started.</p>
            </div>
          ) : (
            <div className="space-y-6">
              {plans.map(plan => renderPlanCard(plan))}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="border-t border-gray-200 p-4 bg-gray-50">
          <div className="flex justify-between items-center">
            <p className="text-sm text-gray-600">
              {plans.length} plan{plans.length !== 1 ? 's' : ''} loaded
            </p>
            <button
              onClick={onClose}
              className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 transition-colors"
            >
              Close
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}