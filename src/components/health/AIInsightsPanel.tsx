import React, { useState } from 'react';
import {
  Brain,
  AlertTriangle,
  TrendingUp,
  TrendingDown,
  Activity,
  Shield,
  Target,
  ChevronDown,
  ChevronUp,
  Clock,
  Heart,
  Zap
} from 'lucide-react';
import type { AIAnalysisResult, Biomarker } from '../../types';

/**
 * Props for the AIInsightsPanel component.
 * @property analysis - AI analysis results including health score, risks, and trends
 * @property biomarkers - Array of biomarkers to cross-reference with analysis
 */
interface AIInsightsPanelProps {
  analysis: AIAnalysisResult;
  biomarkers: Biomarker[];
}

const RISK_COLORS = {
  low: 'text-green-600 bg-green-100',
  moderate: 'text-yellow-600 bg-yellow-100',
  high: 'text-orange-600 bg-orange-100',
  critical: 'text-red-600 bg-red-100'
};

const URGENCY_COLORS = {
  routine: 'text-gray-600 bg-gray-100',
  'follow-up': 'text-blue-600 bg-blue-100',
  urgent: 'text-orange-600 bg-orange-100',
  immediate: 'text-red-600 bg-red-100'
};

const TREND_ICONS = {
  improving: <TrendingUp className="w-4 h-4 text-green-500" />,
  stable: <Activity className="w-4 h-4 text-blue-500" />,
  declining: <TrendingDown className="w-4 h-4 text-red-500" />,
  volatile: <Zap className="w-4 h-4 text-yellow-500" />
};

/**
 * AIInsightsPanel - A comprehensive panel displaying AI-powered health analysis.
 *
 * Provides an expandable accordion interface showing:
 * - Overall Health Score (0-100) with color-coded status
 * - Priority Actions that require immediate attention
 * - Risk Assessment for individual biomarkers with severity levels
 * - Trend Analysis showing biomarker changes over time
 * - Health Insights with actionable recommendations
 *
 * Each section can be expanded/collapsed independently. The panel uses
 * color coding (green/yellow/orange/red) to indicate severity levels
 * and urgency of findings.
 *
 * @param props - The component props
 * @returns A card with expandable health analysis sections
 */
