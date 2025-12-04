/**
 * DNA Parser Service
 *
 * Parses 23andMe and AncestryDNA raw data files with streaming support
 * for handling large files efficiently. Implements trait analysis for
 * common health-related SNPs.
 */

import { Readable } from 'stream';
import { createInterface } from 'readline';
import { BadRequestError } from '../middleware/errorHandler.js';
import { dnaLogger } from '../utils/logger.js';

// ============================================
// Types
// ============================================

export interface ParsedVariant {
  rsid: string;
  chromosome: string;
  position: number;
  genotype: string;
  confidence: number;
}

export interface DNAParsingResult {
  success: boolean;
  source: '23andMe' | 'AncestryDNA' | 'Unknown';
  variants: ParsedVariant[];
  totalLines: number;
  validVariants: number;
  invalidLines: number;
  errors: string[];
  warnings: string[];
  processingTimeMs: number;
}

export interface GeneticTraitResult {
  traitName: string;
  gene: string;
  category: string;
  rsid: string;
  genotype: string;
  riskLevel: 'HIGH' | 'MODERATE' | 'LOW' | 'PROTECTIVE' | 'UNKNOWN';
  description: string;
  recommendations: string;
  confidence: number;
  citationCount: number;
}

export type DNASource = '23andMe' | 'AncestryDNA' | 'Unknown';

// ============================================
// File Format Detection
// ============================================

const FILE_FORMAT_PATTERNS = {
  '23andMe': {
    // 23andMe files start with # comments and use tab delimiter
    headerPattern: /^#\s*(rsid|snp)/i,
    commentPattern: /^#/,
    dataPattern: /^(rs\d+|i\d+)\t(\d+|X|Y|MT)\t(\d+)\t([ATCGDI-]{1,2}|--|\?\?)$/i,
    delimiter: '\t',
  },
  'AncestryDNA': {
    // AncestryDNA files may have header row without # and use comma or tab
    headerPattern: /^(rsid|snp)/i,
    commentPattern: /^#/,
    dataPattern: /^(rs\d+|i\d+)[,\t](\d+|X|Y|MT)[,\t](\d+)[,\t]([ATCGDI-]{1,2}|--|\?\?)$/i,
    delimiter: /[,\t]/,
  },
};

const VALID_CHROMOSOMES = new Set([
  '1', '2', '3', '4', '5', '6', '7', '8', '9', '10',
  '11', '12', '13', '14', '15', '16', '17', '18', '19', '20',
  '21', '22', 'X', 'Y', 'MT', 'M',
]);

const VALID_GENOTYPE_PATTERN = /^[ATCGDI-]{1,2}$|^--$|^\?\?$/i;

// ============================================
// Logging
// ============================================

function logParsing(message: string, data?: Record<string, unknown>): void {
  dnaLogger.info(message, data);
}

// ============================================
// SNP Database - Health-Related Variants
// ============================================

interface SNPDefinition {
  gene: string;
  traitName: string;
  category: string;
  genotypes: Record<string, {
    riskLevel: 'HIGH' | 'MODERATE' | 'LOW' | 'PROTECTIVE' | 'UNKNOWN';
    description: string;
    recommendations: string;
    citations: number;
  }>;
}

/**
 * Comprehensive database of health-related SNPs
 * Includes 25+ well-studied genetic variants
 */
