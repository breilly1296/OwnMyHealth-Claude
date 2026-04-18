/**
 * Knowledge retrieval — selects a handful of reference documents to
 * inject into the AI Health Guide system prompt, based on the user's
 * question, their actual health data, and a token budget.
 *
 * Keyword-matching is sufficient at this scale (~20 documents). When
 * the corpus grows large enough to justify it, swap in an embedding-
 * based retriever without changing the caller surface.
 */

import type { HealthContext } from '../healthContextService.js';
import type { KnowledgeDocument, RetrievalResult } from './types.js';
import { HEALTH_KNOWLEDGE } from './healthKnowledge.js';
import { INSURANCE_KNOWLEDGE } from './insuranceKnowledge.js';

const ALL_DOCUMENTS: KnowledgeDocument[] = [...HEALTH_KNOWLEDGE, ...INSURANCE_KNOWLEDGE];

type Intent = 'health' | 'insurance' | 'general';

// Filler words we strip from the question before matching.
const STOP_WORDS = new Set([
  'a',
  'an',
  'the',
  'is',
  'are',
  'was',
  'were',
  'be',
  'been',
  'being',
  'have',
  'has',
  'had',
  'do',
  'does',
  'did',
  'will',
  'would',
  'could',
  'should',
  'may',
  'might',
  'can',
  'what',
  'which',
  'when',
  'where',
  'why',
  'how',
  'who',
  'whom',
  'whose',
  'my',
  'me',
  'i',
  'you',
  'your',
  'of',
  'for',
  'to',
  'in',
  'on',
  'at',
  'and',
  'or',
  'but',
  'if',
  'then',
  'that',
  'this',
  'these',
  'those',
  'about',
  'like',
  'as',
  'so',
  "'s",
]);

const HEALTH_INTENT_WORDS = new Set([
  'biomarker',
  'level',
  'levels',
  'range',
  'result',
  'results',
  'lab',
  'labs',
  'blood',
  'test',
  'tests',
  'value',
  'values',
  'normal',
  'abnormal',
  'high',
  'low',
  'cholesterol',
  'ldl',
  'hdl',
  'triglycerides',
  'glucose',
  'a1c',
  'hba1c',
  'hormone',
  'hormones',
  'vitamin',
  'iron',
  'thyroid',
  'liver',
  'kidney',
  'heart',
  'cardiac',
  'cbc',
  'wbc',
  'rbc',
  'hemoglobin',
  'platelet',
  'platelets',
  'tsh',
  'cortisol',
  'testosterone',
  'estradiol',
  'crp',
  'esr',
]);

const INSURANCE_INTENT_WORDS = new Set([
  'insurance',
  'coverage',
  'cover',
  'covered',
  'deductible',
  'copay',
  'copays',
  'coinsurance',
  'plan',
  'plans',
  'cost',
  'costs',
  'pay',
  'paid',
  'premium',
  'premiums',
  'benefit',
  'benefits',
  'claim',
  'claims',
  'eob',
  'oop',
  'pocket',
  'hmo',
  'ppo',
  'epo',
  'pos',
  'hdhp',
  'hsa',
  'fsa',
  'network',
  'formulary',
  'tier',
  'prior',
  'authorization',
  'enrollment',
  'marketplace',
  'preventive',
]);

const DEFAULT_TOKEN_BUDGET = 1500;

function tokenizeQuestion(question: string): string[] {
  const lowered = question.toLowerCase();
  // Split on non-alphanumerics so hyphenated terms get both halves; we
  // match against each half below.
  const raw = lowered.split(/[^a-z0-9]+/).filter(Boolean);
  return raw.filter((word) => word.length > 1 && !STOP_WORDS.has(word));
}

function detectIntent(tokens: string[]): Intent {
  let healthHits = 0;
  let insuranceHits = 0;
  for (const token of tokens) {
    if (HEALTH_INTENT_WORDS.has(token)) healthHits++;
    if (INSURANCE_INTENT_WORDS.has(token)) insuranceHits++;
  }
  if (healthHits === 0 && insuranceHits === 0) return 'general';
  if (healthHits >= insuranceHits) {
    // If both fire, bias toward insurance when it has strictly more hits.
    return insuranceHits > healthHits ? 'insurance' : 'health';
  }
  return 'insurance';
}

function lcSet(values: string[]): Set<string> {
  return new Set(values.map((v) => v.toLowerCase()));
}

function scoreDocument(
  doc: KnowledgeDocument,
  questionTokens: Set<string>,
  healthContext: HealthContext,
  intent: Intent
): number {
  let score = 0;

  // (+3) per keyword hit in the doc's keyword list
  for (const kw of doc.keywords) {
    const lc = kw.toLowerCase();
    // Multi-word keywords match only when every sub-token appears.
    const parts = lc.split(/\s+/).filter(Boolean);
    const allPresent = parts.every((part) => questionTokens.has(part));
    if (allPresent) score += 3;
  }

  // Biomarker-based relevance against the user's actual data.
  if (doc.relevantBiomarkers.length > 0) {
    const docBiomarkers = lcSet(doc.relevantBiomarkers);
    for (const b of healthContext.biomarkers.detail) {
      const name = b.name.toLowerCase();
      if (docBiomarkers.has(name)) {
        score += b.isOutOfRange ? 5 : 2;
      }
    }
  }

  // Intent boost
  if (intent !== 'general' && doc.domain === intent) score += 1;

  // Insurance boost when the user actually has plans loaded — a
  // plan-types doc is more useful to someone with a plan on file.
  if (doc.domain === 'insurance' && healthContext.insurance.totalPlans > 0) score += 1;

  return score;
}

/**
 * Select relevant knowledge documents for the current chat turn.
 * Returns an empty result when nothing scores — better to send no
 * reference content than to pad the prompt with irrelevant text.
 */
export function retrieveKnowledge(
  question: string,
  healthContext: HealthContext,
  tokenBudget: number = DEFAULT_TOKEN_BUDGET
): RetrievalResult {
  if (tokenBudget <= 0) return { documents: [], totalTokens: 0 };

  const tokens = tokenizeQuestion(question);
  const tokenSet = new Set(tokens);
  const intent = detectIntent(tokens);

  const scored = ALL_DOCUMENTS.map((doc) => ({
    doc,
    score: scoreDocument(doc, tokenSet, healthContext, intent),
  }))
    .filter((s) => s.score > 0)
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      // Tie-break: smaller doc first so we pack more variety into the budget.
      return a.doc.tokenEstimate - b.doc.tokenEstimate;
    });

  const selected: KnowledgeDocument[] = [];
  let totalTokens = 0;
  for (const { doc } of scored) {
    if (totalTokens + doc.tokenEstimate > tokenBudget) continue;
    selected.push(doc);
    totalTokens += doc.tokenEstimate;
  }

  return { documents: selected, totalTokens };
}

/**
 * Exposed for tests and future callers that want to know what the
 * retriever thought the question was about.
 */
export function _detectIntentForTest(question: string): Intent {
  return detectIntent(tokenizeQuestion(question));
}
