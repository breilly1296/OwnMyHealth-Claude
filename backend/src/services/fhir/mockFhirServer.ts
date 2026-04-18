/**
 * Mock FHIR server — dev-only.
 *
 * Serves a minimal SMART-on-FHIR surface so the integration can be
 * end-to-end tested locally without real Quest sandbox credentials.
 * Returns stable fake data for a single simulated patient.
 *
 * Mount via mountMockFhirServer(app) from app.ts, gated behind
 * NODE_ENV === 'development'. DO NOT mount in production.
 */

import type { Express, Request, Response, Router } from 'express';
import express from 'express';
import { randomBytes } from 'crypto';
import type {
  FHIRBundle,
  FHIRObservation,
  FHIRPatient,
  SMARTConfiguration,
  SMARTTokenResponse,
} from './types.js';
import { LOINC_SYSTEM, FHIR_CATEGORY_SYSTEM, UCUM_SYSTEM } from './types.js';
import { logger } from '../../utils/logger.js';

const MOCK_PATIENT_ID = 'mock-patient-001';

/**
 * Deterministic sample observations covering a variety of LOINC codes
 * so the LOINC mapper exercises its main paths during local testing.
 */
const MOCK_OBSERVATIONS: FHIRObservation[] = [
  buildObs('mock-obs-1', '2093-3', 'Cholesterol [Mass/Vol]', 195, 'mg/dL', '2026-03-10', { low: 125, high: 200 }),
  buildObs('mock-obs-2', '2085-9', 'HDL Cholesterol', 52, 'mg/dL', '2026-03-10', { low: 40 }),
  buildObs('mock-obs-3', '13457-7', 'LDL Cholesterol', 115, 'mg/dL', '2026-03-10', { high: 100 }, 'H'),
  buildObs('mock-obs-4', '2571-8', 'Triglycerides', 140, 'mg/dL', '2026-03-10', { high: 150 }),
  buildObs('mock-obs-5', '2345-7', 'Glucose', 92, 'mg/dL', '2026-03-10', { low: 70, high: 99 }),
  buildObs('mock-obs-6', '4548-4', 'Hemoglobin A1c', 5.4, '%', '2026-03-10', { low: 4.0, high: 5.6 }),
  buildObs('mock-obs-7', '2160-0', 'Creatinine', 0.95, 'mg/dL', '2026-03-10', { low: 0.6, high: 1.2 }),
  buildObs('mock-obs-8', '33914-3', 'eGFR', 98, 'mL/min/1.73m2', '2026-03-10', { low: 60 }),
  buildObs('mock-obs-9', '3016-3', 'TSH', 2.1, 'mIU/L', '2026-03-10', { low: 0.4, high: 4.0 }),
  buildObs('mock-obs-10', '1989-3', 'Vitamin D', 31, 'ng/mL', '2026-03-10', { low: 30, high: 100 }),
  // One unmapped code so the fallback path gets exercised:
  buildObs('mock-obs-11', '99999-9', 'Experimental marker', 1.2, 'units', '2026-03-10', undefined),
];

function buildObs(
  id: string,
  loincCode: string,
  display: string,
  value: number,
  unit: string,
  effectiveDate: string,
  range?: { low?: number; high?: number },
  interpretation?: 'H' | 'L' | 'N'
): FHIRObservation {
  const obs: FHIRObservation = {
    resourceType: 'Observation',
    id,
    status: 'final',
    category: [
      {
        coding: [{ system: FHIR_CATEGORY_SYSTEM, code: 'laboratory', display: 'Laboratory' }],
      },
    ],
    code: { coding: [{ system: LOINC_SYSTEM, code: loincCode, display }] },
    valueQuantity: { value, unit, system: UCUM_SYSTEM, code: unit },
    effectiveDateTime: effectiveDate,
    issued: effectiveDate,
    subject: { reference: `Patient/${MOCK_PATIENT_ID}` },
  };
  if (range) {
    obs.referenceRange = [
      {
        low: range.low !== undefined ? { value: range.low, unit } : undefined,
        high: range.high !== undefined ? { value: range.high, unit } : undefined,
      },
    ];
  }
  if (interpretation) {
    obs.interpretation = [
      {
        coding: [
          {
            system: 'http://terminology.hl7.org/CodeSystem/v3-ObservationInterpretation',
            code: interpretation,
          },
        ],
      },
    ];
  }
  return obs;
}