const SNP_DATABASE: Record<string, SNPDefinition> = {
  // ============================================
  // Cardiovascular & Metabolic
  // ============================================

  // APOE - Alzheimer's and cardiovascular risk
  'rs429358': {
    gene: 'APOE',
    traitName: 'APOE E4 Variant',
    category: 'disease_risk',
    genotypes: {
      'CC': {
        riskLevel: 'HIGH',
        description: 'APOE E4/E4 genotype associated with significantly increased risk for Alzheimer\'s disease (up to 12x) and cardiovascular issues.',
        recommendations: 'Annual cognitive assessments, cardiovascular screening, Mediterranean diet, regular exercise, quality sleep.',
        citations: 15,
      },
      'CT': {
        riskLevel: 'MODERATE',
        description: 'APOE E3/E4 genotype associated with moderately increased risk for Alzheimer\'s disease (about 3x higher).',
        recommendations: 'Cognitive health monitoring every 2 years, lipid panel, brain-healthy lifestyle.',
        citations: 15,
      },
      'TT': {
        riskLevel: 'LOW',
        description: 'APOE E3/E3 or E2/E3 genotype with typical population risk for Alzheimer\'s disease.',
        recommendations: 'Standard preventive care.',
        citations: 10,
      },
    },
  },

  // APOE rs7412 - Part of APOE haplotype
  'rs7412': {
    gene: 'APOE',
    traitName: 'APOE E2 Variant',
    category: 'disease_risk',
    genotypes: {
      'TT': {
        riskLevel: 'PROTECTIVE',
        description: 'APOE E2/E2 genotype may provide protection against Alzheimer\'s disease.',
        recommendations: 'Continue healthy lifestyle practices.',
        citations: 12,
      },
      'CT': {
        riskLevel: 'LOW',
        description: 'One copy of protective E2 variant may reduce Alzheimer\'s risk.',
        recommendations: 'Standard preventive care.',
        citations: 10,
      },
      'CC': {
        riskLevel: 'LOW',
        description: 'No E2 protective variant present.',
        recommendations: 'Standard preventive care.',
        citations: 8,
      },
    },
  },

  // MTHFR - Folate metabolism
  'rs1801133': {
    gene: 'MTHFR',
    traitName: 'MTHFR C677T',
    category: 'metabolism',
    genotypes: {
      'TT': {
        riskLevel: 'MODERATE',
        description: 'MTHFR TT genotype results in ~70% reduced enzyme activity, affecting folate metabolism and homocysteine levels.',
        recommendations: 'Homocysteine testing, consider methylfolate supplements, folate-rich foods, limit alcohol.',
        citations: 20,
      },
      'CT': {
        riskLevel: 'LOW',
        description: 'MTHFR CT genotype with ~30% reduced enzyme activity. Mild effects on folate metabolism.',
        recommendations: 'Periodic homocysteine testing, balanced diet with folate.',
        citations: 15,
      },
      'CC': {
        riskLevel: 'LOW',
        description: 'Normal MTHFR enzyme activity for folate metabolism.',
        recommendations: 'Standard folate intake through diet.',
        citations: 10,
      },
    },
  },

  // MTHFR A1298C
  'rs1801131': {
    gene: 'MTHFR',
    traitName: 'MTHFR A1298C',
    category: 'metabolism',
    genotypes: {
      'CC': {
        riskLevel: 'MODERATE',
        description: 'MTHFR A1298C CC genotype may reduce enzyme activity, particularly when combined with C677T variant.',
        recommendations: 'Consider combined MTHFR status, folate-rich diet, potential methylfolate supplementation.',
        citations: 12,
      },
      'AC': {
        riskLevel: 'LOW',
        description: 'Heterozygous for A1298C with minimal impact on enzyme function.',
        recommendations: 'Standard folate intake.',
        citations: 8,
      },
      'AA': {
        riskLevel: 'LOW',
        description: 'Normal MTHFR A1298 position.',
        recommendations: 'Standard preventive care.',
        citations: 6,
      },
    },
  },

  // Factor V Leiden - Blood clotting
  'rs6025': {
    gene: 'F5',
    traitName: 'Factor V Leiden',
    category: 'disease_risk',
    genotypes: {
      'AA': {
        riskLevel: 'HIGH',
        description: 'Homozygous Factor V Leiden with significantly increased risk (50-80x) for venous thromboembolism.',
        recommendations: 'Hematology consultation, anticoagulation consideration for surgeries/travel, avoid oral contraceptives.',
        citations: 25,
      },
      'AG': {
        riskLevel: 'MODERATE',
        description: 'Heterozygous Factor V Leiden with moderately increased risk (5-10x) for blood clots.',
        recommendations: 'Inform surgeons before procedures, compression during long travel, careful contraceptive choices.',
        citations: 20,
      },
      'GG': {
        riskLevel: 'LOW',
        description: 'No Factor V Leiden mutation. Normal blood clotting risk.',
        recommendations: 'Standard preventive care.',
        citations: 10,
      },
    },
  },

  // Prothrombin G20210A - Blood clotting
  'rs1799963': {
    gene: 'F2',
    traitName: 'Prothrombin G20210A',
    category: 'disease_risk',
    genotypes: {
      'AA': {
        riskLevel: 'HIGH',
        description: 'Homozygous prothrombin mutation with significantly increased venous thrombosis risk.',
        recommendations: 'Hematology consultation, anticoagulation management, avoid estrogen-containing medications.',
        citations: 18,
      },
      'AG': {
        riskLevel: 'MODERATE',
        description: 'Heterozygous prothrombin mutation with moderately increased clotting risk (2-3x).',
        recommendations: 'Inform healthcare providers, compression during travel, monitor during pregnancy.',
        citations: 15,
      },
      'GG': {
        riskLevel: 'LOW',
        description: 'No prothrombin mutation. Normal clotting risk.',
        recommendations: 'Standard preventive care.',
        citations: 8,
      },
    },
  },

  // HFE - Iron metabolism (Hemochromatosis)
  'rs1800562': {
    gene: 'HFE',
    traitName: 'HFE C282Y',
    category: 'disease_risk',
    genotypes: {
      'AA': {
        riskLevel: 'HIGH',
        description: 'Homozygous HFE C282Y with high risk (70-90%) for hereditary hemochromatosis and iron overload.',
        recommendations: 'Serum ferritin/transferrin saturation every 6 months, hepatology consult, avoid iron supplements, regular blood donation.',
        citations: 22,
      },
      'AG': {
        riskLevel: 'LOW',
        description: 'Carrier for hereditary hemochromatosis. Minimal personal risk but may pass to children.',
        recommendations: 'Periodic iron studies, genetic counseling if planning family.',
        citations: 15,
      },
      'GG': {
        riskLevel: 'LOW',
        description: 'No HFE C282Y mutation. Normal iron metabolism.',
        recommendations: 'Standard preventive care.',
        citations: 8,
      },
    },
  },

  // HFE H63D
  'rs1799945': {
    gene: 'HFE',
    traitName: 'HFE H63D',
    category: 'carrier_status',
    genotypes: {
      'GG': {
        riskLevel: 'MODERATE',
        description: 'Homozygous H63D variant may mildly increase iron absorption. Higher risk if combined with C282Y.',
        recommendations: 'Monitor iron levels periodically.',
        citations: 10,
      },
      'CG': {
        riskLevel: 'LOW',
        description: 'Carrier for H63D variant with minimal clinical significance alone.',
        recommendations: 'Standard preventive care.',
        citations: 8,
      },
      'CC': {
        riskLevel: 'LOW',
        description: 'No H63D variant.',
        recommendations: 'Standard preventive care.',
        citations: 5,
      },
    },
  },

  // ============================================
  // Drug Response (Pharmacogenomics)
  // ============================================

  // CYP2C19 - Clopidogrel/Plavix metabolism
  'rs4244285': {
    gene: 'CYP2C19',
    traitName: 'CYP2C19*2',
    category: 'drug_response',
    genotypes: {
      'AA': {
        riskLevel: 'HIGH',
        description: 'CYP2C19 poor metabolizer. Significantly reduced ability to activate clopidogrel (Plavix).',
        recommendations: 'Pharmacogenetic consultation, alternative antiplatelet agents (prasugrel, ticagrelor) may be needed.',
        citations: 30,
      },
      'AG': {
        riskLevel: 'MODERATE',
        description: 'CYP2C19 intermediate metabolizer. Reduced clopidogrel activation.',
        recommendations: 'Discuss alternatives with cardiologist if clopidogrel prescribed.',
        citations: 25,
      },
      'GG': {
        riskLevel: 'LOW',
        description: 'CYP2C19 normal metabolizer. Standard drug metabolism.',
        recommendations: 'Standard medication protocols.',
        citations: 15,
      },
    },
  },

  // CYP2C9 - Warfarin metabolism
  'rs1799853': {
    gene: 'CYP2C9',
    traitName: 'CYP2C9*2',
    category: 'drug_response',
    genotypes: {
      'TT': {
        riskLevel: 'HIGH',
        description: 'CYP2C9*2/*2 with significantly reduced warfarin metabolism. Higher bleeding risk.',
        recommendations: 'Lower warfarin doses typically needed, more frequent INR monitoring, consider direct oral anticoagulants.',
        citations: 28,
      },
      'CT': {
        riskLevel: 'MODERATE',
        description: 'CYP2C9*1/*2 with reduced warfarin metabolism. May need dose adjustments.',
        recommendations: 'Careful warfarin titration, regular INR monitoring.',
        citations: 22,
      },
      'CC': {
        riskLevel: 'LOW',
        description: 'Normal CYP2C9 warfarin metabolism.',
        recommendations: 'Standard warfarin dosing protocols.',
        citations: 12,
      },
    },
  },

  // VKORC1 - Warfarin sensitivity
  'rs9923231': {
    gene: 'VKORC1',
    traitName: 'VKORC1 Warfarin Sensitivity',
    category: 'drug_response',
    genotypes: {
      'TT': {
        riskLevel: 'HIGH',
        description: 'VKORC1 TT associated with high warfarin sensitivity. Much lower doses typically needed.',
        recommendations: 'Start with very low warfarin doses (1-2mg), frequent INR monitoring.',
        citations: 25,
      },
      'CT': {
        riskLevel: 'MODERATE',
        description: 'Intermediate warfarin sensitivity. May need moderate dose reductions.',
        recommendations: 'Careful dose titration with INR monitoring.',
        citations: 20,
      },
      'CC': {
        riskLevel: 'LOW',
        description: 'Standard warfarin sensitivity requiring typical doses.',
        recommendations: 'Standard warfarin dosing protocols.',
        citations: 12,
      },
    },
  },

  // SLCO1B1 - Statin myopathy
  'rs4149056': {
    gene: 'SLCO1B1',
    traitName: 'SLCO1B1 Statin Response',
    category: 'drug_response',
    genotypes: {
      'CC': {
        riskLevel: 'HIGH',
        description: 'SLCO1B1 CC with ~17x increased risk of statin-induced myopathy, especially with simvastatin.',
        recommendations: 'Avoid high-dose simvastatin, consider alternative statins (pravastatin, rosuvastatin), monitor for muscle symptoms.',
        citations: 22,
      },
      'CT': {
        riskLevel: 'MODERATE',
        description: 'SLCO1B1 CT with ~4.5x increased statin myopathy risk.',
        recommendations: 'Use lower statin doses, monitor for muscle pain, consider CoQ10.',
        citations: 18,
      },
      'TT': {
        riskLevel: 'LOW',
        description: 'Normal SLCO1B1 function. Typical statin tolerance expected.',
        recommendations: 'Standard statin monitoring.',
        citations: 10,
      },
    },
  },

  // CYP2D6 - Many drug metabolizer
  'rs3892097': {
    gene: 'CYP2D6',
    traitName: 'CYP2D6*4',
    category: 'drug_response',
    genotypes: {
      'AA': {
        riskLevel: 'HIGH',
        description: 'CYP2D6 poor metabolizer. Reduced metabolism of codeine, tamoxifen, many antidepressants, and beta-blockers.',
        recommendations: 'Pharmacogenetic consultation, alternative pain medications to codeine, consider aromatase inhibitors over tamoxifen.',
        citations: 35,
      },
      'AG': {
        riskLevel: 'MODERATE',
        description: 'CYP2D6 intermediate metabolizer. Partially reduced drug metabolism.',
        recommendations: 'May need dose adjustments for affected medications.',
        citations: 28,
      },
      'GG': {
        riskLevel: 'LOW',
        description: 'Normal CYP2D6 metabolism.',
        recommendations: 'Standard medication dosing.',
        citations: 15,
      },
    },
  },

  // ============================================
  // Wellness & Traits
  // ============================================

  // FTO - Obesity risk
  'rs9939609': {
    gene: 'FTO',
    traitName: 'FTO Obesity Risk',
    category: 'wellness',
    genotypes: {
      'AA': {
        riskLevel: 'MODERATE',
        description: 'FTO AA associated with ~1.7x higher obesity risk and ~3-4kg higher body weight on average.',
        recommendations: 'Higher protein diet, regular exercise (particularly important), mindful eating, adequate sleep.',
        citations: 45,
      },
      'AT': {
        riskLevel: 'LOW',
        description: 'FTO AT with ~1.3x increased obesity risk and ~1.5-2kg higher weight.',
        recommendations: 'Balanced diet and regular physical activity.',
        citations: 35,
      },
      'TT': {
        riskLevel: 'LOW',
        description: 'FTO TT with typical obesity risk.',
        recommendations: 'Standard healthy lifestyle recommendations.',
        citations: 25,
      },
    },
  },

  // MC4R - Appetite regulation
  'rs17782313': {
    gene: 'MC4R',
    traitName: 'MC4R Appetite Regulation',
    category: 'wellness',
    genotypes: {
      'CC': {
        riskLevel: 'MODERATE',
        description: 'MC4R CC associated with increased appetite, higher caloric intake, and obesity risk.',
        recommendations: 'Portion control strategies, high-fiber foods for satiety, regular meal timing.',
        citations: 20,
      },
      'CT': {
        riskLevel: 'LOW',
        description: 'MC4R CT with slightly increased appetite-related obesity risk.',
        recommendations: 'Mindful eating practices.',
        citations: 15,
      },
      'TT': {
        riskLevel: 'LOW',
        description: 'Normal MC4R appetite regulation.',
        recommendations: 'Standard dietary recommendations.',
        citations: 10,
      },
    },
  },

  // TCF7L2 - Type 2 Diabetes risk
  'rs7903146': {
    gene: 'TCF7L2',
    traitName: 'TCF7L2 Diabetes Risk',
    category: 'disease_risk',
    genotypes: {
      'TT': {
        riskLevel: 'HIGH',
        description: 'TCF7L2 TT with significantly increased Type 2 Diabetes risk (1.8x). Affects insulin secretion.',
        recommendations: 'Regular glucose/HbA1c monitoring, weight management, low glycemic diet, exercise.',
        citations: 50,
      },
      'CT': {
        riskLevel: 'MODERATE',
        description: 'TCF7L2 CT with moderately increased Type 2 Diabetes risk (1.4x).',
        recommendations: 'Periodic glucose screening, healthy weight maintenance.',
        citations: 40,
      },
      'CC': {
        riskLevel: 'LOW',
        description: 'TCF7L2 CC with typical Type 2 Diabetes risk.',
        recommendations: 'Standard preventive care.',
        citations: 25,
      },
    },
  },

  // VDR - Vitamin D metabolism
  'rs1544410': {
    gene: 'VDR',
    traitName: 'VDR Vitamin D Metabolism',
    category: 'metabolism',
    genotypes: {
      'AA': {
        riskLevel: 'MODERATE',
        description: 'VDR AA may be associated with decreased bone mineral density and altered vitamin D metabolism.',
        recommendations: 'Vitamin D level testing, DEXA scan, weight-bearing exercise, adequate calcium.',
        citations: 18,
      },
      'AG': {
        riskLevel: 'LOW',
        description: 'VDR AG with slightly altered vitamin D metabolism.',
        recommendations: 'Ensure adequate vitamin D intake.',
        citations: 12,
      },
      'GG': {
        riskLevel: 'LOW',
        description: 'Normal VDR vitamin D metabolism.',
        recommendations: 'Standard vitamin D recommendations.',
        citations: 8,
      },
    },
  },

  // COMT - Dopamine metabolism
  'rs4680': {
    gene: 'COMT',
    traitName: 'COMT Dopamine Metabolism',
    category: 'traits',
    genotypes: {
      'AA': {
        riskLevel: 'LOW',
        description: 'COMT Met/Met with slower dopamine breakdown. Associated with better working memory but higher stress sensitivity.',
        recommendations: 'Stress management practices, mindfulness, adequate sleep, limit caffeine.',
        citations: 25,
      },
      'AG': {
        riskLevel: 'LOW',
        description: 'COMT Val/Met with balanced dopamine metabolism.',
        recommendations: 'Standard stress management.',
        citations: 18,
      },
      'GG': {
        riskLevel: 'LOW',
        description: 'COMT Val/Val with faster dopamine breakdown. Better stress resilience but may affect focus.',
        recommendations: 'Cognitive training, regular exercise for dopamine.',
        citations: 20,
      },
    },
  },

  // BDNF - Neuroplasticity
  'rs6265': {
    gene: 'BDNF',
    traitName: 'BDNF Brain Health',
    category: 'traits',
    genotypes: {
      'TT': {
        riskLevel: 'MODERATE',
        description: 'BDNF Met/Met with reduced neuroplasticity and BDNF secretion. May affect memory and stress response.',
        recommendations: 'Regular aerobic exercise (crucial for BDNF), cognitive stimulation, omega-3s, quality sleep.',
        citations: 22,
      },
      'CT': {
        riskLevel: 'LOW',
        description: 'BDNF Val/Met with intermediate neuroplasticity.',
        recommendations: 'Regular exercise and cognitive engagement.',
        citations: 15,
      },
      'CC': {
        riskLevel: 'LOW',
        description: 'BDNF Val/Val with normal neuroplasticity and brain health.',
        recommendations: 'Standard brain health recommendations.',
        citations: 10,
      },
    },
  },

  // LCT - Lactose tolerance
  'rs4988235': {
    gene: 'LCT',
    traitName: 'Lactose Tolerance',
    category: 'traits',
    genotypes: {
      'AA': {
        riskLevel: 'LOW',
        description: 'Lactase persistence - ability to digest lactose throughout life.',
        recommendations: 'No dietary restrictions for dairy products.',
        citations: 15,
      },
      'AG': {
        riskLevel: 'LOW',
        description: 'Likely lactose tolerant with one persistence allele.',
        recommendations: 'Monitor for any dairy sensitivity.',
        citations: 12,
      },
      'GG': {
        riskLevel: 'LOW',
        description: 'Likely lactose intolerant. Lactase production decreases after childhood.',
        recommendations: 'Consider lactose-free dairy or lactase supplements, calcium from other sources.',
        citations: 15,
      },
    },
  },

  // ALDH2 - Alcohol metabolism
  'rs671': {
    gene: 'ALDH2',
    traitName: 'ALDH2 Alcohol Metabolism',
    category: 'metabolism',
    genotypes: {
      'AA': {
        riskLevel: 'MODERATE',
        description: 'ALDH2*2/*2 with severely reduced alcohol metabolism. "Asian flush" reaction, increased esophageal cancer risk with alcohol.',
        recommendations: 'Avoid alcohol consumption, increased cancer screening if alcohol history.',
        citations: 28,
      },
      'AG': {
        riskLevel: 'LOW',
        description: 'ALDH2*1/*2 with reduced alcohol metabolism. May experience flushing, increased cancer risk with heavy drinking.',
        recommendations: 'Limit alcohol consumption.',
        citations: 22,
      },
      'GG': {
        riskLevel: 'LOW',
        description: 'Normal ALDH2 alcohol metabolism.',
        recommendations: 'Standard alcohol guidelines (moderation).',
        citations: 12,
      },
    },
  },

  // CYP1A2 - Caffeine metabolism
  'rs762551': {
    gene: 'CYP1A2',
    traitName: 'CYP1A2 Caffeine Metabolism',
    category: 'metabolism',
    genotypes: {
      'AA': {
        riskLevel: 'LOW',
        description: 'CYP1A2 fast caffeine metabolizer. Can process caffeine quickly.',
        recommendations: 'Standard caffeine consumption is generally well-tolerated.',
        citations: 15,
      },
      'AC': {
        riskLevel: 'LOW',
        description: 'CYP1A2 intermediate caffeine metabolizer.',
        recommendations: 'Moderate caffeine intake.',
        citations: 12,
      },
      'CC': {
        riskLevel: 'LOW',
        description: 'CYP1A2 slow caffeine metabolizer. Caffeine stays in system longer, may affect sleep and increase anxiety.',
        recommendations: 'Limit caffeine, avoid afternoon consumption, may increase cardiovascular risk with high intake.',
        citations: 18,
      },
    },
  },

  // ACTN3 - Athletic performance
  'rs1815739': {
    gene: 'ACTN3',
    traitName: 'ACTN3 Muscle Type',
    category: 'traits',
    genotypes: {
      'CC': {
        riskLevel: 'LOW',
        description: 'ACTN3 RR genotype with functional alpha-actinin-3. Favors power/sprint activities.',
        recommendations: 'May excel at explosive sports, include strength training.',
        citations: 20,
      },
      'CT': {
        riskLevel: 'LOW',
        description: 'ACTN3 RX genotype with mixed muscle fiber characteristics.',
        recommendations: 'Balanced training approach for various sports.',
        citations: 15,
      },
      'TT': {
        riskLevel: 'LOW',
        description: 'ACTN3 XX genotype lacking alpha-actinin-3. May favor endurance activities.',
        recommendations: 'May excel at endurance sports, focus on aerobic training.',
        citations: 18,
      },
    },
  },

  // PPARG - Fat metabolism
  'rs1801282': {
    gene: 'PPARG',
    traitName: 'PPARG Fat Metabolism',
    category: 'metabolism',
    genotypes: {
      'GG': {
        riskLevel: 'LOW',
        description: 'PPARG Pro/Pro with typical fat metabolism. Standard obesity and diabetes risk.',
        recommendations: 'Standard dietary recommendations.',
        citations: 12,
      },
      'CG': {
        riskLevel: 'PROTECTIVE',
        description: 'PPARG Pro/Ala may have improved insulin sensitivity and reduced diabetes risk.',
        recommendations: 'Continue healthy lifestyle for optimal benefits.',
        citations: 15,
      },
      'CC': {
        riskLevel: 'PROTECTIVE',
        description: 'PPARG Ala/Ala associated with improved insulin sensitivity.',
        recommendations: 'Continue healthy lifestyle.',
        citations: 10,
      },
    },
  },

  // AGT - Blood pressure
  'rs699': {
    gene: 'AGT',
    traitName: 'AGT Blood Pressure',
    category: 'disease_risk',
    genotypes: {
      'AA': {
        riskLevel: 'MODERATE',
        description: 'AGT M235T TT variant associated with higher angiotensinogen levels and increased hypertension risk.',
        recommendations: 'Regular blood pressure monitoring, low sodium diet, weight management.',
        citations: 18,
      },
      'AG': {
        riskLevel: 'LOW',
        description: 'AGT M235T heterozygous with slightly elevated hypertension risk.',
        recommendations: 'Regular blood pressure monitoring.',
        citations: 12,
      },
      'GG': {
        riskLevel: 'LOW',
        description: 'Normal AGT levels and blood pressure risk.',
        recommendations: 'Standard cardiovascular prevention.',
        citations: 8,
      },
    },
  },

  // ACE - Cardiovascular performance
  'rs4343': {
    gene: 'ACE',
    traitName: 'ACE Cardiovascular',
    category: 'traits',
    genotypes: {
      'GG': {
        riskLevel: 'LOW',
        description: 'ACE DD genotype with higher ACE activity. May favor power sports but higher cardiovascular risk.',
        recommendations: 'Regular cardiovascular monitoring, ACE inhibitors may be particularly effective.',
        citations: 15,
      },
      'AG': {
        riskLevel: 'LOW',
        description: 'ACE ID genotype with intermediate ACE activity.',
        recommendations: 'Balanced fitness approach.',
        citations: 10,
      },
      'AA': {
        riskLevel: 'LOW',
        description: 'ACE II genotype with lower ACE activity. May favor endurance activities.',
        recommendations: 'May excel at endurance sports.',
        citations: 12,
      },
    },
  },
};

