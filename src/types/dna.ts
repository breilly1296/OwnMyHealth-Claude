export interface DNAVariant {
  id: string;
  rsid: string;
  chromosome: string;
  position: number;
  genotype: string;
  sourceFile: string;
  uploadDate: string;
  confidence?: number;
  rawLine?: string;
}

export interface DNAFileInfo {
  id: string;
  fileName: string;
  fileSize: number;
  source: 'AncestryDNA' | '23andMe' | 'Unknown';
  uploadDate: string;
  processingStatus: 'pending' | 'processing' | 'completed' | 'failed';
  totalVariants: number;
  validVariants: number;
  errors: string[];
  warnings: string[];
}

export interface DNAParsingResult {
  success: boolean;
  fileInfo: DNAFileInfo;
  variants: DNAVariant[];
  errors: string[];
  warnings: string[];
  processingTime: number;
  metadata: DNAFileMetadata;
}

export interface DNAFileMetadata {
  format: 'txt' | 'csv';
  hasHeader: boolean;
  delimiter: string;
  totalLines: number;
  skippedLines: number;
  chromosomeCount: Record<string, number>;
  genotypeDistribution: Record<string, number>;
}

export interface DNAUploadProgress {
  stage: 'uploading' | 'parsing' | 'validating' | 'storing' | 'completed';
  progress: number;
  message: string;
  currentLine?: number;
  totalLines?: number;
}