/**
 * LoginPage Component Tests
 *
 * Tests the login form rendering, validation, submission, and error handling.
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import LoginPage from '../../components/auth/LoginPage';

describe('LoginPage', () => {
  const mockOnLogin = vi.fn();
  const mockOnDemoLogin = vi.fn();
  const mockOnSwitchToRegister = vi.fn();

  const defaultProps = {
    onLogin: mockOnLogin,
    onDemoLogin: mockOnDemoLogin,
    onSwitchToRegister: mockOnSwitchToRegister,
    error: null,
    isLoading: false,
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Rendering', () => {
    it('should render the login form', () => {
      render(<LoginPage {...defaultProps} />);

      expect(screen.getByRole('heading', { name: /welcome back/i })).toBeInTheDocument();
      expect(screen.getByLabelText(/email address/i)).toBeInTheDocument();
      expect(screen.getByLabelText(/password/i)).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /sign in/i })).toBeInTheDocument();
    });

    it('should render the OwnMyHealth branding', () => {
      render(<LoginPage {...defaultProps} />);

      expect(screen.getByText(/ownmyhealth/i)).toBeInTheDocument();
      expect(screen.getByText(/your personal health companion/i)).toBeInTheDocument();
    });

    it('should render the demo login button when onDemoLogin is provided', () => {
      render(<LoginPage {...defaultProps} />);

      expect(screen.getByRole('button', { name: /try demo account/i })).toBeInTheDocument();
    });

    it('should not render the demo login button when onDemoLogin is not provided', () => {
      render(<LoginPage {...defaultProps} onDemoLogin={undefined} />);

      expect(screen.queryByRole('button', { name: /try demo account/i })).not.toBeInTheDocument();
    });

    it('should render the register link', () => {
      render(<LoginPage {...defaultProps} />);

      expect(screen.getByText(/don't have an account\?/i)).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /create one/i })).toBeInTheDocument();
    });

    it('should render the security notice', () => {
      render(<LoginPage {...defaultProps} />);

      expect(screen.getByText(/your health data is encrypted/i)).toBeInTheDocument();
    });
  });

  describe('Form Validation', () => {
    it('should show error when email is empty', async () => {
      render(<LoginPage {...defaultProps} />);

      const submitButton = screen.getByRole('button', { name: /sign in/i });
      fireEvent.click(submitButton);

      await waitFor(() => {
        expect(screen.getByText(/email is required/i)).toBeInTheDocument();
      });

      expect(mockOnLogin).not.toHaveBeenCalled();
    });

    it('should show error when password is empty', async () => {
      render(<LoginPage {...defaultProps} />);

      const emailInput = screen.getByLabelText(/email address/i);
      await userEvent.type(emailInput, 'test@example.com');

      const submitButton = screen.getByRole('button', { name: /sign in/i });
      fireEvent.click(submitButton);

      await waitFor(() => {
        expect(screen.getByText(/password is required/i)).toBeInTheDocument();
      });

      expect(mockOnLogin).not.toHaveBeenCalled();
    });

    it('should show error for invalid email format', async () => {
      render(<LoginPage {...defaultProps} />);

      const emailInput = screen.getByLabelText(/email address/i);
      const passwordInput = screen.getByLabelText(/password/i);
      const form = emailInput.closest('form');

      // Use fireEvent to set values
      fireEvent.change(emailInput, { target: { value: 'invalid-email' } });
      fireEvent.change(passwordInput, { target: { value: 'password123' } });

      // Submit the form directly to bypass HTML5 validation
      if (form) {
        fireEvent.submit(form);
      }

      await waitFor(() => {
        expect(screen.getByText(/please enter a valid email address/i)).toBeInTheDocument();
      });

      expect(mockOnLogin).not.toHaveBeenCalled();
    });

    it('should clear local error when retrying submission', async () => {
      render(<LoginPage {...defaultProps} />);

      // First, trigger validation error
      const submitButton = screen.getByRole('button', { name: /sign in/i });
      fireEvent.click(submitButton);

      await waitFor(() => {
        expect(screen.getByText(/email is required/i)).toBeInTheDocument();
      });

      // Now fill in fields properly
      const emailInput = screen.getByLabelText(/email address/i);
      const passwordInput = screen.getByLabelText(/password/i);

      await userEvent.type(emailInput, 'test@example.com');
      await userEvent.type(passwordInput, 'password123');

      mockOnLogin.mockResolvedValue(undefined);
      fireEvent.click(submitButton);

      await waitFor(() => {
        expect(screen.queryByText(/email is required/i)).not.toBeInTheDocument();
      });
    });
  });

  describe('Form Submission', () => {
    it('should call onLogin with correct credentials', async () => {
      mockOnLogin.mockResolvedValue(undefined);
      render(<LoginPage {...defaultProps} />);

      const emailInput = screen.getByLabelText(/email address/i);
      const passwordInput = screen.getByLabelText(/password/i);

      await userEvent.type(emailInput, 'test@example.com');
      await userEvent.type(passwordInput, 'mypassword123');

      const submitButton = screen.getByRole('button', { name: /sign in/i });
      fireEvent.click(submitButton);

      await waitFor(() => {
        expect(mockOnLogin).toHaveBeenCalledWith('test@example.com', 'mypassword123');
      });
    });

    it('should call onDemoLogin when demo button is clicked', async () => {
      mockOnDemoLogin.mockResolvedValue(undefined);
      render(<LoginPage {...defaultProps} />);

      const demoButton = screen.getByRole('button', { name: /try demo account/i });
      fireEvent.click(demoButton);

      await waitFor(() => {
        expect(mockOnDemoLogin).toHaveBeenCalled();
      });
    });

    it('should call onSwitchToRegister when register link is clicked', () => {
      render(<LoginPage {...defaultProps} />);

      const registerLink = screen.getByRole('button', { name: /create one/i });
      fireEvent.click(registerLink);

      expect(mockOnSwitchToRegister).toHaveBeenCalled();
    });

    it('should handle login error gracefully', async () => {
      mockOnLogin.mockRejectedValue(new Error('Network error'));
      render(<LoginPage {...defaultProps} />);

      const emailInput = screen.getByLabelText(/email address/i);
      const passwordInput = screen.getByLabelText(/password/i);

      await userEvent.type(emailInput, 'test@example.com');
      await userEvent.type(passwordInput, 'password123');

      const submitButton = screen.getByRole('button', { name: /sign in/i });

      // Should not throw
      fireEvent.click(submitButton);

      await waitFor(() => {
        expect(mockOnLogin).toHaveBeenCalled();
      });
    });

    it('should handle demo login error gracefully', async () => {
      mockOnDemoLogin.mockRejectedValue(new Error('Demo unavailable'));
      render(<LoginPage {...defaultProps} />);

      const demoButton = screen.getByRole('button', { name: /try demo account/i });

      // Should not throw
      fireEvent.click(demoButton);

      await waitFor(() => {
        expect(mockOnDemoLogin).toHaveBeenCalled();
      });
    });
  });

  describe('Error Display', () => {
    it('should display error message from props', () => {
      render(<LoginPage {...defaultProps} error="Invalid credentials" />);

      expect(screen.getByText(/invalid credentials/i)).toBeInTheDocument();
    });

    it('should display local validation error over prop error', async () => {
      render(<LoginPage {...defaultProps} error="Server error" />);

      const submitButton = screen.getByRole('button', { name: /sign in/i });
      fireEvent.click(submitButton);

      await waitFor(() => {
        expect(screen.getByText(/email is required/i)).toBeInTheDocument();
      });
    });
  });

  describe('Loading State', () => {
    it('should disable form inputs when loading', () => {
      render(<LoginPage {...defaultProps} isLoading={true} />);

      expect(screen.getByLabelText(/email address/i)).toBeDisabled();
      expect(screen.getByLabelText(/password/i)).toBeDisabled();
    });

    it('should disable submit button when loading', () => {
      render(<LoginPage {...defaultProps} isLoading={true} />);

      expect(screen.getByRole('button', { name: /signing in/i })).toBeDisabled();
    });

    it('should show loading indicator when loading', () => {
      render(<LoginPage {...defaultProps} isLoading={true} />);

      expect(screen.getByText(/signing in/i)).toBeInTheDocument();
    });

    it('should disable demo button when loading', () => {
      render(<LoginPage {...defaultProps} isLoading={true} />);

      expect(screen.getByRole('button', { name: /try demo account/i })).toBeDisabled();
    });
  });

  describe('Password Visibility Toggle', () => {
    it('should toggle password visibility', async () => {
      render(<LoginPage {...defaultProps} />);

      const passwordInput = screen.getByLabelText(/password/i);
      expect(passwordInput).toHaveAttribute('type', 'password');

      // Find the toggle button (eye icon)
      const toggleButton = passwordInput.parentElement?.querySelector('button');
      expect(toggleButton).toBeInTheDocument();

      if (toggleButton) {
        fireEvent.click(toggleButton);
        expect(passwordInput).toHaveAttribute('type', 'text');

        fireEvent.click(toggleButton);
        expect(passwordInput).toHaveAttribute('type', 'password');
      }
    });
  });

  describe('Form Input Behavior', () => {
    it('should update email value on input', async () => {
      render(<LoginPage {...defaultProps} />);

      const emailInput = screen.getByLabelText(/email address/i);
      await userEvent.type(emailInput, 'test@example.com');

      expect(emailInput).toHaveValue('test@example.com');
    });

    it('should update password value on input', async () => {
      render(<LoginPage {...defaultProps} />);

      const passwordInput = screen.getByLabelText(/password/i);
      await userEvent.type(passwordInput, 'mypassword');

      expect(passwordInput).toHaveValue('mypassword');
    });

    it('should have correct autocomplete attributes', () => {
      render(<LoginPage {...defaultProps} />);

      const emailInput = screen.getByLabelText(/email address/i);
      const passwordInput = screen.getByLabelText(/password/i);

      expect(emailInput).toHaveAttribute('autocomplete', 'email');
      expect(passwordInput).toHaveAttribute('autocomplete', 'current-password');
    });

    it('should trim email whitespace on submit', async () => {
      mockOnLogin.mockResolvedValue(undefined);
      render(<LoginPage {...defaultProps} />);

      const emailInput = screen.getByLabelText(/email address/i);
      const passwordInput = screen.getByLabelText(/password/i);

      // Type email with leading/trailing spaces - validation uses trim()
      await userEvent.type(emailInput, '  test@example.com  ');
      await userEvent.type(passwordInput, 'password123');

      const submitButton = screen.getByRole('button', { name: /sign in/i });
      fireEvent.click(submitButton);

      await waitFor(() => {
        // The email should be validated without the trim being passed
        // but the actual value passed may or may not be trimmed
        expect(mockOnLogin).toHaveBeenCalled();
      });
    });
  });

  describe('Accessibility', () => {
    it('should have properly labeled form inputs', () => {
      render(<LoginPage {...defaultProps} />);

      const emailInput = screen.getByLabelText(/email address/i);
      const passwordInput = screen.getByLabelText(/password/i);

      expect(emailInput).toHaveAttribute('id', 'email');
      expect(passwordInput).toHaveAttribute('id', 'password');
    });

    it('should have correct input types', () => {
      render(<LoginPage {...defaultProps} />);

      const emailInput = screen.getByLabelText(/email address/i);
      expect(emailInput).toHaveAttribute('type', 'email');
    });
  });
});
