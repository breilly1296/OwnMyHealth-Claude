/**
 * ConfirmEmailChangePage Component Tests
 *
 * Regression guard for the one-time-token double-fire bug found during live
 * smoke-testing: the confirm call consumes a single-use token, so it must fire
 * EXACTLY ONCE. The original `[token, onSuccess]` effect re-fired whenever the
 * parent (AppContent) re-rendered — e.g. when AuthContext settled its initial
 * session check and handed down a fresh inline `onSuccess` — and the second
 * call 400'd on the now-consumed token, flipping a SUCCESSFUL change to a false
 * "Email Change Failed" screen (reproduced even in a production build, not just
 * under StrictMode).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import ConfirmEmailChangePage from '../../components/auth/ConfirmEmailChangePage';

vi.mock('../../services/api', () => ({
  authApi: { confirmEmailChange: vi.fn() },
}));

import { authApi } from '../../services/api';

const mockedAuth = vi.mocked(authApi);

describe('ConfirmEmailChangePage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('confirms exactly once even when the parent re-renders with a new onSuccess', async () => {
    mockedAuth.confirmEmailChange.mockResolvedValue({ message: 'Your email address has been updated.' });

    const { rerender } = render(
      <ConfirmEmailChangePage token="tok-123" onSuccess={vi.fn()} onNavigateToLogin={vi.fn()} />
    );

    // Simulate the parent re-render that hands down a brand-new onSuccess
    // closure — the exact trigger that made the old effect re-fire.
    rerender(
      <ConfirmEmailChangePage token="tok-123" onSuccess={vi.fn()} onNavigateToLogin={vi.fn()} />
    );

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /email updated/i })).toBeInTheDocument();
    });

    // The single-use token must be spent exactly once.
    expect(mockedAuth.confirmEmailChange).toHaveBeenCalledTimes(1);
    expect(mockedAuth.confirmEmailChange).toHaveBeenCalledWith('tok-123');
  });

  it('renders the failure state when the token is invalid', async () => {
    mockedAuth.confirmEmailChange.mockRejectedValue(new Error('Invalid or expired email-change link'));

    render(<ConfirmEmailChangePage token="bad-token" onSuccess={vi.fn()} onNavigateToLogin={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /email change failed/i })).toBeInTheDocument();
    });
    expect(screen.getByText(/invalid or expired email-change link/i)).toBeInTheDocument();
  });

  it('errors without calling the API when no token is present', async () => {
    render(<ConfirmEmailChangePage token="" onSuccess={vi.fn()} onNavigateToLogin={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getByText(/no confirmation token provided/i)).toBeInTheDocument();
    });
    expect(mockedAuth.confirmEmailChange).not.toHaveBeenCalled();
  });
});
