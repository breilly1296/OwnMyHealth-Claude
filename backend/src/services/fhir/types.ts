/**
 * FHIR R4 type subset for SMART on FHIR lab-results import.
 *
 * We only model the fields we actually read. The full spec is vastly
 * larger; stripping to the minimum-necessary subset keeps the mapping
 * layer tight and makes it obvious what we care about.
 *
 * Reference: https://hl7.org/fhir/R4/observation.html
 */

export interface FHIRCoding {
  system: string;
  code: string;
  display?: string;
}

export interface FHIRCodeableConcept {
  coding?: FHIRCoding[];
  text?: string;
}

export interface FHIRReference {
  reference?: string;
  display?: string;
}

export interface FHIRQuantity {
  value: number;
  unit?: string;
  system?: string;
  code?: string;
}

export interface FHIRReferenceRange {
  low?: FHIRQuantity;
  high?: FHIRQuantity;
  text?: string;
}

export type FHIRObservationStatus =
  | 'registered'
  | 'preliminary'
  | 'final'
  | 'amended'
  | 'corrected'
  | 'cancelled'
  | 'entered-in-error'
  | 'unknown';

export interface FHIRObservation {
  resourceType: 'Observation';
  id: string;
  status: FHIRObservationStatus;
  category?: FHIRCodeableConcept[];
  code: FHIRCodeableConcept;
  valueQuantity?: FHIRQuantity;
  valueString?: string;
  valueCodeableConcept?: FHIRCodeableConcept;
  effectiveDateTime?: string;
  issued?: string;
  referenceRange?: FHIRReferenceRange[];
  interpretation?: FHIRCodeableConcept[];
  subject?: FHIRReference;
  note?: Array<{ text: string }>;
}

export interface FHIRDiagnosticReport {
  resourceType: 'DiagnosticReport';
  id: string;
  status: string;
  code: FHIRCodeableConcept;
  effectiveDateTime?: string;
  issued?: string;
  result?: FHIRReference[];
  subject?: FHIRReference;
}

export interface FHIRPatient {
  resourceType: 'Patient';
  id: string;
  gender?: 'male' | 'female' | 'other' | 'unknown';
  birthDate?: string;
}

export interface FHIRBundleEntry<T> {
  resource: T;
}

export interface FHIRBundleLink {
  relation: string; // 'self' | 'next' | 'prev'
  url: string;
}

export interface FHIRBundle<T> {
  resourceType: 'Bundle';
  type: string;
  total?: number;
  link?: FHIRBundleLink[];
  entry?: FHIRBundleEntry<T>[];
}

export interface SMARTConfiguration {
  authorization_endpoint: string;
  token_endpoint: string;
  introspection_endpoint?: string;
  revocation_endpoint?: string;
  scopes_supported?: string[];
  code_challenge_methods_supported?: string[];
}

/**
 * Token response per SMART on FHIR / OAuth 2.0 spec. `patient` is the
 * SMART-on-FHIR-specific field identifying the launched patient.
 */
export interface SMARTTokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number; // seconds
  scope: string;
  refresh_token?: string;
  patient?: string; // FHIR Patient.id (SMART standalone-launch)
  id_token?: string;
}

/**
 * LOINC system constant used throughout Observation codes. Defined in
 * one place so we can check for it when scanning multi-coded
 * CodeableConcepts.
 */
export const LOINC_SYSTEM = 'http://loinc.org';
export const UCUM_SYSTEM = 'http://unitsofmeasure.org';
export const FHIR_CATEGORY_SYSTEM = 'http://terminology.hl7.org/CodeSystem/observation-category';
