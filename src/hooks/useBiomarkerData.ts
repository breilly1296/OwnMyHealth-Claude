/**
 * useBiomarkerData - Custom hook for biomarker data management
 *
 * Consolidates biomarker data fetching, state management, and CRUD handlers.
 * Handles demo mode, error fallbacks, and API integration.
 *
 * IMPORTANT: Uses useRef for callbacks and data props to prevent infinite loops.
 * Only user?.id (primitive) triggers re-fetches, not object references.
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import type { Biomarker, InsurancePlan } from '../types';
import { biomarkersApi, insuranceApi } from '../services/api';
import { dashboardLogger } from '../utils/logger';
import { transformPlanForDisplay } from '../utils/insurance/insuranceUtils';
import { normalizeDateToISO } from '../utils/biomarkers/dateNormalizer';

// Demo mode flag - only enabled in development when explicitly set
const DEMO_MODE = import.meta.env.DEV && import.meta.env.VITE_DEMO_MODE === 'true';

// Backend clamps list `limit` to 100 (schemas.biomarker.listQuery), so a single
// large-limit request silently truncates. Page through instead.
const BIOMARKER_PAGE_SIZE = 100;
const MAX_BIOMARKER_PAGES = 50;

// Pages 2+ are fetched in parallel, but bounded: the backend is a 1-vCPU
// Cloud Run instance doing per-row AES decryption, and the API rate-limits
// per IP, so an unbounded ~49-request burst is self-defeating.
const BIOMARKER_FETCH_CONCURRENCY = 5;

// Backend rejects batch creates over 100 items (schemas.biomarker.batchCreate),
// so larger extractions must be split into sequential calls.
const BIOMARKER_BATCH_LIMIT = 100;

/**
 * Fetch every page of biomarkers (page size 100, capped at MAX_BIOMARKER_PAGES).
 * Page 1 goes first (it reveals totalPages); remaining pages are fetched in
 * parallel batches of BIOMARKER_FETCH_CONCURRENCY, so a many-page record costs
 * roughly ceil(pages / concurrency) round-trips of wall-clock, not pages.
 * Exported for testing.
 *
 * @returns All fetched biomarkers in page order, plus `truncated: true` if the
 *          page cap was hit before totalPages was exhausted (caller should
 *          warn the user).
 */
export async function fetchAllBiomarkers(): Promise<{
  biomarkers: Biomarker[];
  truncated: boolean;
}> {
  const first = await biomarkersApi.getAll({ page: 1, limit: BIOMARKER_PAGE_SIZE });
  const all: Biomarker[] = [...(first.biomarkers as unknown as Biomarker[])];
  // Older mocks/responses may omit pagination — treat as a single page
  const totalPages = first.pagination?.totalPages ?? 1;
  const lastPage = Math.min(totalPages, MAX_BIOMARKER_PAGES);

  // Promise.all preserves input (page) order regardless of completion order,
  // and rejects on any page failure — matching the old sequential semantics.
  for (let start = 2; start <= lastPage; start += BIOMARKER_FETCH_CONCURRENCY) {
    const end = Math.min(start + BIOMARKER_FETCH_CONCURRENCY - 1, lastPage);
    const results = await Promise.all(
      Array.from({ length: end - start + 1 }, (_, i) =>
        biomarkersApi.getAll({ page: start + i, limit: BIOMARKER_PAGE_SIZE })
      )
    );
    for (const result of results) {
      all.push(...(result.biomarkers as unknown as Biomarker[]));
    }
  }

  return { biomarkers: all, truncated: totalPages > MAX_BIOMARKER_PAGES };
}

const TRUNCATION_WARNING =
  'Too many biomarker records to load — displayed data may be incomplete.';

interface UseBiomarkerDataOptions {
  user: { id: string; email: string; role: string } | null | undefined;
  initialBiomarkers: Biomarker[];
  onError: (message: string) => void;
}

interface UseBiomarkerDataReturn {
  biomarkers: Biomarker[];
  insurancePlans: InsurancePlan[];
  isLoading: boolean;
  handleAddMeasurement: (measurement: Partial<Biomarker>) => Promise<void>;
  handlePDFExtract: (extractedBiomarkers: Partial<Biomarker>[]) => Promise<void>;
  handleClinicalFileExtract: (extractedBiomarkers: Partial<Biomarker>[]) => void;
  handleLabOCRSuccess: (extractedBiomarkers: {
    id: string;
    name: string;
    value: number;
    unit: string;
    category: string;
    isOutOfRange: boolean;
  }[]) => void;
  handleInsurancePlanExtracted: (plan: InsurancePlan) => Promise<void>;
  handleDeleteInsurancePlan: (planId: string) => Promise<void>;
  refreshBiomarkers: () => Promise<void>;
  refreshInsurancePlans: () => Promise<void>;
}

