/**
 * Biomarker Extraction Functions
 *
 * Contains functions for extracting biomarkers from OCR text using multiple
 * strategies: line-by-line analysis, newline-spanning patterns, and regex patterns.
 *
 * @module services/biomarkerExtractor
 */

import { ALL_BIOMARKERS, type ExtractedBiomarker } from './biomarkerPatterns.js';
import { logger } from '../utils/logger.js';

const log = logger.createServiceLogger('BiomarkerExtractor');

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

  log.debug('After name text', { text: afterName.substring(0, 80) });

  if (isEducationalText(afterName)) {
    log.debug('Skipping educational text');
    return null;
  }

  // Pattern 1: Whitespace, then number (possibly with decimal), optionally H/L flag
  const resultMatch = afterName.match(/^\s*(\d+\.?\d*)\s*([HL])?\s/i);
  if (resultMatch) {
    const value = parseFloat(resultMatch[1]);
    log.debug('Pattern 1 matched', { value, flag: resultMatch[2] || 'none' });
    if (!isNaN(value) && value >= 0 && value < 100000) {
      return { value, rawMatch: line };
    }
  }

  // Pattern 2: Whitespace, number followed by unit
  const unitMatch = afterName.match(/^\s*(\d+\.?\d*)\s*(?:mg|g|%|K\/uL|M\/uL|mL|uL|fL|pg|ng|IU|U|mmol|umol|mEq|ratio)/i);
  if (unitMatch) {
    const value = parseFloat(unitMatch[1]);
    log.debug('Pattern 2 matched', { value });
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
      log.debug('Pattern 3 matched', { value });
      if (!isNaN(value) && value >= 0 && value < 100000) {
        return { value, rawMatch: line };
      }
    }
  }

  log.debug('No value pattern matched', { text: afterName.substring(0, 50) });
  return null;
}

/**
 * Check if a line looks like a result row (vs educational/header text)
 */
function looksLikeResultRow(line: string): boolean {
  if (line.length > 200) {
    log.debug('Skipping long line', { length: line.length });
    return false;
  }

  if (line.length < 10) return false;

  if (isEducationalText(line)) {
    log.debug('Skipping educational line');
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
    log.debug('Skipping non-result line');
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

  log.debug('Starting pattern-based extraction');

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

      log.debug('Pattern candidate', { name: biomarker.name, value });

      const contextStart = Math.max(0, match.index - 100);
      const contextEnd = Math.min(text.length, match.index + match[0].length + 100);
      const context = text.substring(contextStart, contextEnd);

      if (isEducationalText(context)) {
        log.debug('Skipping educational context', { name: biomarker.name });
        continue;
      }

      const textBeforeValue = text.substring(Math.max(0, match.index), match.index + match[0].indexOf(rawValue));
      if (isReferenceRangeContext(textBeforeValue)) {
        log.debug('Skipping reference range context', { name: biomarker.name });
        continue;
      }

      const afterMatch = text.substring(match.index + match[0].length, match.index + match[0].length + 50);
      const beforeMatch = text.substring(Math.max(0, match.index - 30), match.index);

      const rangePatternBefore = /[-–]\s*$/;
      const rangePatternAfter = /^\s*[-–]\s*\d/;
      if (rangePatternBefore.test(beforeMatch) || rangePatternAfter.test(afterMatch)) {
        log.debug('Skipping range value', { name: biomarker.name, value });
        continue;
      }

      const range = biomarker.normalRange;
      if (value < range.min * 0.01 || value > range.max * 100) {
        log.debug('Value out of range', { name: biomarker.name, value, expected: `${range.min}-${range.max}` });
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

      log.debug('Pattern match found', { name: biomarker.name, value, unit: biomarker.defaultUnit });
      break;
    }
  }

  log.debug('Pattern extraction complete', { count: results.length });
  return results;
}

/**
 * Extract biomarkers using line-by-line analysis for tabular formats
 */
