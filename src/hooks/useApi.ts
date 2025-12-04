/**
 * Custom React hooks for API data fetching
 *
 * These hooks handle:
 * - Loading and error states
 * - Automatic data fetching on mount
 * - Manual refresh capability
 * - PHI data cleanup on unmount
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import {
  biomarkersApi,
  insuranceApi,
  dnaApi,
  healthNeedsApi,
  healthAnalysisApi,
  type BiomarkerData,
  type InsurancePlanData,
  type DNADataInfo,
  type GeneticTraitData,
  type HealthNeedData,
  type HealthAnalysisResult,
  type ApiError,
} from '../services/api';

// Generic hook state
interface UseApiState<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
}

// Generic fetcher hook
function useApiFetch<T>(
  fetcher: () => Promise<T>,
  options?: {
    immediate?: boolean;
    clearOnUnmount?: boolean;
  }
) {
  const { immediate = true, clearOnUnmount = true } = options || {};

  const [state, setState] = useState<UseApiState<T>>({
    data: null,
    loading: immediate,
    error: null,
  });

  const mountedRef = useRef(true);

  const fetchData = useCallback(async () => {
    setState((prev) => ({ ...prev, loading: true, error: null }));

    try {
      const result = await fetcher();
      if (mountedRef.current) {
        setState({ data: result, loading: false, error: null });
      }
      return result;
    } catch (err) {
      const error = err as ApiError;
      if (mountedRef.current) {
        setState({
          data: null,
          loading: false,
          error: error.message || 'An error occurred',
        });
      }
      throw err;
    }
  }, [fetcher]);

  useEffect(() => {
    mountedRef.current = true;

    if (immediate) {
      fetchData();
    }

    return () => {
      mountedRef.current = false;
      // Clear PHI data on unmount to prevent memory leaks
      if (clearOnUnmount) {
        setState({ data: null, loading: false, error: null });
      }
    };
  }, [immediate, fetchData, clearOnUnmount]);

  const refresh = useCallback(() => {
    return fetchData();
  }, [fetchData]);

  const clear = useCallback(() => {
    setState({ data: null, loading: false, error: null });
  }, []);

  return {
    ...state,
    refresh,
    clear,
    setData: (data: T | null) => setState((prev) => ({ ...prev, data })),
  };
}

// ============================================
// BIOMARKERS HOOKS
// ============================================

export function useBiomarkers(category?: string) {
  const fetcher = useCallback(async () => {
    const result = await biomarkersApi.getAll({ category });
    return result.biomarkers;
  }, [category]);

  return useApiFetch<BiomarkerData[]>(fetcher, { clearOnUnmount: true });
}

export function useBiomarker(id: string | null) {
  const fetcher = useCallback(async () => {
    if (!id) return null;
    return biomarkersApi.getById(id);
  }, [id]);

  return useApiFetch<BiomarkerData | null>(fetcher, {
    immediate: !!id,
    clearOnUnmount: true,
  });
}

export function useBiomarkerHistory(id: string | null) {
  const fetcher = useCallback(async () => {
    if (!id) return [];
    return biomarkersApi.getHistory(id);
  }, [id]);

  return useApiFetch(fetcher, {
    immediate: !!id,
    clearOnUnmount: true,
  });
}

export function useBiomarkerSummary() {
  const fetcher = useCallback(() => biomarkersApi.getSummary(), []);
  return useApiFetch(fetcher, { clearOnUnmount: false });
}

export function useBiomarkerCategories() {
  const fetcher = useCallback(() => biomarkersApi.getCategories(), []);
  return useApiFetch<string[]>(fetcher, { clearOnUnmount: false });
}

// ============================================
// INSURANCE HOOKS
// ============================================

export function useInsurancePlans() {
  const fetcher = useCallback(() => insuranceApi.getPlans(), []);
  return useApiFetch<InsurancePlanData[]>(fetcher, { clearOnUnmount: true });
}

export function useInsurancePlan(id: string | null) {
  const fetcher = useCallback(async () => {
    if (!id) return null;
    return insuranceApi.getPlanById(id);
  }, [id]);

  return useApiFetch<InsurancePlanData | null>(fetcher, {
    immediate: !!id,
    clearOnUnmount: true,
  });
}

export function useInsuranceBenefits(planId: string | null) {
  const fetcher = useCallback(async () => {
    if (!planId) return [];
    return insuranceApi.getBenefits(planId);
  }, [planId]);

  return useApiFetch(fetcher, {
    immediate: !!planId,
    clearOnUnmount: true,
  });
}

// ============================================
// DNA HOOKS
// ============================================

export function useDNAUploads() {
  const fetcher = useCallback(() => dnaApi.getUploads(), []);
  return useApiFetch<DNADataInfo[]>(fetcher, { clearOnUnmount: true });
}

export function useDNAUpload(id: string | null) {
  const fetcher = useCallback(async () => {
    if (!id) return null;
    return dnaApi.getUploadById(id);
  }, [id]);

  return useApiFetch<DNADataInfo | null>(fetcher, {
    immediate: !!id,
    clearOnUnmount: true,
  });
}

export function useGeneticTraits(dnaId: string | null) {
  const fetcher = useCallback(async () => {
    if (!dnaId) return [];
    return dnaApi.getTraits(dnaId);
  }, [dnaId]);

  return useApiFetch<GeneticTraitData[]>(fetcher, {
    immediate: !!dnaId,
    clearOnUnmount: true,
  });
}

// ============================================
// HEALTH NEEDS HOOKS
// ============================================

export function useHealthNeeds(params?: { status?: string; urgency?: string }) {
  const fetcher = useCallback(() => healthNeedsApi.getAll(params), [params]);
  return useApiFetch<HealthNeedData[]>(fetcher, { clearOnUnmount: true });
}

export function useHealthNeed(id: string | null) {
  const fetcher = useCallback(async () => {
    if (!id) return null;
    return healthNeedsApi.getById(id);
  }, [id]);

  return useApiFetch<HealthNeedData | null>(fetcher, {
    immediate: !!id,
    clearOnUnmount: true,
  });
}

// ============================================
// HEALTH ANALYSIS HOOKS
// ============================================

export function useHealthAnalysis() {
  const fetcher = useCallback(() => healthAnalysisApi.getAnalysis(), []);
  return useApiFetch<HealthAnalysisResult>(fetcher, { clearOnUnmount: true });
}

// ============================================
// MUTATION HOOKS
// ============================================

interface MutationState<T> {
  loading: boolean;
  error: string | null;
  data: T | null;
}

function useMutation<TData, TResult>(
  mutationFn: (data: TData) => Promise<TResult>
) {
  const [state, setState] = useState<MutationState<TResult>>({
    loading: false,
    error: null,
    data: null,
  });

  const mutate = useCallback(
    async (data: TData): Promise<TResult> => {
      setState({ loading: true, error: null, data: null });

      try {
        const result = await mutationFn(data);
        setState({ loading: false, error: null, data: result });
        return result;
      } catch (err) {
        const error = err as ApiError;
        setState({
          loading: false,
          error: error.message || 'An error occurred',
          data: null,
        });
        throw err;
      }
    },
    [mutationFn]
  );

  const reset = useCallback(() => {
    setState({ loading: false, error: null, data: null });
  }, []);

  return { ...state, mutate, reset };
}

// Biomarker mutations
export function useCreateBiomarker() {
  return useMutation(biomarkersApi.create);
}

export function useCreateBiomarkerBatch() {
  return useMutation(biomarkersApi.createBatch);
}

export function useUpdateBiomarker() {
  return useMutation(
    ({ id, data }: { id: string; data: Parameters<typeof biomarkersApi.update>[1] }) =>
      biomarkersApi.update(id, data)
  );
}

export function useDeleteBiomarker() {
  return useMutation(biomarkersApi.delete);
}

// Insurance mutations
export function useCreateInsurancePlan() {
  return useMutation(insuranceApi.createPlan);
}

export function useUpdateInsurancePlan() {
  return useMutation(
    ({ id, data }: { id: string; data: Parameters<typeof insuranceApi.updatePlan>[1] }) =>
      insuranceApi.updatePlan(id, data)
  );
}

export function useDeleteInsurancePlan() {
  return useMutation(insuranceApi.deletePlan);
}

export function useUploadSBC() {
  return useMutation(insuranceApi.uploadSBC);
}

// DNA mutations
export function useUploadDNA() {
  return useMutation(({ file, source }: { file: File; source: string }) =>
    dnaApi.uploadDNA(file, source)
  );
}

export function useDeleteDNAUpload() {
  return useMutation(dnaApi.deleteUpload);
}

// Health needs mutations
export function useCreateHealthNeed() {
  return useMutation(healthNeedsApi.create);
}

export function useUpdateHealthNeedStatus() {
  return useMutation(({ id, status }: { id: string; status: string }) =>
    healthNeedsApi.updateStatus(id, status)
  );
}

export function useDeleteHealthNeed() {
  return useMutation(healthNeedsApi.delete);
}
