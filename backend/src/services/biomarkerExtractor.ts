/**
 * Biomarker Extraction Functions
 *
 * Contains functions for extracting biomarkers from OCR text using multiple
 * strategies: line-by-line analysis, newline-spanning patterns, and regex patterns.
 *
 * @module services/biomarkerExtractor
 */

import { ALL_BIOMARKERS, type ExtractedBiomarker } from './biomarkerPatterns.js';

// ============================================
// EXTRACTION HELPER CONSTANTS
// ============================================

/**
 * Keywords that indicate educational/guidance text rather than actual results.
 * Lines containing these should be SKIPPED during extraction.
 */
const EDUCATIONAL_KEYWORDS = [
  'goal',
  'target',
  'desirable',
  'therapeutic',
  'considered',
  'prevention',
  'recommended',
  'optimal',
  'guideline',
  'suggests',
  'indicating',
  'associated with',
  'risk factor',
  'treatment',
  'treating to',
  'should be',
  'aim for',
  'ideally',
  'according to',
];

/**
 * Patterns that indicate a reference range value (NOT an actual result)
 * These appear BEFORE the number and indicate it's a range limit
 */
const REFERENCE_RANGE_INDICATORS = [
  /<\s*$/,           // "<" before number
  />\s*$/,           // ">" before number
  /<=\s*$/,          // "<=" before number
  />=\s*$/,          // ">=" before number
  /OR\s*=\s*$/i,     // "OR =" (Quest format for >= or <=)
  /range[:\s]*$/i,   // "range:" before number
  /desirable[:\s]*$/i, // "desirable:" before number
  /-\s*$/,           // "-" (part of a range like "70-100")
  /to\s*$/i,         // "to" (part of a range like "70 to 100")
];

// ============================================
// HELPER FUNCTIONS
// ============================================

/**
 * Check if text contains educational/guidance content
 */
function isEducationalText(text: string): boolean {
  const lowerText = text.toLowerCase();
  return EDUCATIONAL_KEYWORDS.some(keyword => lowerText.includes(keyword));
}

/**
 * Check if the context before the matched value indicates it's a reference range
 */
function isReferenceRangeContext(textBeforeValue: string): boolean {
  const trimmed = textBeforeValue.trim();
  return REFERENCE_RANGE_INDICATORS.some(pattern => pattern.test(trimmed));
}

/**
 * Extract the FIRST number that appears after a biomarker name in a result line.
 * Quest format: "BIOMARKER NAME    VALUE    Reference Range: <200 mg/dL"
 * We want VALUE, not the 200 from the reference range.
 */
function extractResultValue(line: string, biomarkerNameEndIndex: number): { value: number; rawMatch: string } | null {
  const afterName = line.substring(biomarkerNameEndIndex);

  console.log(`[EXTRACT_VALUE] After name: "${afterName.substring(0, 80)}..."`);

  if (isEducationalText(afterName)) {
    console.log(`[SKIP] Educational text detected: "${afterName.substring(0, 50)}..."`);
    return null;
  }

  // Pattern 1: Whitespace, then number (possibly with decimal), optionally H/L flag
  const resultMatch = afterName.match(/^\s*(\d+\.?\d*)\s*([HL])?\s/i);
  if (resultMatch) {
    const value = parseFloat(resultMatch[1]);
    console.log(`[EXTRACT_VALUE] Pattern 1 matched: value=${value}, flag=${resultMatch[2] || 'none'}`);
    if (!isNaN(value) && value >= 0 && value < 100000) {
      return { value, rawMatch: line };
    }
  }

  // Pattern 2: Whitespace, number followed by unit
  const unitMatch = afterName.match(/^\s*(\d+\.?\d*)\s*(?:mg|g|%|K\/uL|M\/uL|mL|uL|fL|pg|ng|IU|U|mmol|umol|mEq|ratio)/i);
  if (unitMatch) {
    const value = parseFloat(unitMatch[1]);
    console.log(`[EXTRACT_VALUE] Pattern 2 (with unit) matched: value=${value}`);
    if (!isNaN(value) && value >= 0 && value < 100000) {
      return { value, rawMatch: line };
    }
  }

  // Pattern 3: More lenient - any number after whitespace
  const lenientMatch = afterName.match(/^\s{2,}(\d+\.?\d*)(?:\s|$)/);
  if (lenientMatch) {
    const beforeNumber = afterName.substring(0, afterName.indexOf(lenientMatch[1]));
    if (!REFERENCE_RANGE_INDICATORS.some(pattern => pattern.test(beforeNumber))) {
      const value = parseFloat(lenientMatch[1]);
      console.log(`[EXTRACT_VALUE] Pattern 3 (lenient) matched: value=${value}`);
      if (!isNaN(value) && value >= 0 && value < 100000) {
        return { value, rawMatch: line };
      }
    }
  }

  console.log(`[EXTRACT_VALUE] No pattern matched for: "${afterName.substring(0, 50)}"`);
  return null;
}