/**
 * Hook for managing biomarker data with API integration
 *
 * @param options - Configuration including user, sample data, and error handler
 * @returns Biomarker state and handlers
 *
 * @example
 * const {
 *   biomarkers,
 *   insurancePlans,
 *   isLoading,
 *   handleAddMeasurement,
 * } = useBiomarkerData({
 *   user,
 *   initialBiomarkers: sampleData,
 *   onError: showErrorToast,
 * });
 */
export function useBiomarkerData({
  user,
  initialBiomarkers,
  onError,
}: UseBiomarkerDataOptions): UseBiomarkerDataReturn {
  const [biomarkers, setBiomarkers] = useState<Biomarker[]>([]);
  const [insurancePlans, setInsurancePlans] = useState<InsurancePlan[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  // ============================================================
  // CRITICAL: Use refs to store callbacks and data that shouldn't
  // trigger re-fetches. This prevents infinite loops when these
  // values are new references on each render.
  // ============================================================
  const onErrorRef = useRef(onError);
  const initialBiomarkersRef = useRef(initialBiomarkers);

  // Keep refs updated with latest values (these effects don't trigger fetch)
  useEffect(() => {
    onErrorRef.current = onError;
  }, [onError]);

  useEffect(() => {
    initialBiomarkersRef.current = initialBiomarkers;
  }, [initialBiomarkers]);

  // ============================================================
  // Fetch biomarkers - ONLY depends on user?.id (primitive)
  // This is the key fix: we don't depend on initialBiomarkers or
  // onError directly, which would cause infinite loops.
  // ============================================================
  useEffect(() => {
    let cancelled = false;

    const fetchData = async () => {
      setIsLoading(true);

      if (DEMO_MODE) {
        if (!cancelled) {
          setBiomarkers(initialBiomarkersRef.current);
          setIsLoading(false);
        }
        return;
      }

      // If no authenticated user, use sample data
      if (!user) {
        if (!cancelled) {
          setBiomarkers(initialBiomarkersRef.current);
          setIsLoading(false);
        }
        return;
      }

      try {
        const { biomarkers: fetched, truncated } = await fetchAllBiomarkers();
        if (!cancelled) {
          setBiomarkers(fetched);
          if (truncated) {
            onErrorRef.current(TRUNCATION_WARNING);
          }
        }
      } catch (error) {
        if (!cancelled) {
          const errorMsg = error instanceof Error ? error.message : 'Failed to load biomarkers';
          dashboardLogger.error('Error fetching biomarkers', { error: errorMsg });
          onErrorRef.current(`${errorMsg}. Using sample data for demonstration.`);
          setBiomarkers(initialBiomarkersRef.current);
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    };

    fetchData();

    // Cleanup: Cancel pending operations on unmount or user change
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- Intentionally only depend on user?.id (primitive) to prevent infinite loops
  }, [user?.id]);

  // ============================================================
  // Fetch insurance plans - ONLY depends on user?.id (primitive)
  // Similar pattern to biomarkers fetch above.
  // ============================================================
  useEffect(() => {
    let cancelled = false;

    const fetchInsurancePlans = async () => {
      dashboardLogger.debug('fetchInsurancePlans called');

      if (DEMO_MODE || !user) {
        dashboardLogger.debug('Skipping insurance fetch - DEMO_MODE or no user');
        return;
      }

      try {
        const plans = await insuranceApi.getPlans();

        if (cancelled) {
          return;
        }

        // Transform flat API fields to benefits/costs arrays for UI display
        const transformedPlans = (plans as unknown as InsurancePlan[]).map(transformPlanForDisplay);
        dashboardLogger.debug('Insurance plans loaded', { count: transformedPlans.length });
        setInsurancePlans(transformedPlans);
      } catch (error) {
        if (!cancelled) {
          const errorMsg = error instanceof Error ? error.message : 'Failed to load insurance plans';
          dashboardLogger.error('Error fetching insurance plans', { error: errorMsg });
          // Surface as a non-blocking notice so the user knows cost features
          // are limited. The dashboard still renders without insurance data.
          onErrorRef.current(
            'Insurance data unavailable — some cost features may be limited'
          );
        }
      }
    };

    fetchInsurancePlans();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- Intentionally only depend on user?.id (primitive) to prevent infinite loops
  }, [user?.id]);

  // Cleanup PHI data on unmount (separate effect to avoid re-running fetch)
  useEffect(() => {
    return () => {
      setBiomarkers([]);
      setInsurancePlans([]);
    };
  }, []);

  // Manual refresh function
  const refreshBiomarkers = useCallback(async () => {
    if (DEMO_MODE || !user) {
      return;
    }

    setIsLoading(true);
    try {
      const { biomarkers: fetched, truncated } = await fetchAllBiomarkers();
      setBiomarkers(fetched);
      if (truncated) {
        onErrorRef.current(TRUNCATION_WARNING);
      }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Failed to refresh biomarkers';
      dashboardLogger.error('Error refreshing biomarkers', { error: errorMsg });
      onErrorRef.current(errorMsg);
    } finally {
      setIsLoading(false);
    }
  }, [user]);

  // Manual refresh for insurance plans (e.g. after adding/editing a plan via
  // a modal). Previously InsuranceHub.onRefresh was wired to refreshBiomarkers,
  // so a newly added plan never appeared until a full page reload.
  const refreshInsurancePlans = useCallback(async () => {
    if (DEMO_MODE || !user) {
      return;
    }
    try {
      const plans = await insuranceApi.getPlans();
      const transformedPlans = (plans as unknown as InsurancePlan[]).map(transformPlanForDisplay);
      setInsurancePlans(transformedPlans);
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Failed to refresh insurance plans';
      dashboardLogger.error('Error refreshing insurance plans', { error: errorMsg });
      onErrorRef.current(errorMsg);
    }
  }, [user]);

  // Add single measurement
  const handleAddMeasurement = useCallback(async (measurement: Partial<Biomarker>) => {
    const newBiomarker: Biomarker = {
      ...measurement,
      id: measurement.id || crypto.randomUUID(),
      history: [],
    } as Biomarker;

    if (DEMO_MODE) {
      setBiomarkers(prev => [...prev, newBiomarker]);
      return;
    }

    try {
      const created = await biomarkersApi.create({
        name: newBiomarker.name,
        value: newBiomarker.value,
        unit: newBiomarker.unit,
        date: newBiomarker.date,
        category: newBiomarker.category,
        normalRange: {
          min: newBiomarker.normalRange.min,
          max: newBiomarker.normalRange.max,
          source: newBiomarker.normalRange.source,
        },
        notes: newBiomarker.notes,
      });
      setBiomarkers(prev => [...prev, created as unknown as Biomarker]);
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Failed to save measurement';
      dashboardLogger.error('Error adding measurement', { error: errorMsg });
      onErrorRef.current(`${errorMsg}. Added locally but not synced to server.`);
      setBiomarkers(prev => [...prev, newBiomarker]);
    }
  }, []);

  // Handle PDF extraction (batch create)
  const handlePDFExtract = useCallback(async (extractedBiomarkers: Partial<Biomarker>[]) => {
    const newBiomarkers = extractedBiomarkers.map(b => ({
      ...b,
      // The lab parser normalizes report dates, but other extraction callers
      // may still pass raw US-format dates ("01/15/2026") — the backend only
      // accepts ISO, and ONE bad date 422s an entire batch.
      date: normalizeDateToISO(b.date) || new Date().toISOString().split('T')[0],
      id: crypto.randomUUID(),
      history: [],
    })) as Biomarker[];

    if (DEMO_MODE) {
      setBiomarkers(prev => [...prev, ...newBiomarkers]);
      return;
    }

    const createData = newBiomarkers.map(b => ({
      name: b.name,
      value: b.value,
      unit: b.unit,
      date: b.date,
      category: b.category,
      normalRange: {
        min: b.normalRange.min,
        max: b.normalRange.max,
        source: b.normalRange.source,
      },
      // Without an explicit sourceType the backend defaults rows to MANUAL,
      // losing the lab-upload provenance.
      sourceType: 'LAB_UPLOAD' as const,
      sourceFile: b.sourceFile,
      extractionConfidence: b.extractionConfidence,
    }));

    // Save in ≤100-item chunks (backend batch cap) and merge the results.
    const created: Biomarker[] = [];
    for (let start = 0; start < createData.length; start += BIOMARKER_BATCH_LIMIT) {
      try {
        const chunk = await biomarkersApi.createBatch(
          createData.slice(start, start + BIOMARKER_BATCH_LIMIT)
        );
        created.push(...(chunk as unknown as Biomarker[]));
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : 'Failed to save extracted data';
        dashboardLogger.error('Error saving PDF extracted data', { error: errorMsg });
        onErrorRef.current(`${errorMsg}. Data added locally but not synced to server.`);
        // Chunks before `start` are already persisted (server copies are in
        // `created`); only the unsaved remainder falls back to local copies.
        setBiomarkers(prev => [...prev, ...created, ...newBiomarkers.slice(start)]);
        return;
      }
    }
    setBiomarkers(prev => [...prev, ...created]);
  }, []);

  // Handle clinical file extraction
  const handleClinicalFileExtract = useCallback((extractedBiomarkers: Partial<Biomarker>[]) => {
    const newBiomarkers = extractedBiomarkers.map(b => ({
      ...b,
      id: crypto.randomUUID(),
      history: [],
    })) as Biomarker[];

    setBiomarkers(prev => [...prev, ...newBiomarkers]);
  }, []);

  // Handle server-side OCR upload success (Google Document AI)
  const handleLabOCRSuccess = useCallback((extractedBiomarkers: {
    id: string;
    name: string;
    value: number;
    unit: string;
    category: string;
    isOutOfRange: boolean;
  }[]) => {
    const refreshAfterOCR = async () => {
      try {
        const { biomarkers: fetched, truncated } = await fetchAllBiomarkers();
        setBiomarkers(fetched);
        if (truncated) {
          onErrorRef.current(TRUNCATION_WARNING);
        }
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : 'Failed to refresh biomarkers';
        dashboardLogger.error('Error refreshing biomarkers after OCR upload', { error: errorMsg });
        // If refresh fails, at least show the returned data locally
        const newBiomarkers = extractedBiomarkers.map(b => ({
          ...b,
          date: new Date().toISOString().split('T')[0],
          description: `${b.name} measurement`,
          normalRange: { min: 0, max: 100, source: 'OCR' },
          history: [],
        })) as Biomarker[];
        setBiomarkers(prev => [...prev, ...newBiomarkers]);
      }
    };
    refreshAfterOCR();
  }, []);

  // Handle insurance plan extraction
  const handleInsurancePlanExtracted = useCallback(async (plan: InsurancePlan) => {
    // Transform flat fields to arrays for UI display
    const transformedPlan = transformPlanForDisplay(plan);

    if (DEMO_MODE) {
      setInsurancePlans(prev => [...prev, transformedPlan]);
      return;
    }

    // If the plan already has an ID, it was already created by the SBC upload endpoint.
    // Just add it to local state without calling createPlan again.
    if (plan.id) {
      dashboardLogger.info('Plan already saved to server, adding to local state', { planId: plan.id });
      setInsurancePlans(prev => [...prev, transformedPlan]);
      return;
    }

    try {
      // Extract costs from the plan's costs array (for manually entered plans)
      const deductibleIndividual = plan.costs?.find(
        c => c.type === 'Deductible' && c.appliesTo === 'Individual'
      )?.amount || 0;
      const deductibleFamily = plan.costs?.find(
        c => c.type === 'Deductible' && c.appliesTo === 'Family'
      )?.amount || 0;
      const oopMaxIndividual = plan.costs?.find(
        c => c.type === 'Out-of-Pocket Maximum' && c.appliesTo === 'Individual'
      )?.amount || 0;
      const oopMaxFamily = plan.costs?.find(
        c => c.type === 'Out-of-Pocket Maximum' && c.appliesTo === 'Family'
      )?.amount || 0;

      const created = await insuranceApi.createPlan({
        planName: plan.planName,
        insurerName: plan.insurerName,
        planType: plan.planType,
        effectiveDate: plan.effectiveDate,
        // Backend expects 'deductible' and 'outOfPocketMax' (not deductibleIndividual/oopMaxIndividual)
        deductible: deductibleIndividual,
        deductibleFamily,
        outOfPocketMax: oopMaxIndividual,
        outOfPocketMaxFamily: oopMaxFamily,
      });
      // Transform the created plan for UI display
      const transformedCreated = transformPlanForDisplay(created as unknown as InsurancePlan);
      setInsurancePlans(prev => [...prev, transformedCreated]);
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Failed to save insurance plan';
      dashboardLogger.error('Error saving insurance plan', { error: errorMsg });
      onErrorRef.current(`${errorMsg}. Plan added locally but not synced to server.`);
      setInsurancePlans(prev => [...prev, transformedPlan]);
    }
  }, []);

  // Delete insurance plan
  const handleDeleteInsurancePlan = useCallback(async (planId: string) => {
    if (DEMO_MODE) {
      setInsurancePlans(prev => prev.filter(p => p.id !== planId));
      return;
    }

    try {
      await insuranceApi.deletePlan(planId);
      setInsurancePlans(prev => prev.filter(p => p.id !== planId));
      dashboardLogger.info('Insurance plan deleted', { planId });
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Failed to delete insurance plan';
      dashboardLogger.error('Error deleting insurance plan', { error: errorMsg, planId });
      onErrorRef.current(errorMsg);
      throw error; // Re-throw so caller can handle
    }
  }, []);

  return {
    biomarkers,
    insurancePlans,
    isLoading,
    handleAddMeasurement,
    handlePDFExtract,
    handleClinicalFileExtract,
    handleLabOCRSuccess,
    handleInsurancePlanExtracted,
    handleDeleteInsurancePlan,
    refreshBiomarkers,
    refreshInsurancePlans,
  };
}
