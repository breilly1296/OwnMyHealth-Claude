import type { DNAVariant, DNAFileInfo, DNAParsingResult, DNAFileMetadata, DNAUploadProgress } from '../types/dna';

// DNA file format patterns
const DNA_FILE_PATTERNS = {
  '23andMe': {
    header: /^#\s*(rsid|snp)/i,
    commentLine: /^#/,
    dataLine: /^(rs\d+|i\d+)\s+(\d+|X|Y|MT)\s+(\d+)\s+([ATCG-]{1,2}|--|\?\?)$/i,
    delimiter: '\t'
  },
  'AncestryDNA': {
    header: /^(rsid|snp)/i,
    commentLine: /^#/,
    dataLine: /^(rs\d+|i\d+)[,\t](\d+|X|Y|MT)[,\t](\d+)[,\t]([ATCG-]{1,2}|--|\?\?)$/i,
    delimiter: /[,\t]/
  }
};

// Valid chromosome values
const VALID_CHROMOSOMES = new Set([
  '1', '2', '3', '4', '5', '6', '7', '8', '9', '10',
  '11', '12', '13', '14', '15', '16', '17', '18', '19', '20',
  '21', '22', 'X', 'Y', 'MT', 'M'
]);

// Valid genotype patterns
const VALID_GENOTYPES = /^([ATCG-]{1,2}|--|\?\?|[ATCG][ATCG]|[ATCG]-|-[ATCG])$/i;

export class DNAFileParser {
  private progressCallback?: (progress: DNAUploadProgress) => void;

  constructor(progressCallback?: (progress: DNAUploadProgress) => void) {
    this.progressCallback = progressCallback;
  }

  async parseFile(file: File): Promise<DNAParsingResult> {
    const startTime = Date.now();
    
    try {
      this.updateProgress('uploading', 0, 'Reading file...');
      
      // Read file content
      const content = await this.readFileContent(file);
      const lines = content.split('\n').map(line => line.trim()).filter(line => line.length > 0);
      
      this.updateProgress('parsing', 10, 'Analyzing file format...');
      
      // Detect file format and source
      const { source, format, delimiter } = this.detectFileFormat(lines, file.name);
      
      this.updateProgress('parsing', 20, `Detected ${source} format`);
      
      // Parse metadata
      const metadata = this.extractMetadata(lines, format, delimiter);
      
      this.updateProgress('parsing', 30, 'Parsing genetic variants...');
      
      // Parse variants
      const { variants, errors, warnings } = await this.parseVariants(
        lines, 
        source, 
        delimiter, 
        file.name
      );
      
      this.updateProgress('validating', 80, 'Validating data...');
      
      // Create file info
      const fileInfo: DNAFileInfo = {
        id: crypto.randomUUID(),
        fileName: file.name,
        fileSize: file.size,
        source,
        uploadDate: new Date().toISOString(),
        processingStatus: variants.length > 0 ? 'completed' : 'failed',
        totalVariants: variants.length,
        validVariants: variants.filter(v => this.isValidVariant(v)).length,
        errors,
        warnings
      };
      
      this.updateProgress('completed', 100, `Parsed ${variants.length} variants successfully`);
      
      const processingTime = Date.now() - startTime;
      
      return {
        success: variants.length > 0,
        fileInfo,
        variants,
        errors,
        warnings,
        processingTime,
        metadata
      };
      
    } catch (error) {
      const processingTime = Date.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : 'Unknown parsing error';
      
      return {
        success: false,
        fileInfo: {
          id: crypto.randomUUID(),
          fileName: file.name,
          fileSize: file.size,
          source: 'Unknown',
          uploadDate: new Date().toISOString(),
          processingStatus: 'failed',
          totalVariants: 0,
          validVariants: 0,
          errors: [errorMessage],
          warnings: []
        },
        variants: [],
        errors: [errorMessage],
        warnings: [],
        processingTime,
        metadata: {
          format: 'txt',
          hasHeader: false,
          delimiter: '\t',
          totalLines: 0,
          skippedLines: 0,
          chromosomeCount: {},
          genotypeDistribution: {}
        }
      };
    }
  }

