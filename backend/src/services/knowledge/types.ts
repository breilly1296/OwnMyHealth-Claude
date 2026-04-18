/**
 * Knowledge layer types — shared between the health/insurance stores
 * and the retrieval service. Documents live as TypeScript constants
 * compiled into the backend; no database involved at this scale.
 */

export type KnowledgeDomain = 'health' | 'insurance';

/**
 * `source` distinguishes system-curated documents (shipped with the
 * backend) from future user-uploaded documents. Leaving the field in
 * the shape so we can add user-scoped retrieval later without churn.
 */
export type KnowledgeSource = 'system' | 'user';

export interface KnowledgeDocument {
  id: string;
  domain: KnowledgeDomain;
  category: string;
  title: string;
  /** Lower-cased tokens matched against the user's question. */
  keywords: string[];
  /** Canonical biomarker names this doc covers. Empty for insurance docs. */
  relevantBiomarkers: string[];
  /** Approximate token count for budget management. */
  tokenEstimate: number;
  /** Markdown content injected into the system prompt. */
  content: string;
  source: KnowledgeSource;
}

export interface RetrievalResult {
  documents: KnowledgeDocument[];
  totalTokens: number;
}