/**
 * Check if a line looks like a result row (vs educational/header text)
 */
function looksLikeResultRow(line: string): boolean {
  if (line.length > 200) {
    console.log(`[SKIP_ROW] Line too long (${line.length} chars): "${line.substring(0, 50)}..."`);
    return false;
  }

  if (line.length < 10) return false;

  if (isEducationalText(line)) {
    console.log(`[SKIP_ROW] Educational text: "${line.substring(0, 50)}..."`);
    return false;
  }

  const skipStarters = [
    /^note[:\s]/i,
    /^comment[:\s]/i,
    /^interpretation/i,
    /^see\s/i,
    /^for\s/i,
    /^if\s/i,
    /^when\s/i,
    /^page\s/i,
    /^\d{1,2}\/\d{1,2}\/\d{2,4}/,
    /^\*/,
    /^\(/,
    /^reference/i,
    /^normal/i,
    /^range/i,
  ];

  if (skipStarters.some(pattern => pattern.test(line.trim()))) {
    console.log(`[SKIP_ROW] Non-result starter: "${line.substring(0, 50)}..."`);
    return false;
  }

  if (!/\d/.test(line)) return false;

  return true;
}

/**
 * Check if a line contains ONLY a numeric value (possibly with H/L flag)
 */
function isValueOnlyLine(line: string): { value: number; flag?: string } | null {
  const trimmed = line.trim();
  const match = trimmed.match(/^(\d+\.?\d*)\s*([HL])?\s*(%|mg\/dL|g\/dL|K\/uL|M\/uL|fL|pg|ng\/mL|mIU\/mL|mEq\/L|mmol\/L)?$/i);
  if (match) {
    const value = parseFloat(match[1]);
    if (!isNaN(value) && value >= 0 && value < 100000) {
      return { value, flag: match[2] };
    }
  }
  return null;
}

/**
 * Check if a line is primarily a biomarker name (with little or no trailing content)
 */
function isNameOnlyLine(line: string, nameEndIndex: number): boolean {
  const afterName = line.substring(nameEndIndex).trim();
  return afterName.length < 5 || /^[,;:\s]*$/.test(afterName);
}

// ============================================
// EXTRACTION STRATEGIES
// ============================================

/**
 * Extract biomarkers using regex patterns with improved filtering
 */
function extractWithPatterns(text: string): ExtractedBiomarker[] {
  const results: ExtractedBiomarker[] = [];
  const foundNames = new Set<string>();

  console.log('[PATTERN EXTRACTION] Starting pattern-based extraction');

  for (const biomarker of ALL_BIOMARKERS) {
    if (foundNames.has(biomarker.name)) continue;

    for (const pattern of biomarker.patterns) {
      const match = text.match(pattern);
      if (!match || match.index === undefined) continue;

      const rawValue = match[1]?.trim();
      if (!rawValue) continue;

      if (rawValue === 'POSITIVE' || rawValue === 'NEGATIVE') continue;

      const value = parseFloat(rawValue);
      if (isNaN(value)) continue;
      if (value < -100 || value > 100000) continue;

      console.log(`[PATTERN] Candidate for ${biomarker.name}: value=${value}, match="${match[0].substring(0, 60)}"`);

      const contextStart = Math.max(0, match.index - 100);
      const contextEnd = Math.min(text.length, match.index + match[0].length + 100);
      const context = text.substring(contextStart, contextEnd);

      if (isEducationalText(context)) {
        console.log(`[SKIP PATTERN] Educational context for ${biomarker.name}: "${match[0].substring(0, 50)}"`);
        continue;
      }

      const textBeforeValue = text.substring(Math.max(0, match.index), match.index + match[0].indexOf(rawValue));
      if (isReferenceRangeContext(textBeforeValue)) {
        console.log(`[SKIP PATTERN] Reference range context for ${biomarker.name}: "${match[0].substring(0, 50)}"`);
        continue;
      }

      const afterMatch = text.substring(match.index + match[0].length, match.index + match[0].length + 50);
      const beforeMatch = text.substring(Math.max(0, match.index - 30), match.index);

      const rangePatternBefore = /[-–]\s*$/;
      const rangePatternAfter = /^\s*[-–]\s*\d/;
      if (rangePatternBefore.test(beforeMatch) || rangePatternAfter.test(afterMatch)) {
        console.log(`[SKIP PATTERN] Value ${value} appears to be part of range for ${biomarker.name}`);
        continue;
      }

      const range = biomarker.normalRange;
      if (value < range.min * 0.01 || value > range.max * 100) {
        console.log(`[SKIP PATTERN] Value ${value} out of reasonable range for ${biomarker.name} (expected ${range.min}-${range.max})`);
        continue;
      }

      foundNames.add(biomarker.name);

      let confidence = 0.7;
      if (value >= biomarker.normalRange.min * 0.1 && value <= biomarker.normalRange.max * 10) {
        confidence += 0.1;
      }

      results.push({
        name: biomarker.name,
        value,
        unit: biomarker.defaultUnit,
        category: biomarker.category,
        normalRange: { ...biomarker.normalRange, source: 'Standard Reference Range' },
        confidence: Math.min(confidence, 1.0),
        rawMatch: match[0].substring(0, 100),
      });

      console.log(`[PATTERN MATCH] ${biomarker.name}: ${value} ${biomarker.defaultUnit}`);
      break;
    }
  }

  console.log(`[PATTERN EXTRACTION] Found ${results.length} biomarkers`);
  return results;
}

/**
 * Extract biomarkers using line-by-line analysis for tabular formats
 */
function extractFromLines(text: string): ExtractedBiomarker[] {
  const results: ExtractedBiomarker[] = [];
  const foundNames = new Set<string>();
  const lines = text.split('\n');

  console.log(`[LINE ANALYSIS] Processing ${lines.length} lines`);
  console.log('[LINE ANALYSIS] First 30 lines:');
  lines.slice(0, 30).forEach((line, i) => console.log(`  ${i}: "${line.substring(0, 80)}"`));

  const usedValueLines = new Set<number>();

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line || line.length < 2) continue;
    if (usedValueLines.has(i)) continue;
    if (line.length > 50 && !looksLikeResultRow(line)) continue;

    for (const biomarker of ALL_BIOMARKERS) {
      if (foundNames.has(biomarker.name)) continue;

      const namesToCheck = [biomarker.name, ...biomarker.aliases];
      let matchedName = '';
      let matchedNameEnd = -1;

      for (const name of namesToCheck) {
        const nameRegex = new RegExp(`\\b(${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})\\b`, 'i');
        const nameMatch = line.match(nameRegex);
        if (nameMatch && nameMatch.index !== undefined) {
          matchedName = name;
          matchedNameEnd = nameMatch.index + nameMatch[0].length;
          break;
        }
      }

      if (matchedNameEnd === -1) continue;

      console.log(`[LINE ${i}] Found biomarker "${matchedName}" in line: "${line}"`);

      let extractedValue: number | null = null;
      let rawMatch = line;
      let valueLineIndex = i;

      const sameLineExtraction = extractResultValue(line, matchedNameEnd);
      if (sameLineExtraction) {
        extractedValue = sameLineExtraction.value;
        rawMatch = sameLineExtraction.rawMatch;
        console.log(`[LINE ${i}] Same-line extraction: value=${extractedValue}`);
      }

      if (extractedValue === null && isNameOnlyLine(line, matchedNameEnd)) {
        const nextLineIndex = i + 1;
        if (nextLineIndex < lines.length && !usedValueLines.has(nextLineIndex)) {
          const nextLine = lines[nextLineIndex].trim();

          if (nextLine) {
            const valueResult = isValueOnlyLine(nextLine);
            if (valueResult) {
              extractedValue = valueResult.value;
              valueLineIndex = nextLineIndex;
              rawMatch = `${line} | ${nextLine}`;
              console.log(`[LINE ${i}] Multi-line: "${matchedName}" = ${extractedValue} (from line ${valueLineIndex})`);
              usedValueLines.add(valueLineIndex);
            } else {
              console.log(`[LINE ${i}] Next line not a value: "${nextLine.substring(0, 30)}"`);
            }
          }
        }
      }

      if (extractedValue === null) {
        console.log(`[LINE ${i}] No value extracted for ${biomarker.name}`);
        continue;
      }

      const range = biomarker.normalRange;
      if (extractedValue < range.min * 0.01 || extractedValue > range.max * 100) {
        console.log(`[LINE ${i}] Value ${extractedValue} out of range for ${biomarker.name} (expected ${range.min * 0.01}-${range.max * 100})`);
        continue;
      }

      foundNames.add(biomarker.name);

      results.push({
        name: biomarker.name,
        value: extractedValue,
        unit: biomarker.defaultUnit,
        category: biomarker.category,
        normalRange: { ...range, source: 'Standard Reference Range' },
        confidence: 0.85,
        rawMatch: rawMatch.substring(0, 150),
      });

      console.log(`[LINE MATCH] ${biomarker.name}: ${extractedValue} ${biomarker.defaultUnit} (lines ${i}-${valueLineIndex})`);
      break;
    }
  }

  console.log(`[LINE ANALYSIS] Found ${results.length} biomarkers`);
  return results;
}