  private async readFileContent(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e) => resolve(e.target?.result as string);
      reader.onerror = () => reject(new Error('Failed to read file'));
      reader.readAsText(file);
    });
  }

  private detectFileFormat(lines: string[], fileName: string): {
    source: 'AncestryDNA' | '23andMe' | 'Unknown';
    format: 'txt' | 'csv';
    delimiter: string;
  } {
    const format = fileName.toLowerCase().endsWith('.csv') ? 'csv' : 'txt';
    
    // Check for 23andMe format (starts with # comments)
    const hasComments = lines.some(line => DNA_FILE_PATTERNS['23andMe'].commentLine.test(line));
    const hasTabDelimited = lines.some(line => line.includes('\t'));
    
    if (hasComments && hasTabDelimited) {
      return { source: '23andMe', format, delimiter: '\t' };
    }
    
    // Check for AncestryDNA format (CSV-like, may have header)
    const hasCommaDelimited = lines.some(line => line.includes(','));
    const hasRsidHeader = lines.some(line => DNA_FILE_PATTERNS.AncestryDNA.header.test(line));
    
    if (hasCommaDelimited || hasRsidHeader) {
      return { source: 'AncestryDNA', format, delimiter: ',' };
    }
    
    // Default detection based on delimiter
    if (hasTabDelimited) {
      return { source: '23andMe', format, delimiter: '\t' };
    } else if (hasCommaDelimited) {
      return { source: 'AncestryDNA', format, delimiter: ',' };
    }
    
    return { source: 'Unknown', format, delimiter: '\t' };
  }

  private extractMetadata(lines: string[], format: 'txt' | 'csv', delimiter: string): DNAFileMetadata {
    const metadata: DNAFileMetadata = {
      format,
      hasHeader: false,
      delimiter,
      totalLines: lines.length,
      skippedLines: 0,
      chromosomeCount: {},
      genotypeDistribution: {}
    };

    // Check for header
    const firstDataLine = lines.find(line => !line.startsWith('#') && line.trim().length > 0);
    if (firstDataLine) {
      metadata.hasHeader = /^(rsid|snp)/i.test(firstDataLine);
    }

    // Count skipped lines (comments and header)
    metadata.skippedLines = lines.filter(line => 
      line.startsWith('#') || (metadata.hasHeader && /^(rsid|snp)/i.test(line))
    ).length;

    return metadata;
  }

  private async parseVariants(
    lines: string[], 
    source: string, 
    delimiter: string, 
    fileName: string
  ): Promise<{
    variants: DNAVariant[];
    errors: string[];
    warnings: string[];
  }> {
    const variants: DNAVariant[] = [];
    const errors: string[] = [];
    const warnings: string[] = [];
    const chromosomeCount: Record<string, number> = {};
    const genotypeDistribution: Record<string, number> = {};

    let lineNumber = 0;
    let processedCount = 0;
    const totalDataLines = lines.filter(line => 
      !line.startsWith('#') && 
      !/^(rsid|snp)/i.test(line) && 
      line.trim().length > 0
    ).length;

    for (const line of lines) {
      lineNumber++;
      
      // Skip comments and headers
      if (line.startsWith('#') || /^(rsid|snp)/i.test(line)) {
        continue;
      }

      // Skip empty lines
      if (!line.trim()) {
        continue;
      }

      try {
        const variant = this.parseLine(line, delimiter, fileName, lineNumber);
        
        if (variant) {
          // Validate variant
          if (this.isValidVariant(variant)) {
            variants.push(variant);
            
            // Update statistics
            chromosomeCount[variant.chromosome] = (chromosomeCount[variant.chromosome] || 0) + 1;
            genotypeDistribution[variant.genotype] = (genotypeDistribution[variant.genotype] || 0) + 1;
          } else {
            warnings.push(`Line ${lineNumber}: Invalid variant data - ${line.substring(0, 50)}...`);
          }
        }
        
        processedCount++;
        
        // Update progress periodically
        if (processedCount % 1000 === 0) {
          const progress = 30 + (processedCount / totalDataLines) * 50;
          this.updateProgress('parsing', progress, `Processed ${processedCount} variants...`, processedCount, totalDataLines);
        }
        
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        errors.push(`Line ${lineNumber}: ${errorMessage}`);
        
        // Stop if too many errors
        if (errors.length > 100) {
          errors.push('Too many parsing errors. Stopping processing.');
          break;
        }
      }
    }

    return { variants, errors, warnings };
  }

  private parseLine(line: string, delimiter: string, fileName: string, lineNumber: number): DNAVariant | null {
    const parts = line.split(delimiter).map(part => part.trim());
    
    if (parts.length < 4) {
      throw new Error(`Insufficient columns (expected 4, got ${parts.length})`);
    }

    const [rsid, chromosome, position, genotype] = parts;

    // Validate rsID
    if (!rsid || (!rsid.startsWith('rs') && !rsid.startsWith('i'))) {
      throw new Error(`Invalid rsID format: ${rsid}`);
    }

    // Validate chromosome
    if (!VALID_CHROMOSOMES.has(chromosome.toUpperCase())) {
      throw new Error(`Invalid chromosome: ${chromosome}`);
    }

    // Validate position
    const pos = parseInt(position, 10);
    if (isNaN(pos) || pos < 1) {
      throw new Error(`Invalid position: ${position}`);
    }

    // Validate genotype
    if (!VALID_GENOTYPES.test(genotype)) {
      throw new Error(`Invalid genotype format: ${genotype}`);
    }

    return {
      id: crypto.randomUUID(),
      rsid: rsid.toLowerCase(),
      chromosome: chromosome.toUpperCase(),
      position: pos,
      genotype: genotype.toUpperCase(),
      sourceFile: fileName,
      uploadDate: new Date().toISOString(),
      confidence: this.calculateConfidence(rsid, chromosome, position, genotype),
      rawLine: line
    };
  }

  private isValidVariant(variant: DNAVariant): boolean {
    return (
      variant.rsid.length > 0 &&
      VALID_CHROMOSOMES.has(variant.chromosome) &&
      variant.position > 0 &&
      VALID_GENOTYPES.test(variant.genotype)
    );
  }

  private calculateConfidence(rsid: string, chromosome: string, position: string, genotype: string): number {
    let confidence = 0.8; // Base confidence

    // Higher confidence for standard rsIDs
    if (rsid.startsWith('rs') && /^\d+$/.test(rsid.substring(2))) {
      confidence += 0.1;
    }

    // Higher confidence for standard chromosomes
    if (/^\d+$/.test(chromosome) || ['X', 'Y', 'MT'].includes(chromosome)) {
      confidence += 0.05;
    }

    // Higher confidence for valid genotypes
    if (/^[ATCG]{2}$/.test(genotype)) {
      confidence += 0.05;
    }

    return Math.min(confidence, 1.0);
  }

  private updateProgress(stage: DNAUploadProgress['stage'], progress: number, message: string, currentLine?: number, totalLines?: number) {
    if (this.progressCallback) {
      this.progressCallback({
        stage,
        progress: Math.min(Math.max(progress, 0), 100),
        message,
        currentLine,
        totalLines
      });
    }
  }
}

