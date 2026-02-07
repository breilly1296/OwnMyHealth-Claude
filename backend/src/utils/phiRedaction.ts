/**
 * PHI Redaction Utility
 *
 * Strips common patient identifiers from text before sending to external AI APIs.
 * Defense-in-depth measure — minimize PHI exposure even when BAA is in place.
 *
 * @module utils/phiRedaction
 */

/**
 * Strip common PHI patterns from text before sending to AI services.
 */
export function stripPHIFromText(text: string): string {
  // Strip SSN patterns (XXX-XX-XXXX)
  text = text.replace(/\b\d{3}-\d{2}-\d{4}\b/g, '[SSN_REDACTED]');

  // Strip MRN/account number patterns (common formats)
  text = text.replace(/\b(?:MRN|Medical Record|Account|Patient ID)[:\s#]*[\w-]+/gi, '[MRN_REDACTED]');

  // Strip phone numbers
  text = text.replace(/\b(?:\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}\b/g, '[PHONE_REDACTED]');

  // Strip DOB patterns (MM/DD/YYYY, YYYY-MM-DD, etc.)
  text = text.replace(/\b(?:DOB|Date of Birth|Birth Date)[:\s]*\d{1,2}[/-]\d{1,2}[/-]\d{2,4}\b/gi, '[DOB_REDACTED]');

  // Strip addresses (basic pattern — street number + street name)
  text = text.replace(/\b\d{1,5}\s+[\w\s]{2,30}(?:Street|St|Avenue|Ave|Boulevard|Blvd|Drive|Dr|Road|Rd|Lane|Ln|Way|Court|Ct|Circle|Cir)\b/gi, '[ADDRESS_REDACTED]');

  return text;
}
