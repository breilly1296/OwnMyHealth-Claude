/**
 * TermsOfService - public terms of service page (OMH-L05).
 * Factual draft. DRAFT — counsel must finalize (esp. governing law, liability,
 * arbitration, and any jurisdiction-specific terms).
 */
import LegalPageShell from './LegalPageShell';
import { LEGAL_CONTACT_EMAIL } from '../../constants/legal';

interface TermsOfServiceProps {
  onBack: () => void;
}

export default function TermsOfService({ onBack }: TermsOfServiceProps) {
  return (
    <LegalPageShell title="Terms of Service" onBack={onBack}>
      <p>
        These Terms govern your use of OwnMyHealth. By creating an account you agree to these Terms
        and to our <a href="/privacy" target="_blank" rel="noopener noreferrer">Privacy Policy</a>.
      </p>

      <h2>1. Eligibility &amp; account</h2>
      <ul>
        <li>You must be at least 18 years old (or the age of majority where you live) to use OwnMyHealth.</li>
        <li>You are responsible for keeping your credentials confidential and for activity under your account.</li>
        <li>You agree to provide accurate information and to keep it current.</li>
      </ul>

      <h2>2. Not medical advice</h2>
      <p>
        OwnMyHealth is an informational and organizational tool. Content in the app — including
        AI-generated insights and cost analysis — is <strong>educational only and is not medical
        advice, diagnosis, or treatment</strong>. Always consult a qualified healthcare professional
        for medical decisions. Never disregard professional medical advice because of something you
        read in the app.
      </p>

      <h2>3. Your data and content</h2>
      <ul>
        <li>You own the health data and content you submit. You grant us the limited rights needed to operate the service (store, process, and display it back to you, and process it through the sub-processors described in the Privacy Policy).</li>
        <li>You are responsible for the accuracy of the data you enter or upload.</li>
        <li>You can export or delete your data as described in the Privacy Policy.</li>
      </ul>

      <h2>4. Acceptable use</h2>
      <ul>
        <li>Do not upload data you are not authorized to share, or another person&apos;s health data without authorization.</li>
        <li>Do not attempt to breach security, access other users&apos; data, or disrupt the service.</li>
        <li>Do not use the service for unlawful purposes.</li>
      </ul>

      <h2>5. Service availability &amp; changes</h2>
      <p>We may modify, suspend, or discontinue features. We aim to give reasonable notice of material changes. The service is provided on an &ldquo;as is&rdquo; and &ldquo;as available&rdquo; basis.</p>

      <h2>6. Disclaimers &amp; limitation of liability</h2>
      <p>
        To the maximum extent permitted by law, OwnMyHealth disclaims warranties of merchantability,
        fitness for a particular purpose, and non-infringement, and is not liable for indirect,
        incidental, or consequential damages arising from your use of the service.
        <em> (Counsel to finalize the specific liability cap, warranty, indemnity, arbitration, and
        governing-law provisions.)</em>
      </p>

      <h2>7. Termination</h2>
      <p>You may stop using the service and delete your account at any time. We may suspend or terminate accounts that violate these Terms.</p>

      <h2>8. Governing law</h2>
      <p><em>[To be set by counsel — jurisdiction and dispute-resolution terms.]</em></p>

      <h2>9. Contact</h2>
      <p>Questions about these Terms: <a href={`mailto:${LEGAL_CONTACT_EMAIL}`}>{LEGAL_CONTACT_EMAIL}</a>.</p>
    </LegalPageShell>
  );
}
