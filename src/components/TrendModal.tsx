import React from 'react';
import { X } from 'lucide-react';
import { Biomarker } from '../types';
import BiomarkerGraph from './BiomarkerGraph';

interface TrendModalProps {
  isOpen: boolean;
  onClose: () => void;
  biomarker: Biomarker;
}

export default function TrendModal({ isOpen, onClose, biomarker }: TrendModalProps) {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg p-6 w-full max-w-4xl">
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-xl font-semibold">{biomarker.name} Trend</h2>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-700">
            <X className="w-5 h-5" />
          </button>
        </div>
        
        <div className="h-[400px]">
          <BiomarkerGraph biomarker={biomarker} />
        </div>

        <div className="mt-4 grid grid-cols-2 gap-4 text-sm text-gray-600">
          <div>
            <p><strong>Current Value:</strong> {biomarker.value} {biomarker.unit}</p>
            <p><strong>Normal Range:</strong> {biomarker.normalRange.min} - {biomarker.normalRange.max} {biomarker.unit}</p>
          </div>
          <div>
            <p><strong>Category:</strong> {biomarker.category}</p>
            <p><strong>Last Updated:</strong> {new Date(biomarker.date).toLocaleDateString()}</p>
          </div>
        </div>
      </div>
    </div>
  );
}