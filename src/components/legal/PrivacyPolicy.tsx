/**
 * PrivacyPolicy - public privacy policy page (OMH-L05).
 *
 * Factual, engineering-accurate draft. The sub-processor list is derived from the
 * actual integrations in the codebase (Anthropic Claude, Google Cloud Storage,
 * Google Document AI, SendGrid, Quest Diagnostics). DRAFT — counsel must finalize.
 */
import LegalPageShell from './LegalPageShell';
import { LEGAL_CONTACT_EMAIL } from '../../constants/legal';

interface PrivacyPolicyProps {
  onBack: () => void;
}

export default function PrivacyPolicy({ onBack }: PrivacyPolicyProps) {
  return (
    <LegalPageShell title="Privacy Policy" onBack={onBack}>
      <p>
        OwnMyHealth is a consumer health platform you control. This policy explains what data we
        collect, how we protect it, who processes it on our behalf, and the choices you have. We do
        not sell your personal information.
      </p>

      <h2>Information we collect</h2>
      <ul>
        <li><strong>Account information</strong> — email, password (stored only as a salted hash), and optional name.</li>
        <li><strong>Health data you enter or upload</strong> — biomarkers and lab values, health goals and needs, DEXA results, and documents you upload (lab reports, insurance Summary of Benefits and Coverage).</li>
        <li><strong>Insurance and expense information</strong> — plans, member identifiers, benefits, and the expenses you track.</li>
        <li><strong>Operational data</strong> — audit logs of access to your health data (required for security and retained as described below).</li>
      </ul>

      <h2>How we protect it</h2>
      <ul>
        <li>All protected health information is <strong>encrypted at rest</strong> with AES-256-GCM using per-user keys.</li>
        <li>Data is <strong>encrypted in transit</strong> with TLS.</li>
        <li>Database <strong>row-level security</strong> enforces that you can only access your own records.</li>
        <li>Access to health data is <strong>audit-logged</strong> and retained for 7 years.</li>
      </ul>

      <h2>How we use your information</h2>
      <ul>
        <li>To provide the service: storing and displaying your health data, trends, and documents.</li>
        <li>To generate <strong>educational</strong> AI insights and cost analysis on the data you provide. AI output is informational, not medical advice or diagnosis.</li>
        <li>To extract structured data from documents you upload (OCR and AI extraction of lab reports / insurance documents).</li>
        <li>To send transactional email (verification, password reset, and notices you have not opted out of).</li>
      </ul>

      <h2>Service providers (sub-processors)</h2>
      <p>We share the minimum data necessary with the following processors, under agreements that restrict their use of it. We do not sell your data to anyone.</p>
      <ul>
        <li><strong>Anthropic (Claude API)</strong> — AI extraction of uploaded documents and educational health/cost guidance, on the data you submit for those features.</li>
        <li><strong>Google Cloud</strong> — Cloud Storage (your uploaded files), Document AI (OCR of scanned documents), and our hosting/database (Cloud Run, Cloud SQL).</li>
        <li><strong>SendGrid (Twilio)</strong> — delivery of transactional email (your address and message content only).</li>
        <li><strong>Quest Diagnostics</strong> — only if you choose to connect a lab account, to import your lab results via the provider&apos;s authorized API.</li>
      </ul>

      <h2>Your choices and rights</h2>
      <ul>
        <li><strong>Export</strong> — you can export your data from Settings.</li>
        <li><strong>Deletion</strong> — you can delete your account and data from Settings; deletion removes your records and associated files.</li>
        <li><strong>Provider sharing</strong> — provider access to your data happens only with your explicit, scoped consent and can be revoked.</li>
      </ul>

      <h2>Legal framework</h2>
      <p>
        OwnMyHealth is a direct-to-consumer personal health record that you control; in most cases it
        is not a HIPAA covered entity or business associate. Our handling of your health information is
        governed by the U.S. Federal Trade Commission&apos;s Health Breach Notification Rule and
        applicable state privacy laws, under which we will notify you and regulators of a breach of
        unsecured health information as required.
      </p>

      <h2>Data retention</h2>
      <p>We retain your data while your account is active and as required for security and legal obligations (audit logs are retained for 7 years). When you delete your account, your personal data is removed except where retention is legally required.</p>

      <h2>Changes to this policy</h2>
      <p>We may update this policy and will revise the &ldquo;Last updated&rdquo; date above. Material changes may require renewed acceptance at sign-in.</p>

      <h2>Contact</h2>
      <p>Questions about privacy: <a href={`mailto:${LEGAL_CONTACT_EMAIL}`}>{LEGAL_CONTACT_EMAIL}</a>.</p>
    </LegalPageShell>
  );
}
