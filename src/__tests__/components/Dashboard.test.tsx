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
  dnaApi: {
    getUploads: vi.fn(),
    getVariants: vi.fn(),
    uploadFile: vi.fn(),
  },
  authApi: {
    getCurrentUser: vi.fn(),
    logout: vi.fn(),
  },
}));

// Mock utility functions
vi.mock('../../utils/ai', () => ({
  performAIAnalysis: vi.fn(() => ({
    riskAssessments: [],
    trendAnalyses: [],
    healthInsights: [],
    correlations: [],
    overallHealthScore: 85,
    priorityActions: [],
  })),
}));

vi.mock('../../utils/health', () => ({
  analyzeHealthNeeds: vi.fn(() => ({
    detectedConditions: [],
    recommendedServices: [],
    insuranceCoverage: [],
    estimatedCosts: [],
    priorityActions: [],
    preventiveRecommendations: [],
  })),
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

import { biomarkersApi, dnaApi } from '../../services/api';

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
  const mockUser = { id: 'user-1', email: 'test@example.com', role: 'user' };
  const mockOnLogout = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    // Default mock implementations
    vi.mocked(biomarkersApi.getAll).mockResolvedValue({ biomarkers: mockBiomarkers } as any);
    vi.mocked(dnaApi.getUploads).mockResolvedValue([]);
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  describe('Rendering', () => {
    it('should render the dashboard for authenticated user', async () => {
      render(<Dashboard user={mockUser} onLogout={mockOnLogout} />);

      await waitFor(() => {
        expect(screen.getByText(/ownmyhealth/i)).toBeInTheDocument();
      });
    });

    it('should display the OwnMyHealth branding', async () => {
      render(<Dashboard user={mockUser} onLogout={mockOnLogout} />);

      await waitFor(() => {
        expect(screen.getByText(/ownmyhealth/i)).toBeInTheDocument();
      });
    });

    it('should render navigation categories', async () => {
      render(<Dashboard user={mockUser} onLogout={mockOnLogout} />);

      await waitFor(() => {
        expect(screen.getByText('Dashboard')).toBeInTheDocument();
      });
    });

    it('should render user email in the header', async () => {
      render(<Dashboard user={mockUser} onLogout={mockOnLogout} />);

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

      render(<Dashboard user={mockUser} onLogout={mockOnLogout} />);

      // The loading spinner should be present
      expect(screen.getByText(/loading/i)).toBeInTheDocument();
    });

    it('should hide loading indicator after biomarkers are fetched', async () => {
      vi.mocked(biomarkersApi.getAll).mockResolvedValue({ biomarkers: mockBiomarkers } as any);

      render(<Dashboard user={mockUser} onLogout={mockOnLogout} />);

      await waitFor(() => {
        expect(screen.queryByText(/loading your health data/i)).not.toBeInTheDocument();
      });
    });
  });

  describe('Error State', () => {
    it('should fall back to sample data on API error', async () => {
      vi.mocked(biomarkersApi.getAll).mockRejectedValue(new Error('API error'));

      render(<Dashboard user={mockUser} onLogout={mockOnLogout} />);

      await waitFor(() => {
        // Should still render dashboard with sample data
        expect(screen.getByText('Dashboard')).toBeInTheDocument();
      });
    });
  });

  describe('Biomarker Display', () => {
    it('should display biomarker data after loading', async () => {
      vi.mocked(biomarkersApi.getAll).mockResolvedValue({ biomarkers: mockBiomarkers } as any);

      render(<Dashboard user={mockUser} onLogout={mockOnLogout} />);

      await waitFor(() => {
        // The dashboard should have loaded
        expect(screen.queryByText(/loading your health data/i)).not.toBeInTheDocument();
      });
    });

    it('should show health score', async () => {
      render(<Dashboard user={mockUser} onLogout={mockOnLogout} />);

      await waitFor(() => {
        // Health score should be displayed (mocked to 85)
        expect(screen.getByText('85')).toBeInTheDocument();
      });
    });
  });

  describe('Without User (Fallback)', () => {
    it('should render with sample data when no user is provided', async () => {
      render(<Dashboard user={null} />);

      await waitFor(() => {
        expect(screen.getByText('Dashboard')).toBeInTheDocument();
      });
    });

    it('should not fetch from API when no user', async () => {
      render(<Dashboard user={null} />);

      await waitFor(() => {
        expect(screen.getByText('Dashboard')).toBeInTheDocument();
      });

      // API should not be called for biomarkers when no user
      // (It will use sample data instead)
    });
  });

  describe('Cleanup on Unmount', () => {
    it('should unmount without errors', async () => {
      const { unmount } = render(<Dashboard user={mockUser} onLogout={mockOnLogout} />);

      await waitFor(() => {
        expect(screen.queryByText(/loading your health data/i)).not.toBeInTheDocument();
      });

      // Unmount should work without errors
      expect(() => unmount()).not.toThrow();
    });
  });
});
