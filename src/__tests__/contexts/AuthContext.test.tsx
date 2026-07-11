/**
 * AuthContext Tests
 *
 * Tests the authentication context provider functionality.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';
import { AuthProvider, useAuth, idleNavigation } from '../../contexts/AuthContext';

// Mock the api module
vi.mock('../../services/api', () => ({
  authApi: {
    login: vi.fn(),
    register: vi.fn(),
    logout: vi.fn(),
    getCurrentUser: vi.fn(),
    refreshToken: vi.fn(),
  },
  clearAuthToken: vi.fn(),
  setOnAuthFailure: vi.fn(),
}));

import { authApi, clearAuthToken } from '../../services/api';

// Test component to access auth context
function TestComponent({ onRender }: { onRender?: (auth: ReturnType<typeof useAuth>) => void }) {
  const auth = useAuth();
  if (onRender) {
    onRender(auth);
  }
  return (
    <div>
      <span data-testid="is-authenticated">{String(auth.isAuthenticated)}</span>
      <span data-testid="is-loading">{String(auth.isLoading)}</span>
      <span data-testid="user-email">{auth.user?.email || 'none'}</span>
      <span data-testid="error">{auth.error || 'none'}</span>
    </div>
  );
}

// Component for testing actions - catches errors since AuthContext re-throws them
function ActionTestComponent() {
  const auth = useAuth();
  return (
    <div>
      <span data-testid="is-authenticated">{String(auth.isAuthenticated)}</span>
      <span data-testid="is-loading">{String(auth.isLoading)}</span>
      <span data-testid="user-email">{auth.user?.email || 'none'}</span>
      <span data-testid="error">{auth.error || 'none'}</span>
      <button
        data-testid="login-btn"
        onClick={() => auth.login('test@example.com', 'password123').catch(() => {})}
      >
        Login
      </button>
      <button
        data-testid="register-btn"
        onClick={() => auth.register('new@example.com', 'password123', 'John', 'Doe').catch(() => {})}
      >
        Register
      </button>
      <button data-testid="logout-btn" onClick={() => auth.logout().catch(() => {})}>
        Logout
      </button>
      <button data-testid="clear-error-btn" onClick={() => auth.clearError()}>
        Clear Error
      </button>
    </div>
  );
}

describe('AuthContext', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default: no existing session (refreshToken fails, so getCurrentUser is never called)
    vi.mocked(authApi.refreshToken).mockRejectedValue(new Error('No refresh token'));
    vi.mocked(authApi.getCurrentUser).mockRejectedValue(new Error('Not authenticated'));
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  describe('Initial State', () => {
    it('should start with loading true', async () => {
      // Make refreshToken hang to catch the loading state
      vi.mocked(authApi.refreshToken).mockImplementation(
        () => new Promise(() => {}) // Never resolves
      );

      render(
        <AuthProvider>
          <TestComponent />
        </AuthProvider>
      );

      expect(screen.getByTestId('is-loading').textContent).toBe('true');
    });

    it('should set loading to false after checking auth', async () => {
      render(
        <AuthProvider>
          <TestComponent />
        </AuthProvider>
      );

      await waitFor(() => {
        expect(screen.getByTestId('is-loading').textContent).toBe('false');
      });
    });

    it('should be not authenticated initially when no session exists', async () => {
      render(
        <AuthProvider>
          <TestComponent />
        </AuthProvider>
      );

      await waitFor(() => {
        expect(screen.getByTestId('is-authenticated').textContent).toBe('false');
      });
    });

    it('should have no user initially when no session exists', async () => {
      render(
        <AuthProvider>
          <TestComponent />
        </AuthProvider>
      );

      await waitFor(() => {
        expect(screen.getByTestId('user-email').textContent).toBe('none');
      });
    });

    it('should restore session if token exists', async () => {
      const mockUser = { id: '1', email: 'existing@example.com', role: 'user' };
      // refreshToken must succeed first, then getCurrentUser is called
      vi.mocked(authApi.refreshToken).mockResolvedValue({ token: 'mock-token' });
      vi.mocked(authApi.getCurrentUser).mockResolvedValue(mockUser);

      render(
        <AuthProvider>
          <TestComponent />
        </AuthProvider>
      );

      await waitFor(() => {
        expect(screen.getByTestId('is-authenticated').textContent).toBe('true');
        expect(screen.getByTestId('user-email').textContent).toBe('existing@example.com');
      });
    });
  });

  describe('Login', () => {
    it('should update state correctly on successful login', async () => {
      const mockUser = { id: '1', email: 'test@example.com', role: 'user' };
      vi.mocked(authApi.login).mockResolvedValue({ user: mockUser, token: 'mock-token' });

      render(
        <AuthProvider>
          <ActionTestComponent />
        </AuthProvider>
      );

      // Wait for initial auth check
      await waitFor(() => {
        expect(screen.getByTestId('is-loading').textContent).toBe('false');
      });

      // Click login
      await act(async () => {
        screen.getByTestId('login-btn').click();
      });

      await waitFor(() => {
        expect(screen.getByTestId('is-authenticated').textContent).toBe('true');
        expect(screen.getByTestId('user-email').textContent).toBe('test@example.com');
      });
    });

    it('should call authApi.login with correct credentials', async () => {
      vi.mocked(authApi.login).mockResolvedValue({
        user: { id: '1', email: 'test@example.com', role: 'user' },
        token: 'mock-token',
      });

      render(
        <AuthProvider>
          <ActionTestComponent />
        </AuthProvider>
      );

      await waitFor(() => {
        expect(screen.getByTestId('is-loading').textContent).toBe('false');
      });

      await act(async () => {
        screen.getByTestId('login-btn').click();
      });

      expect(authApi.login).toHaveBeenCalledWith({
        email: 'test@example.com',
        password: 'password123',
      });
    });

    it('should set error on login failure', async () => {
      vi.mocked(authApi.login).mockRejectedValue(new Error('Invalid credentials'));

      render(
        <AuthProvider>
          <ActionTestComponent />
        </AuthProvider>
      );

      await waitFor(() => {
        expect(screen.getByTestId('is-loading').textContent).toBe('false');
      });

      await act(async () => {
        screen.getByTestId('login-btn').click();
      });

      await waitFor(() => {
        expect(screen.getByTestId('error').textContent).toBe('Invalid credentials');
        expect(screen.getByTestId('is-authenticated').textContent).toBe('false');
      });
    });

    it('does NOT flip the global isLoading during an in-flight login', async () => {
      // login() intentionally leaves the context's isLoading untouched: App.tsx
      // renders a full-screen spinner while isLoading is true, which would
      // unmount LoginPage mid-submit and wipe the email field on failure.
      // In-flight login UI is the caller's concern (App's own isAuthLoading).
      // This test locks in that behavior so a refactor can't reintroduce the
      // login-page-unmount bug.
      let resolveLogin: (value: any) => void;
      vi.mocked(authApi.login).mockImplementation(
        () =>
          new Promise((resolve) => {
            resolveLogin = resolve;
          })
      );

      render(
        <AuthProvider>
          <ActionTestComponent />
        </AuthProvider>
      );

      await waitFor(() => {
        expect(screen.getByTestId('is-loading').textContent).toBe('false');
      });

      // Start login — the promise stays pending.
      await act(async () => {
        screen.getByTestId('login-btn').click();
      });

      // Global loading flag must remain false while the login is in flight.
      expect(screen.getByTestId('is-loading').textContent).toBe('false');

      // Complete login; still no global loading flip.
      await act(async () => {
        resolveLogin!({
          user: { id: '1', email: 'test@example.com', role: 'user' },
          token: 'mock-token',
        });
      });

      expect(screen.getByTestId('is-loading').textContent).toBe('false');
    });
  });

  describe('Register', () => {
    it('should call authApi.register with correct data', async () => {
      vi.mocked(authApi.register).mockResolvedValue({
        user: { id: '1', email: 'new@example.com', role: 'user' },
        token: 'mock-token',
      });

      render(
        <AuthProvider>
          <ActionTestComponent />
        </AuthProvider>
      );

      await waitFor(() => {
        expect(screen.getByTestId('is-loading').textContent).toBe('false');
      });

      await act(async () => {
        screen.getByTestId('register-btn').click();
      });

      expect(authApi.register).toHaveBeenCalledWith({
        email: 'new@example.com',
        password: 'password123',
        firstName: 'John',
        lastName: 'Doe',
        // OMH-L03: consent flag is now sent with every registration.
        acceptedTerms: true,
      });
    });

    it('should NOT set user after registration (requires verification)', async () => {
      vi.mocked(authApi.register).mockResolvedValue({
        user: { id: '1', email: 'new@example.com', role: 'user' },
        token: 'mock-token',
      });

      render(
        <AuthProvider>
          <ActionTestComponent />
        </AuthProvider>
      );

      await waitFor(() => {
        expect(screen.getByTestId('is-loading').textContent).toBe('false');
      });

      await act(async () => {
        screen.getByTestId('register-btn').click();
      });

      await waitFor(() => {
        expect(screen.getByTestId('is-loading').textContent).toBe('false');
      });

      // User should NOT be authenticated after registration
      expect(screen.getByTestId('is-authenticated').textContent).toBe('false');
    });

    it('should set error on registration failure', async () => {
      vi.mocked(authApi.register).mockRejectedValue(new Error('Email already exists'));

      render(
        <AuthProvider>
          <ActionTestComponent />
        </AuthProvider>
      );

      await waitFor(() => {
        expect(screen.getByTestId('is-loading').textContent).toBe('false');
      });

      await act(async () => {
        screen.getByTestId('register-btn').click();
      });

      await waitFor(() => {
        expect(screen.getByTestId('error').textContent).toBe('Email already exists');
      });
    });
  });

  describe('Logout', () => {
    it('should clear user state on logout', async () => {
      const mockUser = { id: '1', email: 'test@example.com', role: 'user' };
      // refreshToken must succeed first for session restore
      vi.mocked(authApi.refreshToken).mockResolvedValue({ token: 'mock-token' });
      vi.mocked(authApi.getCurrentUser).mockResolvedValue(mockUser);
      vi.mocked(authApi.logout).mockResolvedValue(undefined);

      render(
        <AuthProvider>
          <ActionTestComponent />
        </AuthProvider>
      );

      // Wait for session restore
      await waitFor(() => {
        expect(screen.getByTestId('is-authenticated').textContent).toBe('true');
      });

      // Logout
      await act(async () => {
        screen.getByTestId('logout-btn').click();
      });

      await waitFor(() => {
        expect(screen.getByTestId('is-authenticated').textContent).toBe('false');
        expect(screen.getByTestId('user-email').textContent).toBe('none');
      });
    });

    it('should call clearAuthToken on logout', async () => {
      const mockUser = { id: '1', email: 'test@example.com', role: 'user' };
      // refreshToken must succeed first for session restore
      vi.mocked(authApi.refreshToken).mockResolvedValue({ token: 'mock-token' });
      vi.mocked(authApi.getCurrentUser).mockResolvedValue(mockUser);
      vi.mocked(authApi.logout).mockResolvedValue(undefined);

      render(
        <AuthProvider>
          <ActionTestComponent />
        </AuthProvider>
      );

      await waitFor(() => {
        expect(screen.getByTestId('is-authenticated').textContent).toBe('true');
      });

      await act(async () => {
        screen.getByTestId('logout-btn').click();
      });

      expect(clearAuthToken).toHaveBeenCalled();
    });

    it('should clear state even if logout API fails', async () => {
      const mockUser = { id: '1', email: 'test@example.com', role: 'user' };
      // refreshToken must succeed first for session restore
      vi.mocked(authApi.refreshToken).mockResolvedValue({ token: 'mock-token' });
      vi.mocked(authApi.getCurrentUser).mockResolvedValue(mockUser);
      vi.mocked(authApi.logout).mockRejectedValue(new Error('Network error'));

      render(
        <AuthProvider>
          <ActionTestComponent />
        </AuthProvider>
      );

      await waitFor(() => {
        expect(screen.getByTestId('is-authenticated').textContent).toBe('true');
      });

      await act(async () => {
        screen.getByTestId('logout-btn').click();
      });

      // Should still clear state even on API error
      await waitFor(() => {
        expect(screen.getByTestId('is-authenticated').textContent).toBe('false');
      });
    });
  });

  describe('Session Expired Flag (teardown #5 — HIPAA idle logoff)', () => {
    afterEach(() => {
      // Restore a clean URL for the other tests.
      window.history.replaceState(null, '', '/');
    });

    it('does NOT attempt the silent refresh when ?sessionExpired=true is present', async () => {
      // The idle logoff redirects to /?sessionExpired=true after revoking the
      // session server-side. checkAuth must NOT call refreshToken here — a
      // successful refresh would silently log the user back in and turn the
      // HIPAA automatic logoff into a page reload.
      window.history.replaceState(null, '', '/?sessionExpired=true');
      vi.mocked(authApi.refreshToken).mockResolvedValue({ token: 'mock-token' });
      vi.mocked(authApi.getCurrentUser).mockResolvedValue({
        id: '1',
        email: 'existing@example.com',
        role: 'user',
      });

      render(
        <AuthProvider>
          <TestComponent />
        </AuthProvider>
      );

      await waitFor(() => {
        expect(screen.getByTestId('is-loading').textContent).toBe('false');
      });

      expect(authApi.refreshToken).not.toHaveBeenCalled();
      expect(authApi.getCurrentUser).not.toHaveBeenCalled();
      expect(screen.getByTestId('is-authenticated').textContent).toBe('false');
      // The login page surfaces the reason via the context error.
      expect(screen.getByTestId('error').textContent).toContain('session ended due to inactivity');
    });

    it('strips sessionExpired from the URL so a post-login reload is unaffected', async () => {
      window.history.replaceState(null, '', '/?sessionExpired=true');

      render(
        <AuthProvider>
          <TestComponent />
        </AuthProvider>
      );

      await waitFor(() => {
        expect(screen.getByTestId('is-loading').textContent).toBe('false');
      });

      expect(window.location.search).toBe('');
    });
  });

  describe('Multi-tab idle sync + idle-fire redirect (BroadcastChannel)', () => {
    // Minimal synchronous BroadcastChannel stub: jsdom doesn't implement the
    // API, and Node's real implementation delivers messages asynchronously,
    // which fake timers can't advance deterministically.
    class MockBroadcastChannel {
      static instances = new Map<string, Set<MockBroadcastChannel>>();
      static reset(): void {
        MockBroadcastChannel.instances.clear();
      }
      onmessage: ((event: MessageEvent) => void) | null = null;
      private closed = false;
      constructor(public readonly name: string) {
        let peers = MockBroadcastChannel.instances.get(name);
        if (!peers) {
          peers = new Set();
          MockBroadcastChannel.instances.set(name, peers);
        }
        peers.add(this);
      }
      postMessage(data: unknown): void {
        if (this.closed) throw new Error('Channel is closed');
        for (const peer of MockBroadcastChannel.instances.get(this.name) ?? []) {
          if (peer !== this && !peer.closed) {
            peer.onmessage?.({ data } as MessageEvent);
          }
        }
      }
      close(): void {
        this.closed = true;
        MockBroadcastChannel.instances.get(this.name)?.delete(this);
      }
    }

    const FIFTEEN_MIN = 15 * 60 * 1000;

    beforeEach(() => {
      vi.useFakeTimers();
      vi.stubGlobal('BroadcastChannel', MockBroadcastChannel);
      // jsdom's Location is [LegacyUnforgeable] — window.location can't be
      // redefined via Object.defineProperty — so the idle redirect goes
      // through this spy-able seam instead.
      vi.spyOn(idleNavigation, 'redirectToSessionExpired').mockImplementation(() => {});
    });

    afterEach(() => {
      vi.unstubAllGlobals();
      MockBroadcastChannel.reset();
      vi.useRealTimers();
      vi.restoreAllMocks();
    });

    // Drains the promise chains (session restore, logout retries) that fake
    // timers don't advance. Each await yields one microtask turn; ten turns
    // comfortably covers the deepest chain under test.
    async function flushAsync(): Promise<void> {
      await act(async () => {
        for (let i = 0; i < 10; i++) {
          await Promise.resolve();
        }
      });
    }

    async function renderAuthenticated(): Promise<void> {
      vi.mocked(authApi.refreshToken).mockResolvedValue({ token: 'mock-token' });
      vi.mocked(authApi.getCurrentUser).mockResolvedValue({
        id: '1',
        email: 'tabs@example.com',
        role: 'user',
      });
      render(
        <AuthProvider>
          <TestComponent />
        </AuthProvider>
      );
      await flushAsync();
      expect(screen.getByTestId('is-authenticated').textContent).toBe('true');
    }

    it("an incoming cross-tab 'activity' message defers the idle fire", async () => {
      vi.mocked(authApi.logout).mockResolvedValue(undefined);
      await renderAuthenticated();
      const siblingTab = new MockBroadcastChannel('omh-session-activity');

      // 14 minutes idle locally — one minute from the logout fire.
      act(() => {
        vi.advanceTimersByTime(14 * 60 * 1000);
      });

      // The user types in ANOTHER tab; that tab broadcasts an activity ping.
      act(() => {
        siblingTab.postMessage({ type: 'activity' });
      });

      // 14 more minutes: without the ping this tab would have fired 13
      // minutes ago; with it only 14 minutes have passed since activity.
      act(() => {
        vi.advanceTimersByTime(14 * 60 * 1000);
      });
      await flushAsync();
      expect(authApi.logout).not.toHaveBeenCalled();
      expect(idleNavigation.redirectToSessionExpired).not.toHaveBeenCalled();

      // Cross the full 15-minute window with no further activity → fires.
      act(() => {
        vi.advanceTimersByTime(60 * 1000 + 1000);
      });
      await flushAsync();
      expect(authApi.logout).toHaveBeenCalled();
      expect(idleNavigation.redirectToSessionExpired).toHaveBeenCalled();
    });

    it("an incoming 'logged-out' message redirects to the sessionExpired path without re-revoking", async () => {
      await renderAuthenticated();
      const siblingTab = new MockBroadcastChannel('omh-session-activity');

      act(() => {
        siblingTab.postMessage({ type: 'logged-out' });
      });

      expect(idleNavigation.redirectToSessionExpired).toHaveBeenCalledTimes(1);
      // The initiating tab already revoked the shared session; this tab must
      // not fire a duplicate logout call.
      expect(authApi.logout).not.toHaveBeenCalled();
    });

    it("the idle-firing tab broadcasts 'logged-out' to sibling tabs", async () => {
      vi.mocked(authApi.logout).mockResolvedValue(undefined);
      await renderAuthenticated();
      const received: Array<{ type?: string }> = [];
      const siblingTab = new MockBroadcastChannel('omh-session-activity');
      siblingTab.onmessage = (event) => received.push(event.data as { type?: string });

      act(() => {
        vi.advanceTimersByTime(FIFTEEN_MIN + 1000);
      });
      await flushAsync();

      expect(received).toContainEqual({ type: 'logged-out' });
    });

    it('throttles local activity broadcasts to one ping per 30s window', async () => {
      await renderAuthenticated();
      const received: Array<{ type?: string }> = [];
      const siblingTab = new MockBroadcastChannel('omh-session-activity');
      siblingTab.onmessage = (event) => received.push(event.data as { type?: string });

      act(() => {
        window.dispatchEvent(new Event('keydown'));
        window.dispatchEvent(new Event('keydown'));
        window.dispatchEvent(new Event('mousedown'));
      });
      // Burst of local activity → exactly one ping (no message flood).
      expect(received.filter((m) => m.type === 'activity')).toHaveLength(1);

      act(() => {
        vi.advanceTimersByTime(30 * 1000);
        window.dispatchEvent(new Event('keydown'));
      });
      expect(received.filter((m) => m.type === 'activity')).toHaveLength(2);
    });

    it('idle fire awaits logout() before navigating and retries exactly once on failure', async () => {
      let rejectFirst!: (error: Error) => void;
      let resolveSecond!: () => void;
      vi.mocked(authApi.logout)
        .mockImplementationOnce(
          () =>
            new Promise<void>((_resolve, reject) => {
              rejectFirst = reject;
            })
        )
        .mockImplementationOnce(
          () =>
            new Promise<void>((resolve) => {
              resolveSecond = resolve;
            })
        );
      await renderAuthenticated();

      // Idle fires — logout attempt #1 is in flight; navigation must wait
      // until the server-side revocation (the HIPAA-relevant part) settles.
      act(() => {
        vi.advanceTimersByTime(FIFTEEN_MIN + 1000);
      });
      await flushAsync();
      expect(authApi.logout).toHaveBeenCalledTimes(1);
      expect(idleNavigation.redirectToSessionExpired).not.toHaveBeenCalled();

      // Attempt #1 fails → exactly one retry, still no navigation.
      await act(async () => {
        rejectFirst(new Error('network blip'));
      });
      await flushAsync();
      expect(authApi.logout).toHaveBeenCalledTimes(2);
      expect(idleNavigation.redirectToSessionExpired).not.toHaveBeenCalled();

      // Retry settles → the redirect finally happens.
      await act(async () => {
        resolveSecond();
      });
      await flushAsync();
      expect(idleNavigation.redirectToSessionExpired).toHaveBeenCalledTimes(1);
    });

    it('still navigates (after exactly two logout attempts) when logout keeps failing', async () => {
      vi.mocked(authApi.logout).mockRejectedValue(new Error('server down'));
      await renderAuthenticated();

      act(() => {
        vi.advanceTimersByTime(FIFTEEN_MIN + 1000);
      });
      await flushAsync();

      // One retry only — never a third attempt — and the redirect still
      // happens (the ?sessionExpired flag suppresses silent re-auth).
      expect(authApi.logout).toHaveBeenCalledTimes(2);
      expect(idleNavigation.redirectToSessionExpired).toHaveBeenCalled();
    });
  });

  describe('Error Handling', () => {
    it('should clear error with clearError', async () => {
      vi.mocked(authApi.login).mockRejectedValue(new Error('Login failed'));

      render(
        <AuthProvider>
          <ActionTestComponent />
        </AuthProvider>
      );

      await waitFor(() => {
        expect(screen.getByTestId('is-loading').textContent).toBe('false');
      });

      // Trigger an error
      await act(async () => {
        screen.getByTestId('login-btn').click();
      });

      await waitFor(() => {
        expect(screen.getByTestId('error').textContent).toBe('Login failed');
      });

      // Clear the error
      await act(async () => {
        screen.getByTestId('clear-error-btn').click();
      });

      expect(screen.getByTestId('error').textContent).toBe('none');
    });

    it('should use default error message if none provided', async () => {
      vi.mocked(authApi.login).mockRejectedValue({});

      render(
        <AuthProvider>
          <ActionTestComponent />
        </AuthProvider>
      );

      await waitFor(() => {
        expect(screen.getByTestId('is-loading').textContent).toBe('false');
      });

      await act(async () => {
        screen.getByTestId('login-btn').click();
      });

      await waitFor(() => {
        expect(screen.getByTestId('error').textContent).toBe('Login failed');
      });
    });
  });

  describe('useAuth Hook', () => {
    it('should throw when used outside provider', () => {
      // Suppress console.error for this test
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      expect(() => {
        render(<TestComponent />);
      }).toThrow('useAuth must be used within an AuthProvider');

      consoleSpy.mockRestore();
    });
  });
});