// ============================================
// Parsing Functions
// ============================================

/**
 * Detect the file format based on file content
 */
function detectFileFormat(firstLines: string[]): DNASource {
  // Check for 23andMe format (has # comments)
  const hasComments = firstLines.some(line => line.startsWith('#'));
  const hasTabDelimited = firstLines.some(line => line.includes('\t'));

  if (hasComments && hasTabDelimited) {
    return '23andMe';
  }

  // Check for AncestryDNA format
  const hasCommaDelimited = firstLines.some(line => line.includes(','));
  const hasRsidHeader = firstLines.some(line =>
    FILE_FORMAT_PATTERNS.AncestryDNA.headerPattern.test(line)
  );

  if (hasCommaDelimited || (hasRsidHeader && !hasComments)) {
    return 'AncestryDNA';
  }

  // Fallback based on delimiter
  if (hasTabDelimited) {
    return '23andMe';
  } else if (hasCommaDelimited) {
    return 'AncestryDNA';
  }

  return 'Unknown';
}

/**
 * Parse a single line of DNA data
 */
function parseLine(
  line: string,
  source: DNASource,
  _lineNumber: number
): ParsedVariant | null {
  // Skip empty lines and comments
  if (!line.trim() || line.startsWith('#')) {
    return null;
  }

  // Skip header line
  if (/^(rsid|snp)/i.test(line)) {
    return null;
  }

  // Determine delimiter
  const delimiter = source === 'AncestryDNA' ? /[,\t]/ : '\t';
  const parts = line.split(delimiter).map(p => p.trim());

  // AncestryDNA format: rsid, chromosome, position, allele1, allele2
  // 23andMe format: rsid, chromosome, position, genotype
  let rsid: string;
  let chromosome: string;
  let position: string;
  let genotype: string;

  if (source === 'AncestryDNA' && parts.length >= 5) {
    // AncestryDNA has separate allele columns
    rsid = parts[0];
    chromosome = parts[1];
    position = parts[2];
    const allele1 = parts[3].toUpperCase();
    const allele2 = parts[4].toUpperCase();
    genotype = allele1 + allele2;
  } else if (parts.length >= 4) {
    // 23andMe format with combined genotype
    [rsid, chromosome, position, genotype] = parts;
  } else {
    return null;
  }

  // Validate rsID format (rs followed by numbers, or internal IDs starting with 'i')
  if (!rsid || (!rsid.match(/^rs\d+$/i) && !rsid.match(/^i\d+$/i))) {
    return null;
  }

  // Normalize chromosome
  const normalizedChrom = chromosome.toUpperCase().replace('M', 'MT');
  if (!VALID_CHROMOSOMES.has(normalizedChrom)) {
    return null;
  }

  // Validate position
  const pos = parseInt(position, 10);
  if (isNaN(pos) || pos < 1) {
    return null;
  }

  // Validate genotype
  const normalizedGenotype = genotype.toUpperCase();
  if (!VALID_GENOTYPE_PATTERN.test(normalizedGenotype)) {
    return null;
  }

  // Calculate confidence
  let confidence = 0.8;
  if (rsid.startsWith('rs')) confidence += 0.1;
  if (/^[ATCG]{2}$/.test(normalizedGenotype)) confidence += 0.1;

  return {
    rsid: rsid.toLowerCase(),
    chromosome: normalizedChrom,
    position: pos,
    genotype: normalizedGenotype,
    confidence: Math.min(confidence, 1.0),
  };
}

