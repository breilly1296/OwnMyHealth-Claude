// This file extends the main types.ts file with additional type definitions
// Import the main types
import { Biomarker, BiomarkerCategory, InsurancePlan } from '../types';

// Re-export the main types
export { Biomarker, BiomarkerCategory, InsurancePlan };

// Export DNA types
export type { DNAVariant, DNAFileInfo, DNAParsingResult, DNAFileMetadata, DNAUploadProgress } from './dna';