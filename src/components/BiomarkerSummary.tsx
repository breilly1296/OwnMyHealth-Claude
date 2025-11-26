import React from 'react';
import { CheckCircle, XCircle, AlertCircle } from 'lucide-react';
import type { Biomarker } from '../types';

interface BiomarkerSummaryProps {
  biomarkers: Biomarker[];
  category: string;
}

const categoryColors = {
  'Body Composition': {
    bg: 'bg-purple-50',
    border: 'border-purple-200',
    text: 'text-purple-700',
    icon: 'text-purple-500'
  },
  'Blood': {
    bg: 'bg-blue-50',
    border: 'border-blue-200',
    text: 'text-blue-700',
    icon: 'text-blue-500'
  },
  'Hormones': {
    bg: 'bg-indigo-50',
    border: 'border-indigo-200',
    text: 'text-indigo-700',
    icon: 'text-indigo-500'
  },
  'Vitamins': {
    bg: 'bg-green-50',
    border: 'border-green-200',
    text: 'text-green-700',
    icon: 'text-green-500'
  },
  'Calcium CT': {
    bg: 'bg-rose-50',
    border: 'border-rose-200',
    text: 'text-rose-700',
    icon: 'text-rose-500'
  },
  'Vital Signs': {
    bg: 'bg-sky-50',
    border: 'border-sky-200',
    text: 'text-sky-700',
    icon: 'text-sky-500'
  },
  'Lipids': {
    bg: 'bg-amber-50',
    border: 'border-amber-200',
    text: 'text-amber-700',
    icon: 'text-amber-500'
  },
  'Kidney Function': {
    bg: 'bg-emerald-50',
    border: 'border-emerald-200',
    text: 'text-emerald-700',
    icon: 'text-emerald-500'
  },
  'Liver Function': {
    bg: 'bg-teal-50',
    border: 'border-teal-200',
    text: 'text-teal-700',
    icon: 'text-teal-500'
  },
  'Inflammation Markers': {
    bg: 'bg-orange-50',
    border: 'border-orange-200',
    text: 'text-orange-700',
    icon: 'text-orange-500'
  },
  'Electrolytes': {
    bg: 'bg-cyan-50',
    border: 'border-cyan-200',
    text: 'text-cyan-700',
    icon: 'text-cyan-500'
  },
  'EKG': {
    bg: 'bg-fuchsia-50',
    border: 'border-fuchsia-200',
    text: 'text-fuchsia-700',
    icon: 'text-fuchsia-500'
  }
};

export default function BiomarkerSummary({ biomarkers, category }: BiomarkerSummaryProps) {
  const categoryBiomarkers = biomarkers.filter(b => b.category === category);
  const outOfRange = categoryBiomarkers.filter(b => 
    b.value < b.normalRange.min || b.value > b.normalRange.max
  );
  const inRange = categoryBiomarkers.filter(b => 
    b.value >= b.normalRange.min && b.value <= b.normalRange.max
  );

  const mostRecentOutOfRange = outOfRange.length > 0 
    ? outOfRange.reduce((latest, current) => 
        new Date(current.date) > new Date(latest.date) ? current : latest
      )
    : null;

  const colors = categoryColors[category as keyof typeof categoryColors] || {
    bg: 'bg-gray-50',
    border: 'border-gray-200',
    text: 'text-gray-700',
    icon: 'text-gray-500'
  };

  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
      <div className={`${colors.bg} p-4 rounded-lg border ${colors.border}`}>
        <div className="flex items-center">
          <CheckCircle className={`w-8 h-8 ${colors.icon} mr-3`} />
          <div>
            <h3 className={`text-lg font-semibold ${colors.text}`}>In Range</h3>
            <p className={`text-3xl font-bold ${colors.text}`}>{inRange.length}</p>
            {categoryBiomarkers.length > 0 && (
              <p className={`text-sm ${colors.text} opacity-75`}>
                {Math.round((inRange.length / categoryBiomarkers.length) * 100)}% of measurements
              </p>
            )}
          </div>
        </div>
      </div>

      <div className="bg-red-50 p-4 rounded-lg border border-red-200">
        <div className="flex items-center">
          <XCircle className="w-8 h-8 text-red-500 mr-3" />
          <div>
            <h3 className="text-lg font-semibold text-red-700">Out of Range</h3>
            <p className="text-3xl font-bold text-red-600">{outOfRange.length}</p>
            {categoryBiomarkers.length > 0 && (
              <p className="text-sm text-red-600 opacity-75">
                {Math.round((outOfRange.length / categoryBiomarkers.length) * 100)}% of measurements
              </p>
            )}
          </div>
        </div>
      </div>

      <div className={`${mostRecentOutOfRange ? 'bg-orange-50' : colors.bg} p-4 rounded-lg border ${mostRecentOutOfRange ? 'border-orange-200' : colors.border}`}>
        <h3 className={`text-lg font-semibold ${mostRecentOutOfRange ? 'text-orange-700' : colors.text} mb-2`}>
          Latest Concern
        </h3>
        {mostRecentOutOfRange ? (
          <div className="text-orange-600">
            <p className="font-medium">{mostRecentOutOfRange.name}</p>
            <p className="text-sm">
              {mostRecentOutOfRange.value} {mostRecentOutOfRange.unit}
              {' '}
              ({mostRecentOutOfRange.value < mostRecentOutOfRange.normalRange.min ? 'Low' : 'High'})
            </p>
            <p className="text-xs text-orange-500 mt-1">
              {new Date(mostRecentOutOfRange.date).toLocaleDateString()}
            </p>
          </div>
        ) : (
          <div className={`flex items-center ${colors.text}`}>
            <CheckCircle className={`w-6 h-6 ${colors.icon} mr-2`} />
            <p className="text-sm">All measurements within normal range</p>
          </div>
        )}
      </div>
    </div>
  );
}