/**
 * Parse DNA file from buffer using streaming for large files
 */
export async function parseDNAFile(
  buffer: Buffer,
  filename: string
): Promise<DNAParsingResult> {
  const startTime = Date.now();
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!buffer || buffer.length === 0) {
    throw new BadRequestError('DNA file is empty or invalid');
  }

  logParsing(`Parsing DNA file: ${filename} (${buffer.length} bytes)`);

  // Convert buffer to string and split into lines for format detection
  const content = buffer.toString('utf-8');
  const lines = content.split('\n');

  if (lines.length < 2) {
    throw new BadRequestError('DNA file appears to be empty or malformed');
  }

  // Detect file format from first 20 lines
  const firstLines = lines.slice(0, 20);
  const source = detectFileFormat(firstLines);
  logParsing(`Detected format: ${source}`);

  // Parse variants
  const variants: ParsedVariant[] = [];
  let lineNumber = 0;
  let invalidLines = 0;

  // Process using streaming-like approach for large files
  const batchSize = 10000;
  let batch: ParsedVariant[] = [];

  for (const line of lines) {
    lineNumber++;

    try {
      const variant = parseLine(line, source, lineNumber);

      if (variant) {
        batch.push(variant);

        // Flush batch periodically
        if (batch.length >= batchSize) {
          variants.push(...batch);
          batch = [];
          logParsing(`Processed ${variants.length} variants...`);
        }
      } else if (line.trim() && !line.startsWith('#') && !/^(rsid|snp)/i.test(line)) {
        invalidLines++;
      }
    } catch (error) {
      invalidLines++;
      if (errors.length < 10) {
        errors.push(`Line ${lineNumber}: ${error instanceof Error ? error.message : 'Parse error'}`);
      }
    }
  }

  // Add remaining batch
  if (batch.length > 0) {
    variants.push(...batch);
  }

  const processingTimeMs = Date.now() - startTime;

  logParsing(`Parsing complete:`, {
    source,
    totalLines: lineNumber,
    validVariants: variants.length,
    invalidLines,
    processingTimeMs,
  });

  // Warn if too many invalid lines
  if (invalidLines > lineNumber * 0.1) {
    warnings.push(`High number of invalid lines (${invalidLines}/${lineNumber}). File may be corrupted or in unexpected format.`);
  }

  return {
    success: variants.length > 0,
    source,
    variants,
    totalLines: lineNumber,
    validVariants: variants.length,
    invalidLines,
    errors,
    warnings,
    processingTimeMs,
  };
}