// Utility functions for DNA data analysis
export function analyzeDNAData(variants: DNAVariant[]): {
  totalVariants: number;
  chromosomeDistribution: Record<string, number>;
  genotypeDistribution: Record<string, number>;
  qualityMetrics: {
    averageConfidence: number;
    validVariants: number;
    invalidVariants: number;
  };
} {
  const chromosomeDistribution: Record<string, number> = {};
  const genotypeDistribution: Record<string, number> = {};
  let totalConfidence = 0;
  let validCount = 0;

  variants.forEach(variant => {
    // Count by chromosome
    chromosomeDistribution[variant.chromosome] = (chromosomeDistribution[variant.chromosome] || 0) + 1;
    
    // Count by genotype
    genotypeDistribution[variant.genotype] = (genotypeDistribution[variant.genotype] || 0) + 1;
    
    // Calculate quality metrics
    if (variant.confidence) {
      totalConfidence += variant.confidence;
      validCount++;
    }
  });

  return {
    totalVariants: variants.length,
    chromosomeDistribution,
    genotypeDistribution,
    qualityMetrics: {
      averageConfidence: validCount > 0 ? totalConfidence / validCount : 0,
      validVariants: validCount,
      invalidVariants: variants.length - validCount
    }
  };
}

export function filterVariantsByChromosome(variants: DNAVariant[], chromosome: string): DNAVariant[] {
  return variants.filter(variant => variant.chromosome === chromosome.toUpperCase());
}

export function searchVariantsByRsid(variants: DNAVariant[], rsid: string): DNAVariant[] {
  const searchTerm = rsid.toLowerCase();
  return variants.filter(variant => variant.rsid.includes(searchTerm));
}

export function exportVariantsToCSV(variants: DNAVariant[]): string {
  const headers = ['rsid', 'chromosome', 'position', 'genotype', 'confidence', 'source_file'];
  const rows = variants.map(variant => [
    variant.rsid,
    variant.chromosome,
    variant.position.toString(),
    variant.genotype,
    variant.confidence?.toFixed(3) || '',
    variant.sourceFile
  ]);

  return [headers, ...rows].map(row => row.join(',')).join('\n');
}