/**
 * HealthNeedsPanel Component
 *
 * A comprehensive dashboard showing the user's health needs analysis based on their biomarker data.
 * Presents AI-analyzed health information in an organized, actionable format.
 *
 * Tabs:
 * - Overview: Summary stats (total conditions, urgent actions, covered services)
 * - Conditions: Detected health conditions with severity and relevant biomarkers
 * - Actions: Prioritized list of recommended actions with urgency levels
 * - Services: Recommended healthcare services with insurance coverage details
 *
 * Features:
 * - Color-coded urgency indicators
 * - Insurance coverage matching
 * - Cost estimates and preventive care recommendations
 *
 * @module components/health/HealthNeedsPanel
 */

import React, { useState } from 'react';
import {
  AlertTriangle,
  CheckCircle,
  Stethoscope,
  Shield,
  ChevronRight,
  Calendar,
  DollarSign,
  Activity,
  Clock
} from 'lucide-react';
import type { HealthNeedsAnalysis, InsurancePlan } from '../../types';

interface HealthNeedsPanelProps {
  /** AI-generated health needs analysis */
  analysis: HealthNeedsAnalysis;
  /** User's insurance plans for coverage matching */
  insurancePlans: InsurancePlan[];
}

type TabType = 'overview' | 'conditions' | 'actions' | 'services';