/**
 * Parse DNA file using Node.js streams for memory-efficient processing of very large files
 */
export async function parseDNAFileStream(
  readable: Readable,
  _filename: string,
  onProgress?: (processed: number, total?: number) => void
): Promise<DNAParsingResult> {
  const startTime = Date.now();
  const errors: string[] = [];
  const warnings: string[] = [];
  const variants: ParsedVariant[] = [];

  let source: DNASource = 'Unknown';
  let lineNumber = 0;
  let invalidLines = 0;
  const firstLines: string[] = [];

  return new Promise((resolve, reject) => {
    const rl = createInterface({
      input: readable,
      crlfDelay: Infinity,
    });

    rl.on('line', (line) => {
      lineNumber++;

      // Collect first lines for format detection
      if (lineNumber <= 20) {
        firstLines.push(line);
        if (lineNumber === 20) {
          source = detectFileFormat(firstLines);
          logParsing(`Stream parsing - detected format: ${source}`);
        }
      }

      // Parse the line if we've detected the format
      if (source !== 'Unknown' || lineNumber > 20) {
        if (lineNumber === 21 && source === 'Unknown') {
          source = detectFileFormat(firstLines);
        }

        try {
          const variant = parseLine(line, source, lineNumber);
          if (variant) {
            variants.push(variant);
          } else if (line.trim() && !line.startsWith('#') && !/^(rsid|snp)/i.test(line)) {
            invalidLines++;
          }
        } catch (error) {
          invalidLines++;
          if (errors.length < 10) {
            errors.push(`Line ${lineNumber}: ${error instanceof Error ? error.message : 'Parse error'}`);
          }
        }
      }

      // Report progress periodically
      if (lineNumber % 50000 === 0 && onProgress) {
        onProgress(variants.length);
      }
    });

    rl.on('close', () => {
      const processingTimeMs = Date.now() - startTime;

      logParsing(`Stream parsing complete:`, {
        source,
        totalLines: lineNumber,
        validVariants: variants.length,
        invalidLines,
        processingTimeMs,
      });

      if (invalidLines > lineNumber * 0.1) {
        warnings.push(`High number of invalid lines (${invalidLines}/${lineNumber}).`);
      }

      resolve({
        success: variants.length > 0,
        source,
        variants,
        totalLines: lineNumber,
        validVariants: variants.length,
        invalidLines,
        errors,
        warnings,
        processingTimeMs,
      });
    });

    rl.on('error', (error) => {
      reject(new BadRequestError(`Failed to read DNA file: ${error.message}`));
    });
  });
}