export function buildMockFhirRouter(): Router {
  const router = express.Router();

  // Parse JSON on the token endpoint. The rest is GET-only.
  router.use(express.urlencoded({ extended: false }));
  router.use(express.json());

  // SMART configuration discovery
  router.get('/r4/.well-known/smart-configuration', (_req: Request, res: Response) => {
    // Base host doesn't matter — the client uses whatever FHIR_BASE_URL it's configured with.
    const base = '/api/v1/mock-fhir/r4';
    const config: SMARTConfiguration = {
      authorization_endpoint: `${base}/authorize`,
      token_endpoint: `${base}/token`,
      scopes_supported: [
        'launch/patient',
        'patient/Observation.read',
        'patient/DiagnosticReport.read',
        'patient/Patient.read',
        'offline_access',
      ],
      code_challenge_methods_supported: ['S256'],
    };
    res.json(config);
  });

  // Authorize — immediately redirects back to the client's redirect_uri
  // with a fake auth code. Simulates a user clicking "Authorize" without
  // a UI round-trip.
  router.get('/r4/authorize', (req: Request, res: Response) => {
    const { redirect_uri, state } = req.query as Record<string, string>;
    if (!redirect_uri) {
      res.status(400).json({ error: 'invalid_request', error_description: 'missing redirect_uri' });
      return;
    }
    const code = `mock_code_${randomBytes(8).toString('hex')}`;
    const separator = redirect_uri.includes('?') ? '&' : '?';
    res.redirect(`${redirect_uri}${separator}code=${code}&state=${encodeURIComponent(state ?? '')}`);
  });

  // Token exchange — accepts any code + verifier, returns a mock token.
  router.post('/r4/token', (req: Request, res: Response) => {
    const grantType = (req.body?.grant_type as string) ?? '';
    if (grantType !== 'authorization_code' && grantType !== 'refresh_token') {
      res.status(400).json({ error: 'unsupported_grant_type' });
      return;
    }
    const token: SMARTTokenResponse = {
      access_token: `mock_access_${randomBytes(16).toString('hex')}`,
      token_type: 'Bearer',
      expires_in: 3600,
      scope:
        'launch/patient patient/Observation.read patient/DiagnosticReport.read patient/Patient.read offline_access',
      refresh_token:
        grantType === 'refresh_token' ? undefined : `mock_refresh_${randomBytes(16).toString('hex')}`,
      patient: MOCK_PATIENT_ID,
    };
    res.json(token);
  });

  // Patient resource
  router.get('/r4/Patient/:id', (req: Request, res: Response) => {
    const patient: FHIRPatient = {
      resourceType: 'Patient',
      id: req.params.id || MOCK_PATIENT_ID,
      gender: 'unknown',
    };
    res.json(patient);
  });

  // Observations (lab results). Supports ?patient=X&category=laboratory and
  // ignores date filters — the mock dataset is small enough.
  router.get('/r4/Observation', (_req: Request, res: Response) => {
    const bundle: FHIRBundle<FHIRObservation> = {
      resourceType: 'Bundle',
      type: 'searchset',
      total: MOCK_OBSERVATIONS.length,
      entry: MOCK_OBSERVATIONS.map((resource) => ({ resource })),
    };
    res.json(bundle);
  });

  // Diagnostic reports — minimal stub
  router.get('/r4/DiagnosticReport', (_req: Request, res: Response) => {
    const bundle: FHIRBundle<unknown> = {
      resourceType: 'Bundle',
      type: 'searchset',
      total: 0,
      entry: [],
    };
    res.json(bundle);
  });

  return router;
}

/**
 * Mount the mock FHIR server under /api/v1/mock-fhir. Gated behind
 * NODE_ENV === 'development' by the caller.
 */
export function mountMockFhirServer(app: Express): void {
  if (process.env.NODE_ENV === 'production') {
    logger.warn('Refusing to mount mock FHIR server in production');
    return;
  }
  const router = buildMockFhirRouter();
  app.use('/api/v1/mock-fhir', router);
  logger.info('Mock FHIR server mounted at /api/v1/mock-fhir', {
    prefix: 'MockFHIR',
  });
}
