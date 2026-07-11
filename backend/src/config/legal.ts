/**
 * Versioned legal-policy identifiers.
 *
 * Bump CURRENT_TERMS_VERSION whenever the Terms of Service or Privacy Policy
 * materially changes. New registrations record the version the user accepted
 * (User.termsVersion, stamped in createUser); a future re-consent flow can compare
 * a user's stored version against this to prompt re-acceptance.
 *
 * Keep this in sync with the frontend constant in src/constants/legal.ts and with
 * the "Last updated" date shown on the Privacy/Terms pages.
 */
export const CURRENT_TERMS_VERSION = '2026-06-20';