/**
 * Extract biomarkers using newline-spanning patterns
 */
function extractWithNewlineSpanning(text: string): ExtractedBiomarker[] {
  const results: ExtractedBiomarker[] = [];
  const foundNames = new Set<string>();

  console.log('[NEWLINE-SPAN] Starting newline-spanning extraction');

  for (const biomarker of ALL_BIOMARKERS) {
    if (foundNames.has(biomarker.name)) continue;

    const namesToCheck = [biomarker.name, ...biomarker.aliases];

    for (const name of namesToCheck) {
      const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

      const pattern = new RegExp(
        `\\b${escapedName}\\b[\\s\\n]+(\\d+\\.?\\d*)(?:\\s*([HL]))?(?![\\s]*[-–][\\s]*\\d)`,
        'i'
      );

      const match = text.match(pattern);

      if (match && match.index !== undefined) {
        const beforeMatch = text.substring(Math.max(0, match.index - 5), match.index);
        if (/[<>–-]\s*$/.test(beforeMatch)) {
          console.log(`[NEWLINE-SPAN] Skipping ${biomarker.name}: preceded by range indicator`);
          continue;
        }
      }

      if (match) {
        const value = parseFloat(match[1]);

        if (isNaN(value) || value < 0 || value > 100000) continue;

        const range = biomarker.normalRange;
        if (value < range.min * 0.01 || value > range.max * 100) {
          console.log(`[NEWLINE-SPAN] Skipping ${biomarker.name}: ${value} out of range (${range.min}-${range.max})`);
          continue;
        }

        foundNames.add(biomarker.name);

        results.push({
          name: biomarker.name,
          value,
          unit: biomarker.defaultUnit,
          category: biomarker.category,
          normalRange: { ...range, source: 'Standard Reference Range' },
          confidence: 0.80,
          rawMatch: match[0].substring(0, 100),
        });

        console.log(`[NEWLINE-SPAN] ${biomarker.name}: ${value}${match[2] ? ' ' + match[2] : ''} ${biomarker.defaultUnit}`);
        break;
      }
    }
  }

  console.log(`[NEWLINE-SPAN] Found ${results.length} biomarkers`);
  return results;
}

