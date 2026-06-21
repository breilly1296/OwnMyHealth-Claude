/**
 * RegisterPage — ONB-1 verification-funnel tests.
 *
 * After a successful registration the page must show an explicit "check your
 * inbox" state (not silently leave the user on the form), with a working resend
 * that hits the already-existing authApi.resendVerification endpoint.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import RegisterPage from '../../components/auth/RegisterPage';

const mocks = vi.hoisted(() => ({ resendVerification: vi.fn() }));
vi.mock('../../services/api', () => ({
  authApi: { resendVerification: mocks.resendVerification },
}));

describe('RegisterPage — registration → verification funnel (ONB-1)', () => {
  const onRegister = vi.fn();
  const onSwitchToLogin = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    onRegister.mockResolvedValue(undefined);
    mocks.resendVerification.mockResolvedValue({ message: 'sent' });
  });

  const renderPage = () =>
    render(
      <RegisterPage
        onRegister={onRegister}
        onSwitchToLogin={onSwitchToLogin}
        error={null}
        isLoading={false}
      />
    );

  const submitValid = (email = 'jane@user.io') => {
    const pw = 'Abcdef123456!'; // meets all 5 requirements
    fireEvent.change(screen.getByPlaceholderText('you@example.com'), { target: { value: email } });
    fireEvent.change(screen.getByPlaceholderText('Create a strong password'), { target: { value: pw } });
    fireEvent.change(screen.getByPlaceholderText('Confirm your password'), { target: { value: pw } });
    // OMH-L04: must accept Terms + Privacy before the submit button enables.
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(screen.getByRole('button', { name: /create account/i }));
  };

  it('shows a "check your inbox" state with the email after a successful registration', async () => {
    renderPage();
    submitValid('jane@user.io');

    expect(await screen.findByText(/check your inbox/i)).toBeInTheDocument();
    expect(screen.getByText('jane@user.io')).toBeInTheDocument();
    // The form is replaced — no "Create account" button anymore.
    expect(screen.queryByRole('button', { name: /create account/i })).not.toBeInTheDocument();
  });

  it('resends the verification email to the registered address via the existing endpoint', async () => {
    renderPage();
    submitValid('jane@user.io');
    await screen.findByText(/check your inbox/i);

    fireEvent.click(screen.getByRole('button', { name: /resend email/i }));

    await waitFor(() => expect(mocks.resendVerification).toHaveBeenCalledWith('jane@user.io'));
    expect(await screen.findByText(/verification email re-sent/i)).toBeInTheDocument();
  });

  it('does not show the inbox state until registration actually succeeds', () => {
    renderPage();
    expect(screen.queryByText(/check your inbox/i)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /create account/i })).toBeInTheDocument();
  });

  it('blocks registration until Terms/Privacy consent is checked (OMH-L04)', () => {
    renderPage();
    const pw = 'Abcdef123456!';
    fireEvent.change(screen.getByPlaceholderText('you@example.com'), { target: { value: 'jane@user.io' } });
    fireEvent.change(screen.getByPlaceholderText('Create a strong password'), { target: { value: pw } });
    fireEvent.change(screen.getByPlaceholderText('Confirm your password'), { target: { value: pw } });

    // Without consent the submit button is disabled and clicking does nothing.
    const submit = screen.getByRole('button', { name: /create account/i });
    expect(submit).toBeDisabled();
    fireEvent.click(submit);
    expect(onRegister).not.toHaveBeenCalled();

    // Checking consent enables submission.
    fireEvent.click(screen.getByRole('checkbox'));
    expect(submit).toBeEnabled();
  });
});