export default function AIInsightsPanel({ analysis, biomarkers }: AIInsightsPanelProps) {
  const [expandedSections, setExpandedSections] = useState<Set<string>>(new Set(['overview']));

  const toggleSection = (section: string) => {
    const newExpanded = new Set(expandedSections);
    if (newExpanded.has(section)) {
      newExpanded.delete(section);
    } else {
      newExpanded.add(section);
    }
    setExpandedSections(newExpanded);
  };

  const getBiomarkerName = (biomarkerId: string) => {
    const biomarker = biomarkers.find(b => b.id === biomarkerId);
    return biomarker?.name || 'Unknown';
  };

  const getHealthScoreColor = (score: number) => {
    if (score >= 80) return 'text-green-600';
    if (score >= 60) return 'text-yellow-600';
    if (score >= 40) return 'text-orange-600';
    return 'text-red-600';
  };

  const getHealthScoreLabel = (score: number) => {
    if (score >= 80) return 'Excellent';
    if (score >= 60) return 'Good';
    if (score >= 40) return 'Fair';
    return 'Needs Attention';
  };

  return (
    <div className="bg-white rounded-lg shadow-lg p-6">
      <div className="flex items-center mb-6">
        <Brain className="w-6 h-6 text-purple-600 mr-3" />
        <h2 className="text-xl font-semibold text-gray-900">AI Health Analysis</h2>
      </div>

      {/* Overall Health Score */}
      <div className="mb-6">
        <div 
          className="flex items-center justify-between cursor-pointer p-4 bg-gray-50 rounded-lg hover:bg-gray-100 transition-colors"
          onClick={() => toggleSection('overview')}
        >
          <div className="flex items-center">
            <Shield className="w-5 h-5 text-purple-600 mr-3" />
            <h3 className="text-lg font-medium">Health Overview</h3>
          </div>
          {expandedSections.has('overview') ? <ChevronUp className="w-5 h-5" /> : <ChevronDown className="w-5 h-5" />}
        </div>
        
        {expandedSections.has('overview') && (
          <div className="mt-4 p-4 border border-gray-200 rounded-lg">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h4 className="text-2xl font-bold">Overall Health Score</h4>
                <p className="text-sm text-gray-600">Based on {biomarkers.length} biomarkers</p>
              </div>
              <div className="text-right">
                <div className={`text-4xl font-bold ${getHealthScoreColor(analysis.overallHealthScore)}`}>
                  {Math.round(analysis.overallHealthScore)}
                </div>
                <div className={`text-sm font-medium ${getHealthScoreColor(analysis.overallHealthScore)}`}>
                  {getHealthScoreLabel(analysis.overallHealthScore)}
                </div>
              </div>
            </div>
            
            {analysis.priorityActions.length > 0 && (
              <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4">
                <h5 className="font-medium text-yellow-800 mb-2">Priority Actions</h5>
                <ul className="space-y-1">
                  {analysis.priorityActions.map((action, index) => (
                    <li key={index} className="text-sm text-yellow-700 flex items-start">
                      <Target className="w-4 h-4 mr-2 mt-0.5 flex-shrink-0" />
                      {action}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Risk Assessments */}
      <div className="mb-6">
        <div 
          className="flex items-center justify-between cursor-pointer p-4 bg-gray-50 rounded-lg hover:bg-gray-100 transition-colors"
          onClick={() => toggleSection('risks')}
        >
          <div className="flex items-center">
            <AlertTriangle className="w-5 h-5 text-red-600 mr-3" />
            <h3 className="text-lg font-medium">Risk Assessment</h3>
            <span className="ml-2 px-2 py-1 bg-red-100 text-red-800 text-xs rounded-full">
              {analysis.riskAssessments.filter(r => r.riskLevel === 'high' || r.riskLevel === 'critical').length}
            </span>
          </div>
          {expandedSections.has('risks') ? <ChevronUp className="w-5 h-5" /> : <ChevronDown className="w-5 h-5" />}
        </div>
        
        {expandedSections.has('risks') && (
          <div className="mt-4 space-y-3">
            {analysis.riskAssessments
              .filter(risk => risk.riskLevel !== 'low')
              .sort((a, b) => b.riskScore - a.riskScore)
              .map((risk, index) => (
                <div key={index} className="border border-gray-200 rounded-lg p-4">
                  <div className="flex items-start justify-between mb-3">
                    <div>
                      <h4 className="font-medium text-gray-900">{getBiomarkerName(risk.biomarkerId)}</h4>
                      <p className="text-sm text-gray-600 mt-1">{risk.clinicalSignificance}</p>
                    </div>
                    <div className="flex flex-col items-end space-y-2">
                      <span className={`px-3 py-1 rounded-full text-xs font-medium ${RISK_COLORS[risk.riskLevel]}`}>
                        {risk.riskLevel.toUpperCase()} RISK
                      </span>
                      <span className={`px-2 py-1 rounded text-xs ${URGENCY_COLORS[risk.urgency]}`}>
                        <Clock className="w-3 h-3 inline mr-1" />
                        {risk.urgency.toUpperCase()}
                      </span>
                    </div>
                  </div>
                  
                  <div className="mb-3">
                    <div className="flex items-center justify-between text-sm mb-1">
                      <span>Risk Score</span>
                      <span className="font-medium">{risk.riskScore}/100</span>
                    </div>
                    <div className="w-full bg-gray-200 rounded-full h-2">
                      <div 
                        className={`h-2 rounded-full ${
                          risk.riskScore >= 80 ? 'bg-red-500' :
                          risk.riskScore >= 60 ? 'bg-orange-500' :
                          risk.riskScore >= 40 ? 'bg-yellow-500' : 'bg-green-500'
                        }`}
                        style={{ width: `${risk.riskScore}%` }}
                      />
                    </div>
                  </div>

                  {risk.recommendations.length > 0 && (
                    <div>
                      <h5 className="text-sm font-medium text-gray-700 mb-2">Recommendations:</h5>
                      <ul className="space-y-1">
                        {risk.recommendations.map((rec, recIndex) => (
                          <li key={recIndex} className="text-sm text-gray-600 flex items-start">
                            <span className="w-1.5 h-1.5 bg-gray-400 rounded-full mt-2 mr-2 flex-shrink-0" />
                            {rec}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              ))}
          </div>
        )}
      </div>

      {/* Trend Analysis */}
      {analysis.trendAnalyses.length > 0 && (
        <div className="mb-6">
          <div 
            className="flex items-center justify-between cursor-pointer p-4 bg-gray-50 rounded-lg hover:bg-gray-100 transition-colors"
            onClick={() => toggleSection('trends')}
          >
            <div className="flex items-center">
              <TrendingUp className="w-5 h-5 text-blue-600 mr-3" />
              <h3 className="text-lg font-medium">Trend Analysis</h3>
              <span className="ml-2 px-2 py-1 bg-blue-100 text-blue-800 text-xs rounded-full">
                {analysis.trendAnalyses.length}
              </span>
            </div>
            {expandedSections.has('trends') ? <ChevronUp className="w-5 h-5" /> : <ChevronDown className="w-5 h-5" />}
          </div>
          
          {expandedSections.has('trends') && (
            <div className="mt-4 space-y-3">
              {analysis.trendAnalyses.map((trend, index) => (
                <div key={index} className="border border-gray-200 rounded-lg p-4">
                  <div className="flex items-center justify-between mb-3">
                    <h4 className="font-medium text-gray-900">{getBiomarkerName(trend.biomarkerId)}</h4>
                    <div className="flex items-center space-x-2">
                      {TREND_ICONS[trend.trendDirection]}
                      <span className="text-sm font-medium capitalize">{trend.trendDirection}</span>
                    </div>
                  </div>
                  
                  <div className="grid grid-cols-2 gap-4 text-sm">
                    <div>
                      <span className="text-gray-600">Change Rate:</span>
                      <span className={`ml-2 font-medium ${
                        trend.changeRate > 0 ? 'text-green-600' : 
                        trend.changeRate < 0 ? 'text-red-600' : 'text-gray-600'
                      }`}>
                        {trend.changeRate > 0 ? '+' : ''}{trend.changeRate.toFixed(1)}%
                      </span>
                    </div>
                    <div>
                      <span className="text-gray-600">Confidence:</span>
                      <span className="ml-2 font-medium">{Math.round(trend.confidence * 100)}%</span>
                    </div>
                  </div>

                  {trend.significantChanges.length > 0 && (
                    <div className="mt-3">
                      <h5 className="text-sm font-medium text-gray-700 mb-2">Significant Changes:</h5>
                      <div className="space-y-1">
                        {trend.significantChanges
                          .filter(change => change.significance !== 'normal')
                          .slice(0, 3)
                          .map((change, changeIndex) => (
                            <div key={changeIndex} className="flex items-center justify-between text-xs">
                              <span className="text-gray-600">{new Date(change.date).toLocaleDateString()}</span>
                              <span className={`font-medium ${
                                change.significance === 'concerning' ? 'text-red-600' : 'text-yellow-600'
                              }`}>
                                {change.changeFromPrevious > 0 ? '+' : ''}{change.changeFromPrevious.toFixed(1)}%
                              </span>
                            </div>
                          ))}
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Health Insights */}
      {analysis.healthInsights.length > 0 && (
        <div className="mb-6">
          <div 
            className="flex items-center justify-between cursor-pointer p-4 bg-gray-50 rounded-lg hover:bg-gray-100 transition-colors"
            onClick={() => toggleSection('insights')}
          >
            <div className="flex items-center">
              <Heart className="w-5 h-5 text-pink-600 mr-3" />
              <h3 className="text-lg font-medium">Health Insights</h3>
              <span className="ml-2 px-2 py-1 bg-pink-100 text-pink-800 text-xs rounded-full">
                {analysis.healthInsights.length}
              </span>
            </div>
            {expandedSections.has('insights') ? <ChevronUp className="w-5 h-5" /> : <ChevronDown className="w-5 h-5" />}
          </div>
          
          {expandedSections.has('insights') && (
            <div className="mt-4 space-y-3">
              {analysis.healthInsights.map((insight, index) => (
                <div key={index} className={`border rounded-lg p-4 ${
                  insight.severity === 'danger' ? 'border-red-200 bg-red-50' :
                  insight.severity === 'warning' ? 'border-yellow-200 bg-yellow-50' :
                  'border-blue-200 bg-blue-50'
                }`}>
                  <div className="flex items-start justify-between mb-3">
                    <div>
                      <h4 className={`font-medium ${
                        insight.severity === 'danger' ? 'text-red-800' :
                        insight.severity === 'warning' ? 'text-yellow-800' :
                        'text-blue-800'
                      }`}>
                        {insight.title}
                      </h4>
                      <p className={`text-sm mt-1 ${
                        insight.severity === 'danger' ? 'text-red-700' :
                        insight.severity === 'warning' ? 'text-yellow-700' :
                        'text-blue-700'
                      }`}>
                        {insight.description}
                      </p>
                    </div>
                    <span className={`px-2 py-1 rounded text-xs font-medium ${
                      insight.severity === 'danger' ? 'bg-red-100 text-red-800' :
                      insight.severity === 'warning' ? 'bg-yellow-100 text-yellow-800' :
                      'bg-blue-100 text-blue-800'
                    }`}>
                      {insight.type.toUpperCase()}
                    </span>
                  </div>

                  {insight.actionItems.length > 0 && (
                    <div>
                      <h5 className={`text-sm font-medium mb-2 ${
                        insight.severity === 'danger' ? 'text-red-700' :
                        insight.severity === 'warning' ? 'text-yellow-700' :
                        'text-blue-700'
                      }`}>
                        Action Items:
                      </h5>
                      <ul className="space-y-1">
                        {insight.actionItems.map((action, actionIndex) => (
                          <li key={actionIndex} className={`text-sm flex items-start ${
                            insight.severity === 'danger' ? 'text-red-600' :
                            insight.severity === 'warning' ? 'text-yellow-600' :
                            'text-blue-600'
                          }`}>
                            <span className="w-1.5 h-1.5 bg-current rounded-full mt-2 mr-2 flex-shrink-0" />
                            {action}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}