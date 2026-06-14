import type { ExtractedBiomarkerPreview } from '../components/upload/ExtractionReviewStep';

/**
 * Reconcile the server-OCR "Review Extracted Biomarkers" step with what was
 * actually persisted.
 *
 * The OCR upload endpoint (POST /upload/lab-results-ocr) auto-creates EVERY
 * extracted biomarker server-side before the user sees the review. Previously
 * the review was a placebo — deselecting a misread/garbage row or editing a
 * value did nothing, because the host only refetched the (already-saved)
 * authoritative data on confirm. planExtractionReview turns the user's review
 * into the deltas needed to make it real:
 *   - rows the user DESELECTED  -> delete (they were auto-saved)
 *   - rows the user EDITED       -> update (value/name/unit)
 * Pure — the caller applies the plan via the biomarkers API.
 */
export interface ExtractionReviewPlan {
  deselectedIds: string[];
  edits: { id: string; data: { name: string; value: number; unit: string } }[];
}

export function planExtractionReview(
  extracted: { id: string }[],
  selected: ExtractedBiomarkerPreview[]
): ExtractionReviewPlan {
  const selectedIds = new Set(selected.map((s) => s.id));
  const deselectedIds = extracted.filter((b) => !selectedIds.has(b.id)).map((b) => b.id);
  const edits = selected
    .filter((s) => s.edited)
    .map((s) => ({ id: s.id, data: { name: s.name, value: s.value, unit: s.unit } }));
  return { deselectedIds, edits };
}
