import React, { useState } from 'react';
import {
  FileText,
  ChevronDown,
  ChevronUp,
  CheckCircle,
  AlertTriangle,
  XCircle,
  Clock,
  Lightbulb,
  Heart,
  Target,
  TrendingUp,
  Info
} from 'lucide-react';
import type { Biomarker, RiskAssessment } from '../../types';
import { generateComprehensiveReport } from '../../utils/health/healthReportEngine';

interface PlainEnglishSummaryProps {
  biomarkers: Biomarker[];
  riskAssessments: RiskAssessment[];
  isOpen: boolean;
  onClose: () => void;
}

const RISK_COLORS = {
  low: 'text-green-700 bg-green-50 border-green-200',
  moderate: 'text-yellow-700 bg-yellow-50 border-yellow-200',
  high: 'text-orange-700 bg-orange-50 border-orange-200',
  critical: 'text-red-700 bg-red-50 border-red-200'
};

const RISK_ICONS = {
  low: <CheckCircle className="w-5 h-5 text-green-600" />,
  moderate: <Clock className="w-5 h-5 text-yellow-600" />,
  high: <AlertTriangle className="w-5 h-5 text-orange-600" />,
  critical: <XCircle className="w-5 h-5 text-red-600" />
};

export default function PlainEnglishSummary({ 
  biomarkers, 
  riskAssessments, 
  isOpen, 
  onClose 
}: PlainEnglishSummaryProps) {
  const [expandedSections, setExpandedSections] = useState<Set<string>>(new Set(['overview']));
  const [selectedBiomarker, setSelectedBiomarker] = useState<string | null>(null);

  if (!isOpen) return null;

  const report = generateComprehensiveReport(biomarkers, riskAssessments);

  const toggleSection = (section: string) => {
    const newExpanded = new Set(expandedSections);
    if (newExpanded.has(section)) {
      newExpanded.delete(section);
    } else {
      newExpanded.add(section);
    }
    setExpandedSections(newExpanded);
  };

  // Use toggleSection for section expansion (available for UI interactions)
  void toggleSection;

  const getBiomarkerRisk = (biomarkerId: string) => {
    return riskAssessments.find(r => r.biomarkerId === biomarkerId);
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg w-full max-w-4xl max-h-[90vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-gray-200">
          <div className="flex items-center">
            <FileText className="w-6 h-6 text-blue-600 mr-3" />
            <div>
              <h2 className="text-xl font-semibold text-gray-900">Your Lab Results Explained</h2>
              <p className="text-sm text-gray-600">Plain English summary of your health markers</p>
            </div>
          </div>
          <button 
            onClick={onClose}
            className="text-gray-500 hover:text-gray-700 p-2"
          >
            <XCircle className="w-6 h-6" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {/* Overall Summary */}
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-6">
            <div className="flex items-start">
              <Heart className="w-6 h-6 text-blue-600 mr-3 mt-1 flex-shrink-0" />
              <div>
                <h3 className="text-lg font-semibold text-blue-900 mb-2">Overall Health Summary</h3>
                <p className="text-blue-800 leading-relaxed">{report.overallSummary}</p>
              </div>
            </div>
          </div>

          {/* Key Findings */}
          {report.keyFindings.length > 0 && (
            <div className="bg-orange-50 border border-orange-200 rounded-lg p-6">
              <div className="flex items-start">
                <AlertTriangle className="w-6 h-6 text-orange-600 mr-3 mt-1 flex-shrink-0" />
                <div>
                  <h3 className="text-lg font-semibold text-orange-900 mb-3">Key Findings That Need Attention</h3>
                  <ul className="space-y-2">
                    {report.keyFindings.map((finding, index) => (
                      <li key={index} className="text-orange-800 flex items-start">
                        <span className="w-2 h-2 bg-orange-500 rounded-full mt-2 mr-3 flex-shrink-0" />
                        {finding}
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            </div>
          )}

          {/* Priority Actions */}
          {report.priorityActions.length > 0 && (
            <div className="bg-red-50 border border-red-200 rounded-lg p-6">
              <div className="flex items-start">
                <Target className="w-6 h-6 text-red-600 mr-3 mt-1 flex-shrink-0" />
                <div>
                  <h3 className="text-lg font-semibold text-red-900 mb-3">What You Need to Do Next</h3>
                  <ul className="space-y-2">
                    {report.priorityActions.map((action, index) => (
                      <li key={index} className="text-red-800 flex items-start">
                        <span className="w-2 h-2 bg-red-500 rounded-full mt-2 mr-3 flex-shrink-0" />
                        {action}
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            </div>
          )}

          {/* Positive Findings */}
          {report.positiveFindings.length > 0 && (
            <div className="bg-green-50 border border-green-200 rounded-lg p-6">
              <div className="flex items-start">
                <CheckCircle className="w-6 h-6 text-green-600 mr-3 mt-1 flex-shrink-0" />
                <div>
                  <h3 className="text-lg font-semibold text-green-900 mb-3">Good News - These Results Look Great!</h3>
                  <ul className="space-y-2">
                    {report.positiveFindings.map((finding, index) => (
                      <li key={index} className="text-green-800 flex items-start">
                        <span className="w-2 h-2 bg-green-500 rounded-full mt-2 mr-3 flex-shrink-0" />
                        {finding}
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            </div>
          )}

          {/* Individual Biomarker Explanations */}
          <div className="space-y-4">
            <h3 className="text-lg font-semibold text-gray-900 flex items-center">
              <Lightbulb className="w-5 h-5 text-yellow-500 mr-2" />
              Detailed Explanations for Each Test
            </h3>
            
            {report.summaries.map((summary, index) => {
              const biomarker = biomarkers.find(b => b.id === summary.biomarkerId)!;
              const risk = getBiomarkerRisk(summary.biomarkerId)!;
              const isExpanded = selectedBiomarker === summary.biomarkerId;
              
              return (
                <div key={index} className={`border rounded-lg ${RISK_COLORS[risk.riskLevel]}`}>
                  <button
                    onClick={() => setSelectedBiomarker(isExpanded ? null : summary.biomarkerId)}
                    className="w-full p-4 text-left flex items-center justify-between hover:bg-opacity-80 transition-colors"
                  >
                    <div className="flex items-center">
                      {RISK_ICONS[risk.riskLevel]}
                      <div className="ml-3">
                        <h4 className="font-medium">{biomarker.name}</h4>
                        <p className="text-sm opacity-90">{summary.simpleExplanation}</p>
                      </div>
                    </div>
                    {isExpanded ? <ChevronUp className="w-5 h-5" /> : <ChevronDown className="w-5 h-5" />}
                  </button>
                  
                  {isExpanded && (
                    <div className="px-4 pb-4 space-y-4">
                      {/* What it means */}
                      <div>
                        <h5 className="font-medium mb-2 flex items-center">
                          <Info className="w-4 h-4 mr-2" />
                          What This Test Measures
                        </h5>
                        <p className="text-sm leading-relaxed">{summary.whatItMeans}</p>
                        {summary.analogy && (
                          <p className="text-sm leading-relaxed mt-2 italic">
                            <strong>Think of it like this:</strong> {summary.analogy}
                          </p>
                        )}
                      </div>

                      {/* Your result */}
                      <div>
                        <h5 className="font-medium mb-2 flex items-center">
                          <TrendingUp className="w-4 h-4 mr-2" />
                          Your Result
                        </h5>
                        <p className="text-sm leading-relaxed">{summary.yourResult}</p>
                      </div>

                      {/* Why it matters */}
                      <div>
                        <h5 className="font-medium mb-2">Why This Matters</h5>
                        <p className="text-sm leading-relaxed">{summary.whyItMatters}</p>
                      </div>

                      {/* Action needed */}
                      <div>
                        <h5 className="font-medium mb-2">What You Should Do</h5>
                        <p className="text-sm leading-relaxed mb-3">{summary.actionNeeded}</p>
                        
                        {summary.nextSteps.length > 0 && (
                          <div>
                            <h6 className="text-sm font-medium mb-2">Next Steps:</h6>
                            <ul className="space-y-1">
                              {summary.nextSteps.map((step, stepIndex) => (
                                <li key={stepIndex} className="text-sm flex items-start">
                                  <span className="w-1.5 h-1.5 bg-current rounded-full mt-2 mr-2 flex-shrink-0" />
                                  {step}
                                </li>
                              ))}
                            </ul>
                          </div>
                        )}
                      </div>

                      {/* Related factors */}
                      {summary.relatedFactors.length > 0 && (
                        <div>
                          <h5 className="font-medium mb-2">Factors That Can Affect This Test</h5>
                          <div className="flex flex-wrap gap-2">
                            {summary.relatedFactors.map((factor, factorIndex) => (
                              <span 
                                key={factorIndex}
                                className="px-2 py-1 bg-white bg-opacity-50 rounded text-xs"
                              >
                                {factor}
                              </span>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* Timeframe */}
                      <div className="text-xs opacity-75 border-t pt-2">
                        <strong>Timeframe:</strong> {summary.timeframe}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* Disclaimer */}
          <div className="bg-gray-50 border border-gray-200 rounded-lg p-4">
            <p className="text-xs text-gray-600 leading-relaxed">
              <strong>Important:</strong> This summary is for educational purposes only and should not replace professional medical advice. 
              Always consult with your healthcare provider about your lab results and any health concerns. 
              Your doctor can provide personalized interpretation based on your complete medical history and current health status.
            </p>
          </div>
        </div>

        {/* Footer */}
        <div className="border-t border-gray-200 p-4 bg-gray-50">
          <div className="flex justify-between items-center">
            <p className="text-sm text-gray-600">
              Generated on {new Date().toLocaleDateString()} • {biomarkers.length} tests analyzed
            </p>
            <button
              onClick={onClose}
              className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 transition-colors"
            >
              Close Report
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}