function extractFromLines(text: string): ExtractedBiomarker[] {
  const results: ExtractedBiomarker[] = [];
  const foundNames = new Set<string>();
  const lines = text.split('\n');

  log.debug('Processing lines', { lineCount: lines.length });

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

      log.debug('Found biomarker in line', { lineIndex: i, name: matchedName });

      let extractedValue: number | null = null;
      let rawMatch = line;
      let valueLineIndex = i;

      const sameLineExtraction = extractResultValue(line, matchedNameEnd);
      if (sameLineExtraction) {
        extractedValue = sameLineExtraction.value;
        rawMatch = sameLineExtraction.rawMatch;
        log.debug('Same-line extraction', { lineIndex: i, value: extractedValue });
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
              log.debug('Multi-line extraction', { lineIndex: i, name: matchedName, value: extractedValue, valueLineIndex });
              usedValueLines.add(valueLineIndex);
            } else {
              log.debug('Next line not a value', { lineIndex: i });
            }
          }
        }
      }

      if (extractedValue === null) {
        log.debug('No value extracted', { lineIndex: i, name: biomarker.name });
        continue;
      }

      const range = biomarker.normalRange;
      if (extractedValue < range.min * 0.01 || extractedValue > range.max * 100) {
        log.debug('Value out of range', { lineIndex: i, name: biomarker.name, value: extractedValue });
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

      log.debug('Line match found', { name: biomarker.name, value: extractedValue, unit: biomarker.defaultUnit });
      break;
    }
  }

  log.debug('Line analysis complete', { count: results.length });
  return results;
}

/**
 * Extract biomarkers using newline-spanning patterns
 */
function extractWithNewlineSpanning(text: string): ExtractedBiomarker[] {
  const results: ExtractedBiomarker[] = [];
  const foundNames = new Set<string>();

  log.debug('Starting newline-spanning extraction');

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
          log.debug('Skipping range indicator', { name: biomarker.name });
          continue;
        }
      }

      if (match) {
        const value = parseFloat(match[1]);

        if (isNaN(value) || value < 0 || value > 100000) continue;

        const range = biomarker.normalRange;
        if (value < range.min * 0.01 || value > range.max * 100) {
          log.debug('Value out of range', { name: biomarker.name, value, expected: `${range.min}-${range.max}` });
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

        log.debug('Newline-span match', { name: biomarker.name, value, unit: biomarker.defaultUnit });
        break;
      }
    }
  }

  log.debug('Newline-span extraction complete', { count: results.length });
  return results;
}

// ============================================
// MAIN EXTRACTION FUNCTION
// ============================================

/**
 * Hybrid extraction: Try multiple strategies and merge results
 */
export function extractBiomarkersFromText(text: string): ExtractedBiomarker[] {
  log.debug('Starting hybrid biomarker extraction', { textLength: text.length });

  // Strategy 1: Line-by-line extraction (for properly formatted tables)
  const lineResults = extractFromLines(text);
  log.debug('Line extraction results', { count: lineResults.length, results: lineResults.map(r => `${r.name}: ${r.value} ${r.unit}`) });

  // Strategy 2: Newline-spanning patterns (for Document AI split columns)
  const newlineSpanResults = extractWithNewlineSpanning(text);
  log.debug('Newline-span extraction results', { count: newlineSpanResults.length, results: newlineSpanResults.map(r => `${r.name}: ${r.value} ${r.unit}`) });

  // Strategy 3: Traditional regex patterns (fallback)
  const patternResults = extractWithPatterns(text);
  log.debug('Pattern extraction results', { count: patternResults.length, results: patternResults.map(r => `${r.name}: ${r.value} ${r.unit}`) });

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

  log.debug('Extraction complete', { totalCount: combined.length, results: combined.map(r => `${r.name}: ${r.value} ${r.unit} (${r.confidence})`) });

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
