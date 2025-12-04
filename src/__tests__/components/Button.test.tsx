/**
 * Button Component Tests
 *
 * Tests for reusable button components.
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';

// Simple test component for demonstration
const TestButton: React.FC<{
  onClick?: () => void;
  disabled?: boolean;
  children: React.ReactNode;
}> = ({ onClick, disabled, children }) => (
  <button onClick={onClick} disabled={disabled}>
    {children}
  </button>
);

describe('Button Component', () => {
  it('should render with text', () => {
    render(<TestButton>Click Me</TestButton>);

    expect(screen.getByText('Click Me')).toBeInTheDocument();
  });

  it('should call onClick when clicked', () => {
    const handleClick = vi.fn();
    render(<TestButton onClick={handleClick}>Click Me</TestButton>);

    fireEvent.click(screen.getByText('Click Me'));

    expect(handleClick).toHaveBeenCalledTimes(1);
  });

  it('should not call onClick when disabled', () => {
    const handleClick = vi.fn();
    render(
      <TestButton onClick={handleClick} disabled>
        Click Me
      </TestButton>
    );

    fireEvent.click(screen.getByText('Click Me'));

    expect(handleClick).not.toHaveBeenCalled();
  });

  it('should have disabled attribute when disabled prop is true', () => {
    render(<TestButton disabled>Click Me</TestButton>);

    expect(screen.getByText('Click Me')).toBeDisabled();
  });
});