export default function HealthNeedsPanel({ analysis }: HealthNeedsPanelProps) {
  const [activeTab, setActiveTab] = useState<TabType>('overview');

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0
    }).format(amount);
  };

  const urgentActions = analysis.priorityActions.filter(a => a.urgency === 'immediate' || a.urgency === 'urgent');
  const coveredServices = analysis.insuranceCoverage.filter(ic => ic.planCoverage.some(pc => pc.covered)).length;

  const tabs = [
    { id: 'overview' as TabType, label: 'Overview' },
    { id: 'conditions' as TabType, label: 'Conditions' },
    { id: 'actions' as TabType, label: 'Actions' },
    { id: 'services' as TabType, label: 'Services' },
  ];

  const getUrgencyColor = (urgency: string) => {
    switch (urgency) {
      case 'immediate': return 'bg-red-500';
      case 'urgent': return 'bg-amber-500';
      case 'follow-up': return 'bg-blue-500';
      default: return 'bg-slate-400';
    }
  };

  const getSeverityStyles = (severity: string) => {
    switch (severity) {
      case 'severe': return 'bg-red-500 text-white';
      case 'moderate': return 'bg-amber-500 text-white';
      default: return 'bg-slate-200 text-slate-700';
    }
  };

  return (
    <div className="animate-fade-in max-w-6xl mx-auto">
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-slate-900">Health Needs</h1>
        <p className="text-slate-500 mt-1">Personalized recommendations based on your biomarkers</p>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-12 gap-4 mb-8">
        {/* Main Status Card */}
        <div className="col-span-12 md:col-span-6 bg-white rounded-2xl border border-slate-200/60 p-6">
          {analysis.detectedConditions.length === 0 && urgentActions.length === 0 ? (
            <div className="flex items-center gap-5">
              <div className="w-14 h-14 rounded-2xl bg-wellness-100 flex items-center justify-center">
                <CheckCircle className="w-7 h-7 text-wellness-600" />
              </div>
              <div>
                <h2 className="text-lg font-semibold text-slate-900">You're on track</h2>
                <p className="text-sm text-slate-500 mt-0.5">No immediate health concerns detected</p>
              </div>
            </div>
          ) : (
            <div className="flex items-center gap-5">
              <div className="w-14 h-14 rounded-2xl bg-amber-100 flex items-center justify-center">
                <AlertTriangle className="w-7 h-7 text-amber-600" />
              </div>
              <div>
                <h2 className="text-lg font-semibold text-slate-900">
                  {urgentActions.length > 0 ? `${urgentActions.length} items need attention` : 'Review recommended'}
                </h2>
                <p className="text-sm text-slate-500 mt-0.5">
                  {analysis.detectedConditions.length} condition{analysis.detectedConditions.length !== 1 ? 's' : ''} detected
                </p>
              </div>
            </div>
          )}
        </div>

        {/* Quick Stats */}
        <div className="col-span-4 md:col-span-2 bg-slate-900 rounded-2xl p-5">
          <span className="text-xs font-medium text-slate-400 uppercase tracking-wide">Conditions</span>
          <p className="text-3xl font-bold text-white mt-2">{analysis.detectedConditions.length}</p>
        </div>

        <div className="col-span-4 md:col-span-2 bg-amber-500 rounded-2xl p-5">
          <span className="text-xs font-medium text-amber-100 uppercase tracking-wide">Actions</span>
          <p className="text-3xl font-bold text-white mt-2">{analysis.priorityActions.length}</p>
        </div>

        <div className="col-span-4 md:col-span-2 bg-wellness-500 rounded-2xl p-5">
          <span className="text-xs font-medium text-wellness-100 uppercase tracking-wide">Covered</span>
          <p className="text-3xl font-bold text-white mt-2">{coveredServices}</p>
        </div>
      </div>

      {/* Tab Navigation */}
      <div className="bg-slate-100 rounded-xl p-1 inline-flex mb-6">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`px-5 py-2 text-sm font-medium rounded-lg transition-all ${
              activeTab === tab.id
                ? 'bg-white text-slate-900 shadow-sm'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab Content */}
      <div className="min-h-[400px]">

        {/* Overview Tab */}
        {activeTab === 'overview' && (
          <div className="grid grid-cols-12 gap-5">
            {/* Urgent Actions */}
            {urgentActions.length > 0 && (
              <div className="col-span-12 md:col-span-7">
                <div className="flex items-center justify-between mb-4">
                  <h2 className="font-semibold text-slate-900">Priority Actions</h2>
                  <button
                    onClick={() => setActiveTab('actions')}
                    className="text-sm text-slate-500 hover:text-slate-700 flex items-center gap-1"
                  >
                    View all <ChevronRight className="w-4 h-4" />
                  </button>
                </div>
                <div className="space-y-3">
                  {urgentActions.slice(0, 3).map((action, i) => (
                    <div
                      key={i}
                      className="bg-white rounded-xl border border-slate-200/60 p-4 flex items-center gap-4 hover:shadow-sm transition-shadow"
                    >
                      <div className={`w-2 h-2 rounded-full flex-shrink-0 ${getUrgencyColor(action.urgency)}`} />
                      <div className="flex-1 min-w-0">
                        <p className="font-medium text-slate-900 text-sm">{action.title}</p>
                        <p className="text-xs text-slate-500 mt-0.5">{action.timeframe}</p>
                      </div>
                      <ChevronRight className="w-4 h-4 text-slate-300 flex-shrink-0" />
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Conditions Preview */}
            {analysis.detectedConditions.length > 0 && (
              <div className={`col-span-12 ${urgentActions.length > 0 ? 'md:col-span-5' : 'md:col-span-7'}`}>
                <div className="flex items-center justify-between mb-4">
                  <h2 className="font-semibold text-slate-900">Detected Conditions</h2>
                  <button
                    onClick={() => setActiveTab('conditions')}
                    className="text-sm text-slate-500 hover:text-slate-700 flex items-center gap-1"
                  >
                    View all <ChevronRight className="w-4 h-4" />
                  </button>
                </div>
                <div className="space-y-3">
                  {analysis.detectedConditions.slice(0, 3).map((dc, i) => (
                    <div
                      key={i}
                      className="bg-white rounded-xl border border-slate-200/60 p-4 hover:shadow-sm transition-shadow"
                    >
                      <div className="flex items-center justify-between mb-2">
                        <span className={`text-xs font-medium px-2 py-1 rounded ${getSeverityStyles(dc.severity)}`}>
                          {dc.severity}
                        </span>
                        <span className="text-xs text-slate-400">{Math.round(dc.confidence * 100)}%</span>
                      </div>
                      <p className="font-medium text-slate-900 text-sm">{dc.condition.name}</p>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Preventive Care - Full Width */}
            {analysis.preventiveRecommendations.length > 0 && (
              <div className="col-span-12">
                <h2 className="font-semibold text-slate-900 mb-4">Preventive Care</h2>
                <div className="bg-white rounded-2xl border border-slate-200/60 overflow-hidden">
                  <div className="grid grid-cols-1 md:grid-cols-2 divide-y md:divide-y-0 md:divide-x divide-slate-100">
                    {analysis.preventiveRecommendations.slice(0, 4).map((rec, i) => (
                      <div key={i} className="p-5 flex items-center justify-between hover:bg-slate-50/50 transition-colors">
                        <div>
                          <p className="font-medium text-slate-900 text-sm">{rec.title}</p>
                          <p className="text-xs text-slate-500 mt-1">{rec.frequency}</p>
                        </div>
                        {rec.insuranceCoverage === 'Typically Covered' && (
                          <span className="flex items-center gap-1 text-xs font-medium text-wellness-600 bg-wellness-50 px-2 py-1 rounded-full">
                            <Shield className="w-3 h-3" />
                            Covered
                          </span>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {/* Empty State */}
            {analysis.detectedConditions.length === 0 && urgentActions.length === 0 && (
              <div className="col-span-12 bg-slate-50 rounded-2xl p-12 text-center">
                <div className="w-16 h-16 bg-wellness-100 rounded-2xl flex items-center justify-center mx-auto mb-4">
                  <CheckCircle className="w-8 h-8 text-wellness-600" />
                </div>
                <h3 className="text-lg font-semibold text-slate-900 mb-2">All clear</h3>
                <p className="text-slate-500 text-sm max-w-md mx-auto">
                  No specific health conditions detected. Continue with regular monitoring and preventive care.
                </p>
              </div>
            )}
          </div>
        )}

        {/* Conditions Tab */}
        {activeTab === 'conditions' && (
          <div className="space-y-4">
            {analysis.detectedConditions.length === 0 ? (
              <div className="bg-slate-50 rounded-2xl p-12 text-center">
                <CheckCircle className="w-12 h-12 text-wellness-400 mx-auto mb-4" />
                <p className="text-slate-600 font-medium">No conditions detected</p>
                <p className="text-sm text-slate-400 mt-1">Your biomarkers look healthy</p>
              </div>
            ) : (
              analysis.detectedConditions.map((dc, index) => (
                <div key={index} className="bg-white rounded-2xl border border-slate-200/60 overflow-hidden">
                  {/* Header */}
                  <div className="px-6 py-5 border-b border-slate-100">
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-3">
                        <span className={`text-xs font-semibold px-2.5 py-1 rounded ${getSeverityStyles(dc.severity)}`}>
                          {dc.severity.toUpperCase()}
                        </span>
                        <h3 className="font-semibold text-slate-900">{dc.condition.name}</h3>
                      </div>
                      <span className="text-sm text-slate-400">{Math.round(dc.confidence * 100)}% confidence</span>
                    </div>
                    <p className="text-sm text-slate-600">{dc.condition.description}</p>
                  </div>

                  {/* Details */}
                  <div className="grid grid-cols-1 md:grid-cols-2">
                    {/* Biomarkers */}
                    <div className="p-6 border-b md:border-b-0 md:border-r border-slate-100">
                      <h4 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-4">
                        Triggering Biomarkers
                      </h4>
                      <div className="space-y-3">
                        {dc.triggeringBiomarkers.map((bio, i) => {
                          const isOutOfRange = bio.value < bio.normalRange.min || bio.value > bio.normalRange.max;
                          return (
                            <div key={i} className="flex items-center justify-between">
                              <span className="text-sm text-slate-700">{bio.name}</span>
                              <div className="flex items-center gap-2">
                                <span className={`text-sm font-semibold ${isOutOfRange ? 'text-red-600' : 'text-wellness-600'}`}>
                                  {bio.value}
                                </span>
                                <span className="text-xs text-slate-400">{bio.unit}</span>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>

                    {/* Risk Factors */}
                    <div className="p-6">
                      <h4 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-4">
                        Risk Factors
                      </h4>
                      <div className="flex flex-wrap gap-2">
                        {dc.riskFactors.map((factor, i) => (
                          <span key={i} className="px-3 py-1.5 bg-slate-100 text-slate-700 text-xs rounded-lg">
                            {factor}
                          </span>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        )}

        {/* Actions Tab */}
        {activeTab === 'actions' && (
          <div className="space-y-3">
            {analysis.priorityActions.length === 0 ? (
              <div className="bg-slate-50 rounded-2xl p-12 text-center">
                <CheckCircle className="w-12 h-12 text-wellness-400 mx-auto mb-4" />
                <p className="text-slate-600 font-medium">No action items</p>
                <p className="text-sm text-slate-400 mt-1">You're all caught up</p>
              </div>
            ) : (
              analysis.priorityActions.map((action, index) => (
                <div
                  key={index}
                  className="bg-white rounded-2xl border border-slate-200/60 p-5 hover:shadow-sm transition-shadow"
                >
                  <div className="flex items-start gap-4">
                    <div className={`w-3 h-3 rounded-full mt-1.5 flex-shrink-0 ${getUrgencyColor(action.urgency)}`} />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-start justify-between gap-4 mb-2">
                        <h3 className="font-semibold text-slate-900">{action.title}</h3>
                        <span className={`text-xs font-medium px-2.5 py-1 rounded-full flex-shrink-0 ${
                          action.urgency === 'immediate' ? 'bg-red-100 text-red-700' :
                          action.urgency === 'urgent' ? 'bg-amber-100 text-amber-700' :
                          'bg-slate-100 text-slate-600'
                        }`}>
                          {action.urgency}
                        </span>
                      </div>
                      <p className="text-sm text-slate-600 mb-4">{action.description}</p>
                      <div className="flex items-center gap-5 text-xs text-slate-500">
                        <span className="flex items-center gap-1.5">
                          <Activity className="w-3.5 h-3.5" />
                          {action.category}
                        </span>
                        <span className="flex items-center gap-1.5">
                          <Clock className="w-3.5 h-3.5" />
                          {action.timeframe}
                        </span>
                        {action.estimatedCost && (
                          <span className="flex items-center gap-1.5">
                            <DollarSign className="w-3.5 h-3.5" />
                            {formatCurrency(action.estimatedCost)}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        )}

        {/* Services Tab */}
        {activeTab === 'services' && (
          <div className="space-y-4">
            {analysis.recommendedServices.length === 0 ? (
              <div className="bg-slate-50 rounded-2xl p-12 text-center">
                <Stethoscope className="w-12 h-12 text-slate-300 mx-auto mb-4" />
                <p className="text-slate-600 font-medium">No services recommended</p>
                <p className="text-sm text-slate-400 mt-1">Based on your current health data</p>
              </div>
            ) : (
              analysis.recommendedServices.map((rs, index) => {
                const coverage = analysis.insuranceCoverage.find(ic => ic.serviceId === rs.service.id);
                const isCovered = coverage?.planCoverage.some(pc => pc.covered);

                return (
                  <div key={index} className="bg-white rounded-2xl border border-slate-200/60 overflow-hidden">
                    <div className="p-6">
                      <div className="flex items-start justify-between mb-3">
                        <div>
                          <div className="flex items-center gap-2 mb-1">
                            <h3 className="font-semibold text-slate-900">{rs.service.name}</h3>
                            <span className={`w-2 h-2 rounded-full ${getUrgencyColor(rs.urgency)}`} />
                          </div>
                          <p className="text-xs text-slate-500">{rs.service.category}</p>
                        </div>
                        {isCovered && (
                          <span className="flex items-center gap-1.5 text-xs font-medium text-wellness-700 bg-wellness-50 px-3 py-1.5 rounded-full">
                            <Shield className="w-3.5 h-3.5" />
                            Covered
                          </span>
                        )}
                      </div>
                      <p className="text-sm text-slate-600">{rs.reason}</p>
                    </div>

                    <div className="px-6 py-4 bg-slate-50 border-t border-slate-100 flex items-center justify-between">
                      <div className="flex items-center gap-6 text-sm">
                        <div className="flex items-center gap-1.5 text-slate-600">
                          <Calendar className="w-4 h-4 text-slate-400" />
                          {rs.frequency}
                        </div>
                        <div className="flex items-center gap-1.5 text-slate-600">
                          <DollarSign className="w-4 h-4 text-slate-400" />
                          {formatCurrency(rs.estimatedCost)}
                        </div>
                      </div>
                      <div className="flex gap-2">
                        {rs.relatedConditions.slice(0, 2).map((cond, i) => (
                          <span key={i} className="text-xs px-2 py-1 bg-white text-slate-600 rounded border border-slate-200">
                            {cond}
                          </span>
                        ))}
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        )}

      </div>
    </div>
  );
}
