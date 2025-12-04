/**
 * AddMeasurementModal Component Tests
 *
 * Tests the modal for manually entering biomarker measurements.
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import AddMeasurementModal from '../../components/biomarkers/AddMeasurementModal';

// Mock measurementOptions data
vi.mock('../../data/measurementOptions', () => ({
  measurementOptions: {
    Blood: [
      {
        name: 'Glucose',
        unit: 'mg/dL',
        normalRange: { min: 70, max: 100, source: 'Standard Reference' },
        description: 'Blood sugar level',
      },
      {
        name: 'Hemoglobin',
        unit: 'g/dL',
        normalRange: { min: 12, max: 17, source: 'Standard Reference' },
        description: 'Red blood cell protein',
      },
    ],
    Vitamins: [
      {
        name: 'Vitamin D',
        unit: 'ng/mL',
        normalRange: { min: 30, max: 100, source: 'Standard Reference' },
        description: 'Essential vitamin',
      },
    ],
  },
  normalRangeSources: ['Standard Reference', 'Lab Specific', 'Personal'],
}));

describe('AddMeasurementModal', () => {
  const mockOnClose = vi.fn();
  const mockOnAdd = vi.fn();

  const defaultProps = {
    isOpen: true,
    onClose: mockOnClose,
    category: 'Blood',
    onAdd: mockOnAdd,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    // Mock crypto.randomUUID for consistent test IDs
    vi.spyOn(crypto, 'randomUUID').mockReturnValue('test-uuid-123');
  });

  describe('Rendering', () => {
    it('should render when isOpen is true', () => {
      render(<AddMeasurementModal {...defaultProps} />);

      expect(screen.getByText('Add New Measurement')).toBeInTheDocument();
    });

    it('should not render when isOpen is false', () => {
      render(<AddMeasurementModal {...defaultProps} isOpen={false} />);

      expect(screen.queryByText('Add New Measurement')).not.toBeInTheDocument();
    });

    it('should render biomarker dropdown', () => {
      render(<AddMeasurementModal {...defaultProps} />);

      expect(screen.getByText('Biomarker')).toBeInTheDocument();
      expect(screen.getByRole('combobox')).toBeInTheDocument();
    });

    it('should render value input field', () => {
      render(<AddMeasurementModal {...defaultProps} />);

      expect(screen.getByText('Value')).toBeInTheDocument();
      expect(screen.getByRole('spinbutton')).toBeInTheDocument();
    });

    it('should render date input field', () => {
      render(<AddMeasurementModal {...defaultProps} />);

      expect(screen.getByText('Date')).toBeInTheDocument();
    });

    it('should render notes textarea', () => {
      render(<AddMeasurementModal {...defaultProps} />);

      expect(screen.getByText('Notes')).toBeInTheDocument();
      expect(screen.getByPlaceholderText(/add any relevant notes/i)).toBeInTheDocument();
    });

    it('should render submit and cancel buttons', () => {
      render(<AddMeasurementModal {...defaultProps} />);

      expect(screen.getByRole('button', { name: /add measurement/i })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /cancel/i })).toBeInTheDocument();
    });
  });

  describe('Biomarker Selection', () => {
    it('should show biomarkers for the current category', () => {
      render(<AddMeasurementModal {...defaultProps} category="Blood" />);

      const dropdown = screen.getByRole('combobox');
      fireEvent.click(dropdown);

      expect(screen.getByText('Glucose')).toBeInTheDocument();
      expect(screen.getByText('Hemoglobin')).toBeInTheDocument();
    });

    it('should show different biomarkers for different categories', () => {
      render(<AddMeasurementModal {...defaultProps} category="Vitamins" />);

      const dropdown = screen.getByRole('combobox');
      expect(dropdown).toBeInTheDocument();

      // Should have Vitamin D for Vitamins category
      const options = screen.getAllByRole('option');
      expect(options.some(o => o.textContent === 'Vitamin D')).toBe(true);
    });

    it('should update normal range when biomarker is selected', async () => {
      render(<AddMeasurementModal {...defaultProps} />);

      const dropdown = screen.getByRole('combobox');
      fireEvent.change(dropdown, { target: { value: 'Glucose' } });

      await waitFor(() => {
        expect(screen.getByText(/70 - 100/)).toBeInTheDocument();
      });
    });
  });

  describe('Normal Range Editing', () => {
    it('should show edit range button', async () => {
      render(<AddMeasurementModal {...defaultProps} />);

      // Select a biomarker first
      const dropdown = screen.getByRole('combobox');
      fireEvent.change(dropdown, { target: { value: 'Glucose' } });

      expect(screen.getByText(/edit range/i)).toBeInTheDocument();
    });

    it('should toggle range editing when edit button is clicked', async () => {
      render(<AddMeasurementModal {...defaultProps} />);

      // Select a biomarker
      const dropdown = screen.getByRole('combobox');
      fireEvent.change(dropdown, { target: { value: 'Glucose' } });

      // Click edit range
      const editButton = screen.getByText(/edit range/i);
      fireEvent.click(editButton);

      // Should show min/max inputs
      expect(screen.getByText('Min')).toBeInTheDocument();
      expect(screen.getByText('Max')).toBeInTheDocument();
    });

    it('should show cancel edit option when editing', async () => {
      render(<AddMeasurementModal {...defaultProps} />);

      const dropdown = screen.getByRole('combobox');
      fireEvent.change(dropdown, { target: { value: 'Glucose' } });

      const editButton = screen.getByText(/edit range/i);
      fireEvent.click(editButton);

      expect(screen.getByText(/cancel edit/i)).toBeInTheDocument();
    });

    it('should allow editing min and max values', async () => {
      render(<AddMeasurementModal {...defaultProps} />);

      const dropdown = screen.getByRole('combobox');
      fireEvent.change(dropdown, { target: { value: 'Glucose' } });

      const editButton = screen.getByText(/edit range/i);
      fireEvent.click(editButton);

      // Find min input
      const minInput = screen.getByDisplayValue('70');
      await userEvent.clear(minInput);
      await userEvent.type(minInput, '65');

      expect(minInput).toHaveValue(65);
    });
  });

  describe('Form Submission', () => {
    it('should call onAdd with correct data when form is submitted', async () => {
      render(<AddMeasurementModal {...defaultProps} />);

      // Select biomarker
      const dropdown = screen.getByRole('combobox');
      fireEvent.change(dropdown, { target: { value: 'Glucose' } });

      // Enter value
      const valueInput = screen.getByRole('spinbutton');
      await userEvent.type(valueInput, '95');

      // Submit
      const submitButton = screen.getByRole('button', { name: /add measurement/i });
      fireEvent.click(submitButton);

      await waitFor(() => {
        expect(mockOnAdd).toHaveBeenCalledWith(
          expect.objectContaining({
            name: 'Glucose',
            value: 95,
            unit: 'mg/dL',
            category: 'Blood',
            normalRange: expect.objectContaining({
              min: 70,
              max: 100,
            }),
          })
        );
      });
    });

    it('should include notes in submission when provided', async () => {
      render(<AddMeasurementModal {...defaultProps} />);

      // Select biomarker
      const dropdown = screen.getByRole('combobox');
      fireEvent.change(dropdown, { target: { value: 'Glucose' } });

      // Enter value
      const valueInput = screen.getByRole('spinbutton');
      await userEvent.type(valueInput, '95');

      // Enter notes
      const notesInput = screen.getByPlaceholderText(/add any relevant notes/i);
      await userEvent.type(notesInput, 'Fasting blood sugar');

      // Submit
      const submitButton = screen.getByRole('button', { name: /add measurement/i });
      fireEvent.click(submitButton);

      await waitFor(() => {
        expect(mockOnAdd).toHaveBeenCalledWith(
          expect.objectContaining({
            notes: 'Fasting blood sugar',
          })
        );
      });
    });

    it('should call onClose after successful submission', async () => {
      render(<AddMeasurementModal {...defaultProps} />);

      // Select biomarker
      const dropdown = screen.getByRole('combobox');
      fireEvent.change(dropdown, { target: { value: 'Glucose' } });

      // Enter value
      const valueInput = screen.getByRole('spinbutton');
      await userEvent.type(valueInput, '95');

      // Submit
      const submitButton = screen.getByRole('button', { name: /add measurement/i });
      fireEvent.click(submitButton);

      await waitFor(() => {
        expect(mockOnClose).toHaveBeenCalled();
      });
    });

    it('should reset form after submission', async () => {
      const { rerender } = render(<AddMeasurementModal {...defaultProps} />);

      // Select biomarker
      const dropdown = screen.getByRole('combobox');
      fireEvent.change(dropdown, { target: { value: 'Glucose' } });

      // Enter value
      const valueInput = screen.getByRole('spinbutton');
      await userEvent.type(valueInput, '95');

      // Submit
      const submitButton = screen.getByRole('button', { name: /add measurement/i });
      fireEvent.click(submitButton);

      // Reopen modal (simulate)
      rerender(<AddMeasurementModal {...defaultProps} isOpen={true} />);

      // Form should be reset - dropdown should be at placeholder
      const resetDropdown = screen.getByRole('combobox');
      expect(resetDropdown).toHaveValue('');
    });
  });

  describe('Modal Close', () => {
    it('should call onClose when close button is clicked', () => {
      render(<AddMeasurementModal {...defaultProps} />);

      // Find close button (X icon)
      const closeButton = screen.getByRole('button', { name: '' }); // X button has no text
      fireEvent.click(closeButton);

      expect(mockOnClose).toHaveBeenCalled();
    });

    it('should call onClose when cancel button is clicked', () => {
      render(<AddMeasurementModal {...defaultProps} />);

      const cancelButton = screen.getByRole('button', { name: /cancel/i });
      fireEvent.click(cancelButton);

      expect(mockOnClose).toHaveBeenCalled();
    });
  });

  describe('Form Validation', () => {
    it('should not submit when no biomarker is selected', async () => {
      render(<AddMeasurementModal {...defaultProps} />);

      // Enter value without selecting biomarker
      const valueInput = screen.getByRole('spinbutton');
      await userEvent.type(valueInput, '95');

      // Submit
      const submitButton = screen.getByRole('button', { name: /add measurement/i });
      fireEvent.click(submitButton);

      expect(mockOnAdd).not.toHaveBeenCalled();
    });

    it('should not submit when value is empty', async () => {
      render(<AddMeasurementModal {...defaultProps} />);

      // Select biomarker
      const dropdown = screen.getByRole('combobox');
      fireEvent.change(dropdown, { target: { value: 'Glucose' } });

      // Don't enter value, just submit
      const submitButton = screen.getByRole('button', { name: /add measurement/i });
      fireEvent.click(submitButton);

      expect(mockOnAdd).not.toHaveBeenCalled();
    });

    it('should handle decimal values', async () => {
      render(<AddMeasurementModal {...defaultProps} />);

      // Select biomarker
      const dropdown = screen.getByRole('combobox');
      fireEvent.change(dropdown, { target: { value: 'Glucose' } });

      // Enter decimal value
      const valueInput = screen.getByRole('spinbutton');
      await userEvent.type(valueInput, '95.5');

      // Submit
      const submitButton = screen.getByRole('button', { name: /add measurement/i });
      fireEvent.click(submitButton);

      await waitFor(() => {
        expect(mockOnAdd).toHaveBeenCalledWith(
          expect.objectContaining({
            value: 95.5,
          })
        );
      });
    });
  });

  describe('Empty Category', () => {
    it('should show empty dropdown for category with no biomarkers', () => {
      render(<AddMeasurementModal {...defaultProps} category="NonExistent" />);

      const dropdown = screen.getByRole('combobox');
      const options = dropdown.querySelectorAll('option');

      // Should only have the placeholder option
      expect(options.length).toBe(1);
      expect(options[0].textContent).toBe('Select a biomarker');
    });
  });

  describe('Date Default', () => {
    it('should default to today date', () => {
      render(<AddMeasurementModal {...defaultProps} />);

      const dateInput = screen.getByDisplayValue(new Date().toISOString().split('T')[0]);
      expect(dateInput).toBeInTheDocument();
    });

    it('should allow changing the date', async () => {
      render(<AddMeasurementModal {...defaultProps} />);

      const dateInput = screen.getByDisplayValue(new Date().toISOString().split('T')[0]);
      fireEvent.change(dateInput, { target: { value: '2024-01-15' } });

      expect(dateInput).toHaveValue('2024-01-15');
    });
  });
});
