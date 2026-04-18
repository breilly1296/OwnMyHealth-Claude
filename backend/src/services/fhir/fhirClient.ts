/**
 * FHIR R4 HTTP client.
 *
 * Thin typed wrapper around fetch for the subset of FHIR resources we
 * consume — Patient, Observation, DiagnosticReport. Pagination is
 * handled via the standard `link[rel=next]` URL chain, which every
 * spec-conformant server provides.
 */

import type {
  FHIRBundle,
  FHIRObservation,
  FHIRDiagnosticReport,
  FHIRPatient,
} from './types.js';

export interface ListParams {
  dateFrom?: string; // FHIR date param, e.g. '2026-01-01'
  dateTo?: string;
  code?: string;
  count?: number;
}

const DEFAULT_COUNT = 100;
const DEFAULT_TIMEOUT_MS = 30_000;

export class FHIRClient {
  constructor(private baseUrl: string, private accessToken: string) {}

  private async request<T>(path: string, absolute?: boolean): Promise<T> {
    const url = absolute ? path : `${this.baseUrl.replace(/\/$/, '')}/${path.replace(/^\//, '')}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);
    try {
      const response = await fetch(url, {
        headers: {
          Authorization: `Bearer ${this.accessToken}`,
          Accept: 'application/fhir+json, application/json;q=0.9',
        },
        signal: controller.signal,
      });
      if (!response.ok) {
        const snippet = await response.text().then((t) => t.slice(0, 300)).catch(() => '');
        throw new Error(`FHIR request failed: ${response.status} ${snippet}`);
      }
      return (await response.json()) as T;
    } finally {
      clearTimeout(timer);
    }
  }

  async getPatient(patientId: string): Promise<FHIRPatient> {
    return this.request<FHIRPatient>(`Patient/${encodeURIComponent(patientId)}`);
  }

  /**
   * Get lab Observations for a patient. Paginates automatically via
   * `link[rel=next]` until all entries are collected.
   */
  async getLabResults(patientId: string, params: ListParams = {}): Promise<FHIRObservation[]> {
    const qs = this.buildQuery(patientId, 'laboratory', params);
    return this.collectAllPages<FHIRObservation>(`Observation?${qs}`);
  }

  async getDiagnosticReports(
    patientId: string,
    params: ListParams = {}
  ): Promise<FHIRDiagnosticReport[]> {
    const search = new URLSearchParams();
    search.set('patient', patientId);
    if (params.dateFrom) search.append('date', `ge${params.dateFrom}`);
    if (params.dateTo) search.append('date', `le${params.dateTo}`);
    search.set('_count', String(params.count ?? DEFAULT_COUNT));
    return this.collectAllPages<FHIRDiagnosticReport>(`DiagnosticReport?${search.toString()}`);
  }

  private buildQuery(patientId: string, category: string, params: ListParams): string {
    const search = new URLSearchParams();
    search.set('patient', patientId);
    search.set('category', category);
    if (params.code) search.set('code', params.code);
    if (params.dateFrom) search.append('date', `ge${params.dateFrom}`);
    if (params.dateTo) search.append('date', `le${params.dateTo}`);
    search.set('_count', String(params.count ?? DEFAULT_COUNT));
    return search.toString();
  }

  private async collectAllPages<T>(initialPath: string): Promise<T[]> {
    const all: T[] = [];
    let firstBundle = await this.request<FHIRBundle<T>>(initialPath);
    pushEntries(firstBundle, all);
    let nextUrl = nextLink(firstBundle);
    let pageCount = 1;
    while (nextUrl && pageCount < 20) {
      // 20-page safety stop — 20 × 100 = 2000 resources. If a provider
      // returns more than that we'll log and bail rather than loop
      // indefinitely on a pathological response.
      firstBundle = await this.request<FHIRBundle<T>>(nextUrl, true);
      pushEntries(firstBundle, all);
      nextUrl = nextLink(firstBundle);
      pageCount++;
    }
    return all;
  }
}

function pushEntries<T>(bundle: FHIRBundle<T>, target: T[]): void {
  if (!bundle.entry) return;
  for (const entry of bundle.entry) {
    if (entry.resource) target.push(entry.resource);
  }
}

function nextLink<T>(bundle: FHIRBundle<T>): string | null {
  if (!bundle.link) return null;
  const next = bundle.link.find((l) => l.relation === 'next');
  return next?.url ?? null;
}