// ============================================
// Trait Analysis
// ============================================

/**
 * Analyze parsed variants against SNP database to generate genetic traits
 */
export function analyzeTraits(variants: ParsedVariant[]): GeneticTraitResult[] {
  const traits: GeneticTraitResult[] = [];

  // Create lookup map for faster searching
  const variantMap = new Map<string, ParsedVariant>();
  for (const variant of variants) {
    variantMap.set(variant.rsid.toLowerCase(), variant);
  }

  logParsing(`Analyzing ${variants.length} variants against ${Object.keys(SNP_DATABASE).length} known SNPs`);

  // Check each SNP in database
  for (const [rsid, snpDef] of Object.entries(SNP_DATABASE)) {
    const variant = variantMap.get(rsid.toLowerCase());

    if (variant) {
      const genotypeInfo = snpDef.genotypes[variant.genotype];

      if (genotypeInfo) {
        traits.push({
          traitName: snpDef.traitName,
          gene: snpDef.gene,
          category: snpDef.category,
          rsid: variant.rsid,
          genotype: variant.genotype,
          riskLevel: genotypeInfo.riskLevel,
          description: genotypeInfo.description,
          recommendations: genotypeInfo.recommendations,
          confidence: variant.confidence,
          citationCount: genotypeInfo.citations,
        });
      } else {
        // Handle genotypes not in our database
        logParsing(`Unknown genotype ${variant.genotype} for ${rsid} (${snpDef.gene})`);
      }
    }
  }

  // Sort by risk level (HIGH first) then by category
  const riskOrder: Record<string, number> = {
    HIGH: 0,
    MODERATE: 1,
    LOW: 2,
    PROTECTIVE: 3,
    UNKNOWN: 4,
  };

  traits.sort((a, b) => {
    const riskDiff = riskOrder[a.riskLevel] - riskOrder[b.riskLevel];
    if (riskDiff !== 0) return riskDiff;
    return a.category.localeCompare(b.category);
  });

  logParsing(`Trait analysis complete: ${traits.length} traits identified`);

  return traits;
}