// ============================================
// MAIN EXTRACTION FUNCTION
// ============================================

/**
 * Hybrid extraction: Try multiple strategies and merge results
 */
export function extractBiomarkersFromText(text: string): ExtractedBiomarker[] {
  console.log('[EXTRACTION] ========================================');
  console.log('[EXTRACTION] Starting hybrid biomarker extraction');
  console.log(`[EXTRACTION] Text length: ${text.length} chars`);
  console.log('[EXTRACTION] Text preview (first 500 chars):');
  console.log(text.substring(0, 500));
  console.log('[EXTRACTION] ========================================');

  // Strategy 1: Line-by-line extraction (for properly formatted tables)
  const lineResults = extractFromLines(text);
  console.log(`[EXTRACTION] Line extraction found: ${lineResults.length} biomarkers`);
  lineResults.forEach(r => console.log(`  - ${r.name}: ${r.value} ${r.unit}`));

  // Strategy 2: Newline-spanning patterns (for Document AI split columns)
  const newlineSpanResults = extractWithNewlineSpanning(text);
  console.log(`[EXTRACTION] Newline-span extraction found: ${newlineSpanResults.length} biomarkers`);
  newlineSpanResults.forEach(r => console.log(`  - ${r.name}: ${r.value} ${r.unit}`));

  // Strategy 3: Traditional regex patterns (fallback)
  const patternResults = extractWithPatterns(text);
  console.log(`[EXTRACTION] Pattern extraction found: ${patternResults.length} biomarkers`);
  patternResults.forEach(r => console.log(`  - ${r.name}: ${r.value} ${r.unit}`));

  // Merge results: line-based > newline-span > pattern-based
  const foundNames = new Set<string>();
  const combined: ExtractedBiomarker[] = [];

  for (const r of lineResults) {
    if (!foundNames.has(r.name)) {
      foundNames.add(r.name);
      combined.push(r);
    }
  }

  for (const r of newlineSpanResults) {
    if (!foundNames.has(r.name)) {
      foundNames.add(r.name);
      combined.push(r);
    }
  }

  for (const r of patternResults) {
    if (!foundNames.has(r.name)) {
      foundNames.add(r.name);
      combined.push(r);
    }
  }

  console.log('[EXTRACTION] ========================================');
  console.log(`[EXTRACTION] Total unique biomarkers: ${combined.length}`);
  combined.forEach(r => console.log(`  FINAL: ${r.name}: ${r.value} ${r.unit} (confidence: ${r.confidence})`));
  console.log('[EXTRACTION] ========================================');

  return combined;
}

/**
 * Validate extracted biomarker values
 */
export function validateBiomarkerValue(
  name: string,
  value: number,
  _unit: string
): { valid: boolean; reason?: string } {
  const biomarker = ALL_BIOMARKERS.find(
    (b) => b.name === name || b.aliases.some((a) => a.toLowerCase() === name.toLowerCase())
  );

  if (!biomarker) {
    return { valid: true };
  }

  const range = biomarker.normalRange;
  if (value < range.min * 0.01 || value > range.max * 100) {
    return {
      valid: false,
      reason: `Value ${value} is outside reasonable range for ${name}`,
    };
  }

  return { valid: true };
}
