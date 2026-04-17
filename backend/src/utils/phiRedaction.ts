/**
 * PHI Redaction Utility
 *
 * Best-effort pattern-based scrubber. NOT a complete PHI oracle — regex
 * cannot catch patient names without contextual labels, handwritten /
 * scanned content, or freeform identifiers. Use as defense-in-depth
 * alongside minimum-necessary principles, never as the sole control.
 *
 * Applied to BOTH input (before sending to AI) and output (after receiving).
 *
 * @module utils/phiRedaction
 */

const PHI_PATTERNS: Array<{ name: string; pattern: RegExp; replacement: string }> = [
  // Identifiers — check the labeled/provider ones BEFORE the generic phone /
  // ZIP matchers so labeled NPI/DEA don't get swallowed by the phone pattern.
  { name: 'SSN', pattern: /\b\d{3}-\d{2}-\d{4}\b/g, replacement: '[SSN_REDACTED]' },
  {
    name: 'MRN labeled',
    pattern: /\b(?:MRN|Medical Record(?: Number)?|Account(?: Number)?|Patient ID|Chart Number)[:\s#]*[\w-]+/gi,
    replacement: '[MRN_REDACTED]',
  },
  { name: 'NPI', pattern: /\bNPI[:\s#]*\d{10}\b/gi, replacement: '[NPI_REDACTED]' },
  { name: 'DEA', pattern: /\bDEA[:\s#]*[A-Z]{2}\d{7}\b/gi, replacement: '[DEA_REDACTED]' },

  // Contact
  {
    name: 'Phone US',
    pattern: /\b(?:\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}\b/g,
    replacement: '[PHONE_REDACTED]',
  },
  { name: 'Email', pattern: /\b[\w._%+-]+@[\w.-]+\.[A-Za-z]{2,}\b/g, replacement: '[EMAIL_REDACTED]' },

  // Dates of birth
  {
    name: 'DOB labeled',
    pattern: /\b(?:DOB|Date of Birth|Birth Date|Born)[:\s]*\d{1,2}[/-]\d{1,2}[/-]\d{2,4}\b/gi,
    replacement: '[DOB_REDACTED]',
  },
  // Freestanding date near the word "birth"/"born" within a small window.
  // Kept conservative to avoid stripping lab collection dates.
  {
    name: 'DOB contextual',
    pattern: /(?:birth|born)[^\n]{0,20}\b\d{1,2}[/-]\d{1,2}[/-]\d{2,4}\b/gi,
    replacement: '[DOB_REDACTED]',
  },

  // Address — US-style street + suffix
  {
    name: 'Street address',
    pattern: /\b\d{1,5}\s+[\w\s]{2,30}(?:Street|St|Avenue|Ave|Boulevard|Blvd|Drive|Dr|Road|Rd|Lane|Ln|Way|Court|Ct|Circle|Cir|Place|Pl|Parkway|Pkwy|Terrace|Ter|Trail|Trl)\b/gi,
    replacement: '[ADDRESS_REDACTED]',
  },
  // ZIP codes (US) — 5-digit or 5+4. Negative lookahead skips reference-range
  // strings like "12345-10" that lab reports occasionally emit.
  { name: 'ZIP', pattern: /\b\d{5}(?:-\d{4})?\b(?!\s*[-/])/g, replacement: '[ZIP_REDACTED]' },

  // Labeled patient name — defensive. Catches "Patient: John Doe",
  // "Patient Name: Jane M Doe", "Name: John Smith". Two-word minimum so
  // single-token sign-offs like "Name: System" don't trip it.
  {
    name: 'Patient name labeled',
    pattern: /\b(?:Patient(?:\s*Name)?|Name)[:\s]+[A-Z][a-z]+(?:\s+[A-Z]\.?)?(?:\s+[A-Z][a-z]+)+/g,
    replacement: '[NAME_REDACTED]',
  },
];

/**
 * Strip common PHI patterns from text before sending to AI services.
 *
 * Kept for backward compatibility with existing callers. New code should
 * prefer `redactPHI` so it can log which patterns fired without logging
 * the (sensitive) original content.
 */
export function stripPHIFromText(text: string): string {
  return redactPHI(text).text;
}

/**
 * Redact PHI and report which pattern categories actually fired.
 *
 * Callers can log `firedPatterns` as diagnostic / audit metadata without
 * logging the original text, which is the whole point: "we stripped an
 * SSN and a phone" is safe to persist; "we stripped 123-45-6789" is not.
 */
export function redactPHI(text: string): { text: string; firedPatterns: string[] } {
  const firedPatterns: string[] = [];
  let result = text;

  for (const { name, pattern, replacement } of PHI_PATTERNS) {
    const before = result;
    result = result.replace(pattern, replacement);
    if (result !== before) {
      firedPatterns.push(name);
    }
  }

  return { text: result, firedPatterns };
}
