/**
 * TrendsPage empty-state CTA test (ONB-7).
 *
 * The Trends empty state told the user to "upload a lab report" but had no
 * button. It now renders an "Upload Lab Report" CTA wired to onUploadLab.
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import TrendsPage from '../../components/trends/TrendsPage';

describe('TrendsPage — empty-state upload CTA (ONB-7)', () => {
  it('shows an "Upload Lab Report" button in the empty state and calls onUploadLab on click', () => {
    const onUploadLab = vi.fn();
    render(<TrendsPage biomarkers={[]} onUploadLab={onUploadLab} />);

    expect(screen.getByText(/track changes over time/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /upload lab report/i }));
    expect(onUploadLab).toHaveBeenCalledTimes(1);
  });

  it('renders the empty state without a CTA when no handler is provided (graceful)', () => {
    render(<TrendsPage biomarkers={[]} />);
    expect(screen.getByText(/track changes over time/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /upload lab report/i })).not.toBeInTheDocument();
  });
});
