/**
 * Server-side AI medical-disclaimer enforcement (teardown L33).
 *
 * The AI system prompts ASK Claude to append an educational disclaimer, but that
 * is model-dependent — a direct API / SSE consumer (or a model that simply omits
 * it) would receive health guidance with no disclaimer. These helpers let the
 * server guarantee the disclaimer is present without double-appending when the
 * model already included an equivalent one.
 */

/** Canonical disclaimer text appended to AI health guidance when missing. */
export const AI_DISCLAIMER =
  '*This information is educational only. Always consult your healthcare provider ' +
  'for medical advice, diagnoses, and treatment decisions.*';

/**
 * Returns the disclaimer text to append (with leading spacing) when `emitted`
 * does not already contain an equivalent "consult your healthcare provider"
 * statement, or null when one is already present.
 *
 * Detection is deliberately lenient on phrasing so a slightly reworded
 * model-supplied disclaimer doesn't cause a duplicate.
 */
export function disclaimerToAppend(emitted: string): string | null {
  // Match the common phrasings the system prompts themselves instruct, so a
  // model-supplied disclaimer doesn't get a duplicate appended:
  //   "consult your healthcare provider", "consult a health care professional",
  //   "recommend consulting a healthcare provider", "consult with your provider".
  if (/consult(?:ing)?\s+(?:with\s+)?(?:your|a|the)?\s*(?:health\s*care|healthcare)\s+(?:provider|professional)/i.test(emitted)) {
    return null;
  }
  return `\n\n${AI_DISCLAIMER}`;
}