/**
 * Get summary statistics for genetic traits
 */
export function getTraitSummary(traits: GeneticTraitResult[]): {
  total: number;
  byRisk: Record<string, number>;
  byCategory: Record<string, number>;
  highPriority: GeneticTraitResult[];
} {
  const byRisk: Record<string, number> = {
    HIGH: 0,
    MODERATE: 0,
    LOW: 0,
    PROTECTIVE: 0,
    UNKNOWN: 0,
  };

  const byCategory: Record<string, number> = {};

  for (const trait of traits) {
    byRisk[trait.riskLevel] = (byRisk[trait.riskLevel] || 0) + 1;
    byCategory[trait.category] = (byCategory[trait.category] || 0) + 1;
  }

  const highPriority = traits.filter(t =>
    t.riskLevel === 'HIGH' || t.riskLevel === 'MODERATE'
  );

  return {
    total: traits.length,
    byRisk,
    byCategory,
    highPriority,
  };
}

/**
 * Get list of all SNPs in the database for reference
 */
export function getKnownSNPs(): string[] {
  return Object.keys(SNP_DATABASE);
}

/**
 * Check if a specific SNP is in our database
 */
export function isKnownSNP(rsid: string): boolean {
  return rsid.toLowerCase() in SNP_DATABASE;
}

export default {
  parseDNAFile,
  parseDNAFileStream,
  analyzeTraits,
  getTraitSummary,
  getKnownSNPs,
  isKnownSNP,
};
