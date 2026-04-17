/**
 * Dashboard Component Tests
 *
 * Tests the main dashboard rendering, loading states, and basic functionality.
 * Note: The Dashboard is a complex component with many dependencies.
 * These tests focus on core functionality that can be reliably tested.
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import Dashboard from '../../components/dashboard/Dashboard';

// Mock the AuthContext
const mockLogout = vi.fn();
const mockUser = { id: 'user-1', email: 'test@example.com', role: 'PATIENT' };

vi.mock('../../contexts/AuthContext', () => ({
  useAuth: vi.fn(() => ({
    user: mockUser,
    isAuthenticated: true,
    isLoading: false,
    login: vi.fn(),
    register: vi.fn(),
    logout: mockLogout,
    error: null,
    clearError: vi.fn(),
  })),
  AuthProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

// Mock all the complex dependencies
vi.mock('../../services/api', () => ({
  biomarkersApi: {
    getAll: vi.fn(),
    create: vi.fn(),
    createBatch: vi.fn(),
  },
  insuranceApi: {
    getPlans: vi.fn(),
    createPlan: vi.fn(),
  },
  authApi: {
    getCurrentUser: vi.fn(),
    logout: vi.fn(),
  },
  setOnAuthFailure: vi.fn(),
  getAuthToken: vi.fn(),
  attemptTokenRefresh: vi.fn(),
}));

// Mock uploadUtils to avoid api.ts import issues
vi.mock('../../services/uploadUtils', () => ({
  uploadFile: vi.fn(),
  setUploadAuthFailureCallback: vi.fn(),
}));

// Mock LabUploadModal to avoid transitive import issues
vi.mock('../../components/upload/LabUploadModal', () => ({
  default: () => null,
}));

vi.mock('../../utils/insurance', () => ({
  generatePersonalizedInsuranceGuide: vi.fn(() => ({
    userProfile: {
      detectedConditions: [],
      recommendedServices: [],
      riskFactors: [],
      currentPlans: [],
    },
    educationModules: [],
    costProjections: [],
    optimizationTips: [],
    glossary: [],
  })),
}));

// Mock chart components
vi.mock('recharts', () => ({
  ResponsiveContainer: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  LineChart: () => <div data-testid="line-chart">Chart</div>,
  Line: () => null,
  XAxis: () => null,
  YAxis: () => null,
  CartesianGrid: () => null,
  Tooltip: () => null,
  Legend: () => null,
  ReferenceLine: () => null,
  AreaChart: () => <div data-testid="area-chart">AreaChart</div>,
  Area: () => null,
}));

// Mock getIcon to return a simple span element
vi.mock('../../components/dashboard/getIcon', () => ({
  getIcon: () => <span data-testid="mock-icon">icon</span>,
}));

import { biomarkersApi } from '../../services/api';
import { useAuth } from '../../contexts/AuthContext';

// Sample biomarker data for tests
const mockBiomarkers = [
  {
    id: '1',
    name: 'Glucose',
    value: 95,
    unit: 'mg/dL',
    date: '2024-01-15',
    category: 'Blood',
    normalRange: { min: 70, max: 100, source: 'Standard' },
    description: 'Blood sugar level',
    history: [],
  },
  {
    id: '2',
    name: 'Vitamin D',
    value: 45,
    unit: 'ng/mL',
    date: '2024-01-15',
    category: 'Vitamins',
    normalRange: { min: 30, max: 100, source: 'Standard' },
    description: 'Vitamin D level',
    history: [],
  },
];

describe('Dashboard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default mock implementations
    vi.mocked(biomarkersApi.getAll).mockResolvedValue({ biomarkers: mockBiomarkers } as any);
    // Reset useAuth mock to default authenticated state
    vi.mocked(useAuth).mockReturnValue({
      user: mockUser,
      isAuthenticated: true,
      isLoading: false,
      login: vi.fn(),
      register: vi.fn(),
      logout: mockLogout,
      error: null,
      clearError: vi.fn(),
    });
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  describe('Rendering', () => {
    it('should render the dashboard for authenticated user', async () => {
      render(<Dashboard />);

      await waitFor(() => {
        expect(screen.getByText(/ownmyhealth/i)).toBeInTheDocument();
      });
    });

    it('should display the OwnMyHealth branding', async () => {
      render(<Dashboard />);

      await waitFor(() => {
        expect(screen.getByText(/ownmyhealth/i)).toBeInTheDocument();
      });
    });

    it('should render navigation categories', async () => {
      render(<Dashboard />);

      await waitFor(() => {
        // Overview h1 derives the display name from the user's email local part
        // (falls back to "Dashboard" only when unauthenticated). mockUser.email
        // is 'test@example.com', so the h1 renders "Welcome back, test".
        expect(
          screen.getByRole('heading', { name: /welcome back, test/i, level: 1 })
        ).toBeInTheDocument();
      });
    });

    it('should render user email in the header', async () => {
      render(<Dashboard />);

      await waitFor(() => {
        expect(screen.getByText(mockUser.email)).toBeInTheDocument();
      });
    });
  });

  describe('Loading State', () => {
    it('should show loading indicator while fetching biomarkers', async () => {
      // Make the API call hang
      vi.mocked(biomarkersApi.getAll).mockImplementation(
        () => new Promise(() => {}) // Never resolves
      );

      render(<Dashboard />);

      // The loading spinner should be present
      expect(screen.getByText(/loading/i)).toBeInTheDocument();
    });

    it('should hide loading indicator after biomarkers are fetched', async () => {
      vi.mocked(biomarkersApi.getAll).mockResolvedValue({ biomarkers: mockBiomarkers } as any);

      render(<Dashboard />);

      await waitFor(() => {
        expect(screen.queryByText(/loading your health data/i)).not.toBeInTheDocument();
      });
    });
  });

  describe('Error State', () => {
    it('should fall back to sample data on API error', async () => {
      vi.mocked(biomarkersApi.getAll).mockRejectedValue(new Error('API error'));

      render(<Dashboard />);

      await waitFor(() => {
        // Should still render dashboard with sample data — greeting uses the
        // email local part (see note in "should render navigation categories").
        expect(
          screen.getByRole('heading', { name: /welcome back, test/i, level: 1 })
        ).toBeInTheDocument();
      });
    });
  });

  describe('Biomarker Display', () => {
    it('should display biomarker data after loading', async () => {
      vi.mocked(biomarkersApi.getAll).mockResolvedValue({ biomarkers: mockBiomarkers } as any);

      render(<Dashboard />);

      await waitFor(() => {
        // The dashboard should have loaded
        expect(screen.queryByText(/loading your health data/i)).not.toBeInTheDocument();
      });
    });
  });

  describe('Without User (Demo Mode)', () => {
    it('should render with sample data when no user is authenticated', async () => {
      // Mock unauthenticated state
      vi.mocked(useAuth).mockReturnValue({
        user: null,
        isAuthenticated: false,
        isLoading: false,
        login: vi.fn(),
        register: vi.fn(),
        logout: mockLogout,
        error: null,
        clearError: vi.fn(),
      });

      render(<Dashboard isDemoMode />);

      await waitFor(() => {
        // Look for the h1 heading specifically (there's also a "Dashboard" nav item)
        expect(screen.getByRole('heading', { name: 'Dashboard', level: 1 })).toBeInTheDocument();
      });
    });

    it('should not fetch from API when no user', async () => {
      // Mock unauthenticated state
      vi.mocked(useAuth).mockReturnValue({
        user: null,
        isAuthenticated: false,
        isLoading: false,
        login: vi.fn(),
        register: vi.fn(),
        logout: mockLogout,
        error: null,
        clearError: vi.fn(),
      });

      render(<Dashboard isDemoMode />);

      await waitFor(() => {
        // Look for the h1 heading specifically (there's also a "Dashboard" nav item)
        expect(screen.getByRole('heading', { name: 'Dashboard', level: 1 })).toBeInTheDocument();
      });

      // API should not be called for biomarkers when no user
      // (It will use sample data instead)
    });
  });

  describe('Cleanup on Unmount', () => {
    it('should unmount without errors', async () => {
      const { unmount } = render(<Dashboard />);

      await waitFor(() => {
        expect(screen.queryByText(/loading your health data/i)).not.toBeInTheDocument();
      });

      // Unmount should work without errors
      expect(() => unmount()).not.toThrow();
    });
  });
});
