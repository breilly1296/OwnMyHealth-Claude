import React, { useState } from 'react';
import { X, Edit2 } from 'lucide-react';
import type { Biomarker, NormalRange } from '../../types';
import { measurementOptions, normalRangeSources } from '../../data/measurementOptions';

/**
 * Props for the AddMeasurementModal component.
 * @property isOpen - Controls modal visibility
 * @property onClose - Callback to close the modal
 * @property category - The health category for filtering available biomarkers
 * @property onAdd - Callback fired when a new measurement is submitted
 */
interface AddMeasurementModalProps {
  isOpen: boolean;
  onClose: () => void;
  category: string;
  onAdd: (measurement: Partial<Biomarker>) => void;
}

/**
 * AddMeasurementModal - A form modal for manually entering biomarker measurements.
 *
 * Allows users to:
 * - Select a biomarker from a category-filtered dropdown
 * - Enter a numeric value with the appropriate unit
 * - Optionally customize the normal range (with source citation)
 * - Set the measurement date
 * - Add optional notes
 *
 * The modal pre-populates normal ranges based on the selected biomarker from
 * measurementOptions data, but allows users to override with custom ranges
 * (e.g., from their lab's specific reference ranges).
 *
 * @param props - The component props
 * @returns A modal dialog with the measurement entry form, or null if closed
 */
export default function AddMeasurementModal({ isOpen, onClose, category, onAdd }: AddMeasurementModalProps) {
  const [selectedBiomarker, setSelectedBiomarker] = useState('');
  const [value, setValue] = useState('');
  const [date, setDate] = useState(new Date().toISOString().split('T')[0]);
  const [notes, setNotes] = useState('');
  const [isEditingRange, setIsEditingRange] = useState(false);
  const [normalRange, setNormalRange] = useState<NormalRange>({
    min: 0,
    max: 0,
    source: normalRangeSources[0]
  });

  const categoryBiomarkers = measurementOptions[category] || [];

  const handleBiomarkerChange = (name: string) => {
    setSelectedBiomarker(name);
    const biomarker = categoryBiomarkers.find(b => b.name === name);
    if (biomarker) {
      setNormalRange(biomarker.normalRange);
      setIsEditingRange(false);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const biomarker = categoryBiomarkers.find(b => b.name === selectedBiomarker);
    if (biomarker && value) {
      onAdd({
        id: crypto.randomUUID(),
        name: biomarker.name,
        value: parseFloat(value),
        unit: biomarker.unit,
        date,
        category: category as Biomarker['category'],
        notes: notes.trim() || undefined,
        normalRange: isEditingRange ? normalRange : biomarker.normalRange,
        description: biomarker.description
      });
      onClose();
      setSelectedBiomarker('');
      setValue('');
      setDate(new Date().toISOString().split('T')[0]);
      setNotes('');
      setIsEditingRange(false);
      setNormalRange({ min: 0, max: 0, source: normalRangeSources[0] });
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg p-6 w-full max-w-md">
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-xl font-semibold">Add New Measurement</h2>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-700">
            <X className="w-5 h-5" />
          </button>
        </div>
        <form onSubmit={handleSubmit}>
          <div className="mb-4">
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Biomarker
            </label>
            <select
              value={selectedBiomarker}
              onChange={(e) => handleBiomarkerChange(e.target.value)}
              className="w-full border border-gray-300 rounded-md shadow-sm p-2"
              required
            >
              <option value="">Select a biomarker</option>
              {categoryBiomarkers.map((biomarker) => (
                <option key={biomarker.name} value={biomarker.name}>
                  {biomarker.name}
                </option>
              ))}
            </select>
          </div>
          <div className="mb-4">
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Value
            </label>
            <input
              type="number"
              step="0.1"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              className="w-full border border-gray-300 rounded-md shadow-sm p-2"
              required
            />
          </div>
          <div className="mb-4">
            <div className="flex justify-between items-center mb-2">
              <label className="block text-sm font-medium text-gray-700">
                Normal Range
              </label>
              <button
                type="button"
                onClick={() => setIsEditingRange(!isEditingRange)}
                className="text-blue-600 hover:text-blue-800 text-sm flex items-center"
              >
                <Edit2 className="w-4 h-4 mr-1" />
                {isEditingRange ? 'Cancel Edit' : 'Edit Range'}
              </button>
            </div>
            {isEditingRange ? (
              <div className="space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs text-gray-500 mb-1">Min</label>
                    <input
                      type="number"
                      step="0.1"
                      value={normalRange.min}
                      onChange={(e) => setNormalRange(prev => ({ ...prev, min: parseFloat(e.target.value) }))}
                      className="w-full border border-gray-300 rounded-md shadow-sm p-2"
                      required
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-gray-500 mb-1">Max</label>
                    <input
                      type="number"
                      step="0.1"
                      value={normalRange.max}
                      onChange={(e) => setNormalRange(prev => ({ ...prev, max: parseFloat(e.target.value) }))}
                      className="w-full border border-gray-300 rounded-md shadow-sm p-2"
                      required
                    />
                  </div>
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-1">Source</label>
                  <select
                    value={normalRange.source}
                    onChange={(e) => setNormalRange(prev => ({ ...prev, source: e.target.value }))}
                    className="w-full border border-gray-300 rounded-md shadow-sm p-2"
                    required
                  >
                    {normalRangeSources.map(source => (
                      <option key={source} value={source}>{source}</option>
                    ))}
                  </select>
                </div>
              </div>
            ) : (
              <div className="text-sm text-gray-600">
                {normalRange.min} - {normalRange.max} ({normalRange.source})
              </div>
            )}
          </div>
          <div className="mb-4">
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Date
            </label>
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="w-full border border-gray-300 rounded-md shadow-sm p-2"
              required
            />
          </div>
          <div className="mb-4">
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Notes
            </label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              className="w-full border border-gray-300 rounded-md shadow-sm p-2 min-h-[100px]"
              placeholder="Add any relevant notes about this measurement..."
            />
          </div>
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-gray-700 bg-gray-100 rounded-md hover:bg-gray-200"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700"
            >
              Add Measurement
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}