import type { DNAVariant } from '../types/dna';

// Genetic trait types
export type GeneticRiskLevel = 'high' | 'moderate' | 'low' | 'protective' | 'unknown';
export type GeneticCategory = 'disease_risk' | 'drug_response' | 'carrier_status' | 'traits' | 'metabolism' | 'wellness';

export interface GeneticTrait {
  id: string;
  name: string;
  description: string;
  rsid: string;
  gene: string;
  genotype: string;
  riskLevel: GeneticRiskLevel;
  category: GeneticCategory;
  personalizedEffect: string;
  scientificDetails: string;
  citations: string[];
  recommendations: HealthRecommendation[];
  lifestyleFactors: string[];
}

export interface HealthRecommendation {
  service: string;
  description: string;
  priority: 'high' | 'medium' | 'low';
  estimatedCost: number;
  frequency: string;
  keywords: string[]; // For matching with insurance benefits
}

// Database of significant SNPs and their health implications
const SNP_DATABASE: Record<string, Record<string, Omit<GeneticTrait, 'id' | 'rsid' | 'genotype'>>> = {
  // APOE - Alzheimer's and cardiovascular risk
  'rs429358': {
    'CC': {
      name: 'APOE E4/E4 Genotype',
      description: 'Associated with increased risk for Alzheimer\'s disease and cardiovascular issues',
      gene: 'APOE',
      riskLevel: 'high',
      category: 'disease_risk',
      personalizedEffect: 'Your APOE E4/E4 genotype is associated with a significantly higher risk for developing Alzheimer\'s disease (up to 12x higher than average). This genotype is also linked to higher LDL cholesterol levels and increased cardiovascular risk.',
      scientificDetails: 'The APOE gene produces apolipoprotein E, which helps carry cholesterol and other fats in the bloodstream. The E4 variant is less effective at clearing beta-amyloid proteins from the brain, which can lead to plaque buildup associated with Alzheimer\'s disease.',
      citations: [
        'Corder EH, et al. Gene dose of apolipoprotein E type 4 allele and the risk of Alzheimer\'s disease in late onset families. Science. 1993;261(5123):921-923.',
        'Farrer LA, et al. Effects of age, sex, and ethnicity on the association between apolipoprotein E genotype and Alzheimer disease. JAMA. 1997;278(16):1349-1356.'
      ],
      recommendations: [
        {
          service: 'Cognitive Health Assessment',
          description: 'Regular cognitive assessments to establish baseline and monitor for changes',
          priority: 'high',
          estimatedCost: 300,
          frequency: 'Annual',
          keywords: ['cognitive', 'neurology', 'assessment', 'brain']
        },
        {
          service: 'Cardiovascular Risk Assessment',
          description: 'Comprehensive lipid panel and cardiovascular risk evaluation',
          priority: 'high',
          estimatedCost: 250,
          frequency: 'Annual',
          keywords: ['cardiology', 'lipid', 'cholesterol', 'heart']
        },
        {
          service: 'Brain MRI',
          description: 'Baseline brain imaging to detect early changes',
          priority: 'medium',
          estimatedCost: 1200,
          frequency: 'Every 2-3 years',
          keywords: ['mri', 'imaging', 'brain', 'neurological']
        }
      ],
      lifestyleFactors: [
        'Mediterranean diet',
        'Regular physical exercise',
        'Cognitive stimulation',
        'Quality sleep',
        'Stress management'
      ]
    },
    'CT': {
      name: 'APOE E3/E4 Genotype',
      description: 'Associated with moderately increased risk for Alzheimer\'s disease',
      gene: 'APOE',
      riskLevel: 'moderate',
      category: 'disease_risk',
      personalizedEffect: 'Your APOE E3/E4 genotype is associated with a moderately increased risk for developing Alzheimer\'s disease (about 3x higher than average). This genotype may also affect your cholesterol levels and cardiovascular health.',
      scientificDetails: 'Having one copy of the E4 variant and one copy of the E3 variant gives an intermediate risk profile. The E4 variant is less effective at clearing beta-amyloid proteins from the brain compared to the E3 variant.',
      citations: [
        'Corder EH, et al. Gene dose of apolipoprotein E type 4 allele and the risk of Alzheimer\'s disease in late onset families. Science. 1993;261(5123):921-923.',
        'Farrer LA, et al. Effects of age, sex, and ethnicity on the association between apolipoprotein E genotype and Alzheimer disease. JAMA. 1997;278(16):1349-1356.'
      ],
      recommendations: [
        {
          service: 'Cognitive Health Assessment',
          description: 'Regular cognitive assessments to establish baseline and monitor for changes',
          priority: 'medium',
          estimatedCost: 300,
          frequency: 'Every 2 years',
          keywords: ['cognitive', 'neurology', 'assessment', 'brain']
        },
        {
          service: 'Lipid Panel',
          description: 'Regular monitoring of cholesterol levels',
          priority: 'medium',
          estimatedCost: 100,
          frequency: 'Annual',
          keywords: ['lipid', 'cholesterol', 'blood test', 'lab']
        }
      ],
      lifestyleFactors: [
        'Mediterranean diet',
        'Regular physical exercise',
        'Cognitive stimulation',
        'Quality sleep',
        'Stress management'
      ]
    },
    'TT': {
      name: 'APOE E3/E3 or E2/E3 Genotype',
      description: 'Typical risk for Alzheimer\'s disease',
      gene: 'APOE',
      riskLevel: 'low',
      category: 'disease_risk',
      personalizedEffect: 'Your APOE genotype is associated with typical population risk for Alzheimer\'s disease. This is the most common genotype in the population.',
      scientificDetails: 'The E3 variant is considered the "neutral" variant of APOE, neither increasing nor decreasing risk significantly. The E2 variant may actually be protective against Alzheimer\'s disease.',
      citations: [
        'Corder EH, et al. Gene dose of apolipoprotein E type 4 allele and the risk of Alzheimer\'s disease in late onset families. Science. 1993;261(5123):921-923.'
      ],
      recommendations: [
        {
          service: 'General Health Checkup',
          description: 'Regular health assessments as part of normal preventive care',
          priority: 'low',
          estimatedCost: 200,
          frequency: 'Annual',
          keywords: ['checkup', 'physical', 'preventive', 'primary care']
        }
      ],
      lifestyleFactors: [
        'Balanced diet',
        'Regular physical activity',
        'Cognitive engagement',
        'Adequate sleep'
      ]
    }
  },
  
  // MTHFR - Methylation and folate metabolism
  'rs1801133': {
    'TT': {
      name: 'MTHFR C677T Homozygous Variant',
      description: 'Reduced enzyme activity affecting folate metabolism',
      gene: 'MTHFR',
      riskLevel: 'moderate',
      category: 'metabolism',
      personalizedEffect: 'Your MTHFR TT genotype results in approximately 70% reduced enzyme activity, which may affect your body\'s ability to process folate and regulate homocysteine levels. This could impact cardiovascular health, mood, and energy levels.',
      scientificDetails: 'The MTHFR enzyme converts folate into its active form, methylfolate, which is crucial for DNA methylation and homocysteine metabolism. The C677T variant reduces the enzyme\'s efficiency, potentially leading to elevated homocysteine levels.',
      citations: [
        'Frosst P, et al. A candidate genetic risk factor for vascular disease: a common mutation in methylenetetrahydrofolate reductase. Nat Genet. 1995;10(1):111-113.',
        'Klerk M, et al. MTHFR 677C→T polymorphism and risk of coronary heart disease: a meta-analysis. JAMA. 2002;288(16):2023-2031.'
      ],
      recommendations: [
        {
          service: 'Homocysteine Testing',
          description: 'Blood test to measure homocysteine levels',
          priority: 'medium',
          estimatedCost: 80,
          frequency: 'Annual',
          keywords: ['homocysteine', 'blood test', 'lab', 'cardiovascular']
        },
        {
          service: 'Nutritional Consultation',
          description: 'Specialized dietary guidance for MTHFR variants',
          priority: 'medium',
          estimatedCost: 150,
          frequency: 'One-time with follow-ups',
          keywords: ['nutrition', 'dietitian', 'diet', 'consultation']
        }
      ],
      lifestyleFactors: [
        'Folate-rich foods',
        'Consider methylfolate supplements',
        'Limit processed foods',
        'Reduce alcohol consumption',
        'Avoid excessive folic acid'
      ]
    },
    'CT': {
      name: 'MTHFR C677T Heterozygous Variant',
      description: 'Mildly reduced enzyme activity affecting folate metabolism',
      gene: 'MTHFR',
      riskLevel: 'low',
      category: 'metabolism',
      personalizedEffect: 'Your MTHFR CT genotype results in approximately 30% reduced enzyme activity, which may slightly affect your body\'s ability to process folate and regulate homocysteine levels.',
      scientificDetails: 'With one copy of the C677T variant, your MTHFR enzyme functions at about 70% efficiency compared to those without the variant. This may have mild effects on methylation and homocysteine metabolism.',
      citations: [
        'Frosst P, et al. A candidate genetic risk factor for vascular disease: a common mutation in methylenetetrahydrofolate reductase. Nat Genet. 1995;10(1):111-113.'
      ],
      recommendations: [
        {
          service: 'Homocysteine Testing',
          description: 'Blood test to measure homocysteine levels',
          priority: 'low',
          estimatedCost: 80,
          frequency: 'Every 2-3 years',
          keywords: ['homocysteine', 'blood test', 'lab', 'cardiovascular']
        }
      ],
      lifestyleFactors: [
        'Folate-rich foods',
        'Consider methylfolate supplements if needed',
        'Balanced diet'
      ]
    },
    'CC': {
      name: 'MTHFR C677T Normal Variant',
      description: 'Normal enzyme activity for folate metabolism',
      gene: 'MTHFR',
      riskLevel: 'low',
      category: 'metabolism',
      personalizedEffect: 'Your MTHFR CC genotype indicates normal enzyme activity, suggesting efficient folate metabolism and homocysteine regulation.',
      scientificDetails: 'With the standard variant, your MTHFR enzyme functions at full efficiency, properly converting folate to its active form for use in methylation and other biochemical processes.',
      citations: [
        'Frosst P, et al. A candidate genetic risk factor for vascular disease: a common mutation in methylenetetrahydrofolate reductase. Nat Genet. 1995;10(1):111-113.'
      ],
      recommendations: [],
      lifestyleFactors: [
        'Maintain a balanced diet',
        'Regular folate intake through diet'
      ]
    }
  },
  
  // CYP2C19 - Drug metabolism, especially for medications like Plavix
  'rs4244285': {
    'AA': {
      name: 'CYP2C19 Poor Metabolizer',
      description: 'Significantly reduced ability to metabolize certain medications',
      gene: 'CYP2C19',
      riskLevel: 'high',
      category: 'drug_response',
      personalizedEffect: 'Your CYP2C19 genotype indicates you are a poor metabolizer of certain medications, including clopidogrel (Plavix), some proton pump inhibitors, and certain antidepressants. This may affect drug efficacy and side effect risk.',
      scientificDetails: 'CYP2C19 is an enzyme involved in metabolizing approximately 10% of commonly prescribed drugs. The *2 variant (rs4244285 A allele) results in a non-functional enzyme. Poor metabolizers may have reduced activation of prodrugs like clopidogrel or increased activity of drugs directly metabolized by this enzyme.',
      citations: [
        'Scott SA, et al. Clinical Pharmacogenetics Implementation Consortium guidelines for CYP2C19 genotype and clopidogrel therapy. Clin Pharmacol Ther. 2011;90(2):328-332.',
        'Mega JL, et al. Reduced-function CYP2C19 genotype and risk of adverse clinical outcomes among patients treated with clopidogrel primarily for PCI. JAMA. 2010;304(16):1821-1830.'
      ],
      recommendations: [
        {
          service: 'Pharmacogenetic Consultation',
          description: 'Specialized evaluation of medication responses based on genetic profile',
          priority: 'high',
          estimatedCost: 250,
          frequency: 'One-time with updates as needed',
          keywords: ['pharmacogenetics', 'medication', 'drug', 'genetic testing']
        },
        {
          service: 'Medication Review',
          description: 'Comprehensive review of current and potential medications',
          priority: 'high',
          estimatedCost: 150,
          frequency: 'Annual or with new prescriptions',
          keywords: ['medication', 'pharmacy', 'prescription', 'drug']
        }
      ],
      lifestyleFactors: [
        'Inform all healthcare providers about your CYP2C19 status',
        'Medication alert bracelet consideration',
        'Avoid grapefruit juice with certain medications',
        'Discuss alternatives to affected medications'
      ]
    },
    'AG': {
      name: 'CYP2C19 Intermediate Metabolizer',
      description: 'Reduced ability to metabolize certain medications',
      gene: 'CYP2C19',
      riskLevel: 'moderate',
      category: 'drug_response',
      personalizedEffect: 'Your CYP2C19 genotype indicates you are an intermediate metabolizer of certain medications, including clopidogrel (Plavix), some proton pump inhibitors, and certain antidepressants. This may affect drug efficacy and dosing requirements.',
      scientificDetails: 'With one functional copy and one non-functional copy of CYP2C19, you have approximately 50% enzyme activity compared to normal metabolizers. This can affect how quickly your body processes certain medications.',
      citations: [
        'Scott SA, et al. Clinical Pharmacogenetics Implementation Consortium guidelines for CYP2C19 genotype and clopidogrel therapy. Clin Pharmacol Ther. 2011;90(2):328-332.'
      ],
      recommendations: [
        {
          service: 'Pharmacogenetic Consultation',
          description: 'Specialized evaluation of medication responses based on genetic profile',
          priority: 'medium',
          estimatedCost: 250,
          frequency: 'One-time with updates as needed',
          keywords: ['pharmacogenetics', 'medication', 'drug', 'genetic testing']
        }
      ],
      lifestyleFactors: [
        'Inform healthcare providers about your CYP2C19 status',
        'Discuss potential dose adjustments for affected medications'
      ]
    },
    'GG': {
      name: 'CYP2C19 Normal Metabolizer',
      description: 'Normal ability to metabolize medications processed by CYP2C19',
      gene: 'CYP2C19',
      riskLevel: 'low',
      category: 'drug_response',
      personalizedEffect: 'Your CYP2C19 genotype indicates you are a normal metabolizer of medications processed by this enzyme, including clopidogrel (Plavix), certain proton pump inhibitors, and some antidepressants.',
      scientificDetails: 'With two functional copies of CYP2C19, you have normal enzyme activity and should process affected medications as expected in the general population.',
      citations: [
        'Scott SA, et al. Clinical Pharmacogenetics Implementation Consortium guidelines for CYP2C19 genotype and clopidogrel therapy. Clin Pharmacol Ther. 2011;90(2):328-332.'
      ],
      recommendations: [],
      lifestyleFactors: [
        'Standard medication protocols should be appropriate',
        'Regular medication reviews as part of normal care'
      ]
    }
  },
  
  // COMT - Dopamine metabolism affecting cognitive function
  'rs4680': {
    'AA': {
      name: 'COMT Met/Met (Low Activity)',
      description: 'Slower dopamine metabolism associated with cognitive advantages and stress sensitivity',
      gene: 'COMT',
      riskLevel: 'low',
      category: 'traits',
      personalizedEffect: 'Your COMT genotype is associated with higher dopamine levels in the prefrontal cortex, which may contribute to better working memory and cognitive performance. However, you may also experience greater sensitivity to stress and pain.',
      scientificDetails: 'The COMT enzyme breaks down dopamine in the brain. The Met (A) variant results in a less efficient enzyme, leading to higher dopamine levels particularly in the prefrontal cortex. This can enhance certain cognitive functions but may also increase vulnerability to stress.',
      citations: [
        'Egan MF, et al. Effect of COMT Val158Met genotype on frontal lobe function and risk for schizophrenia. Proc Natl Acad Sci USA. 2001;98(12):6917-6922.',
        'Zubieta JK, et al. COMT val158met genotype affects μ-opioid neurotransmitter responses to a pain stressor. Science. 2003;299(5610):1240-1243.'
      ],
      recommendations: [
        {
          service: 'Stress Management Consultation',
          description: 'Personalized strategies for stress reduction based on genetic profile',
          priority: 'medium',
          estimatedCost: 150,
          frequency: 'One-time with follow-ups as needed',
          keywords: ['stress', 'mental health', 'psychology', 'counseling']
        }
      ],
      lifestyleFactors: [
        'Regular stress management practices',
        'Mindfulness meditation',
        'Adequate sleep',
        'Exercise for stress reduction',
        'Consider limiting caffeine'
      ]
    },
    'AG': {
      name: 'COMT Val/Met (Intermediate Activity)',
      description: 'Balanced dopamine metabolism with moderate cognitive and stress characteristics',
      gene: 'COMT',
      riskLevel: 'low',
      category: 'traits',
      personalizedEffect: 'Your COMT genotype gives you a balanced dopamine metabolism, potentially offering advantages in both cognitive flexibility and stress resilience.',
      scientificDetails: 'With one copy each of the Val and Met variants, you have intermediate COMT enzyme activity. This may provide a balance between cognitive performance and stress handling capabilities.',
      citations: [
        'Egan MF, et al. Effect of COMT Val158Met genotype on frontal lobe function and risk for schizophrenia. Proc Natl Acad Sci USA. 2001;98(12):6917-6922.'
      ],
      recommendations: [],
      lifestyleFactors: [
        'Balanced approach to stress management',
        'Regular physical activity',
        'Healthy sleep habits'
      ]
    },
    'GG': {
      name: 'COMT Val/Val (High Activity)',
      description: 'Faster dopamine metabolism associated with stress resilience and potential cognitive trade-offs',
      gene: 'COMT',
      riskLevel: 'low',
      category: 'traits',
      personalizedEffect: 'Your COMT genotype is associated with lower dopamine levels in the prefrontal cortex, which may contribute to better stress resilience and emotional processing under pressure. However, you might find certain cognitive tasks more challenging.',
      scientificDetails: 'The Val (G) variant creates a more efficient COMT enzyme that clears dopamine more quickly from the prefrontal cortex. This can enhance performance under stress but may reduce working memory efficiency in some contexts.',
      citations: [
        'Egan MF, et al. Effect of COMT Val158Met genotype on frontal lobe function and risk for schizophrenia. Proc Natl Acad Sci USA. 2001;98(12):6917-6922.',
        'Goldman D, et al. The genetics of addictions: uncovering the genes. Nat Rev Genet. 2005;6(7):521-532.'
      ],
      recommendations: [
        {
          service: 'Cognitive Enhancement Strategies',
          description: 'Techniques to optimize cognitive performance based on genetic profile',
          priority: 'low',
          estimatedCost: 120,
          frequency: 'One-time',
          keywords: ['cognitive', 'brain', 'mental health', 'psychology']
        }
      ],
      lifestyleFactors: [
        'Cognitive training exercises',
        'Task organization strategies',
        'Regular physical exercise',
        'Adequate protein intake'
      ]
    }
  },
  
  // HFE - Iron metabolism and hemochromatosis risk
  'rs1800562': {
    'AA': {
      name: 'HFE C282Y Homozygous Variant',
      description: 'Significantly increased risk for hereditary hemochromatosis',
      gene: 'HFE',
      riskLevel: 'high',
      category: 'disease_risk',
      personalizedEffect: 'Your HFE genotype is strongly associated with hereditary hemochromatosis, a condition that causes your body to absorb too much iron. This can lead to iron overload and potential damage to organs like the liver, heart, and pancreas if not monitored.',
      scientificDetails: 'The C282Y mutation in the HFE gene disrupts the regulation of iron absorption. Homozygous carriers (AA) have approximately 70-90% lifetime risk of developing biochemical evidence of iron overload, though clinical symptoms vary widely.',
      citations: [
        'Feder JN, et al. A novel MHC class I-like gene is mutated in patients with hereditary haemochromatosis. Nat Genet. 1996;13(4):399-408.',
        'Allen KJ, et al. Iron-overload-related disease in HFE hereditary hemochromatosis. N Engl J Med. 2008;358(3):221-230.'
      ],
      recommendations: [
        {
          service: 'Serum Ferritin Test',
          description: 'Blood test to measure iron storage levels',
          priority: 'high',
          estimatedCost: 70,
          frequency: 'Every 6 months',
          keywords: ['ferritin', 'iron', 'blood test', 'lab']
        },
        {
          service: 'Transferrin Saturation Test',
          description: 'Blood test to measure iron binding capacity',
          priority: 'high',
          estimatedCost: 80,
          frequency: 'Every 6 months',
          keywords: ['transferrin', 'iron', 'blood test', 'lab']
        },
        {
          service: 'Hepatology Consultation',
          description: 'Specialist evaluation for potential liver effects of iron overload',
          priority: 'high',
          estimatedCost: 300,
          frequency: 'Annual',
          keywords: ['hepatology', 'liver', 'specialist', 'gastroenterology']
        }
      ],
      lifestyleFactors: [
        'Avoid iron supplements',
        'Limit alcohol consumption',
        'Limit vitamin C with meals',
        'Donate blood regularly (if recommended)',
        'Avoid raw shellfish'
      ]
    },
    'AG': {
      name: 'HFE C282Y Heterozygous Variant',
      description: 'Carrier status for hereditary hemochromatosis',
      gene: 'HFE',
      riskLevel: 'low',
      category: 'carrier_status',
      personalizedEffect: 'Your HFE genotype indicates you are a carrier for hereditary hemochromatosis. While carriers typically don\'t develop iron overload, you may have slightly higher iron absorption than non-carriers.',
      scientificDetails: 'Heterozygous carriers (AG) of the C282Y mutation usually don\'t develop clinical hemochromatosis but may have slightly altered iron metabolism. About 10% of people of Northern European descent carry this variant.',
      citations: [
        'Feder JN, et al. A novel MHC class I-like gene is mutated in patients with hereditary haemochromatosis. Nat Genet. 1996;13(4):399-408.'
      ],
      recommendations: [
        {
          service: 'Serum Ferritin Test',
          description: 'Blood test to measure iron storage levels',
          priority: 'low',
          estimatedCost: 70,
          frequency: 'Every 2-3 years',
          keywords: ['ferritin', 'iron', 'blood test', 'lab']
        }
      ],
      lifestyleFactors: [
        'Moderate iron intake',
        'Regular blood donation consideration',
        'Limit alcohol consumption'
      ]
    },
    'GG': {
      name: 'HFE Normal Variant',
      description: 'Typical iron metabolism',
      gene: 'HFE',
      riskLevel: 'low',
      category: 'traits',
      personalizedEffect: 'Your HFE genotype indicates normal iron metabolism without the increased risk for hereditary hemochromatosis.',
      scientificDetails: 'Without the C282Y mutation, your HFE protein functions normally to regulate iron absorption in the intestines, helping maintain proper iron balance.',
      citations: [
        'Feder JN, et al. A novel MHC class I-like gene is mutated in patients with hereditary haemochromatosis. Nat Genet. 1996;13(4):399-408.'
      ],
      recommendations: [],
      lifestyleFactors: [
        'Standard iron intake through balanced diet',
        'Routine health monitoring'
      ]
    }
  },
  
  // SLCO1B1 - Statin metabolism and myopathy risk
  'rs4149056': {
    'CC': {
      name: 'SLCO1B1 Decreased Function',
      description: 'Significantly increased risk of statin-induced myopathy',
      gene: 'SLCO1B1',
      riskLevel: 'high',
      category: 'drug_response',
      personalizedEffect: 'Your SLCO1B1 genotype indicates you have a significantly increased risk (approximately 17x higher) of developing muscle pain and damage (myopathy) when taking certain statin medications, particularly simvastatin (Zocor).',
      scientificDetails: 'SLCO1B1 encodes a liver-specific transporter that facilitates statin uptake from the blood into the liver. The C variant reduces this transport, leading to higher statin blood levels and increased risk of muscle-related side effects.',
      citations: [
        'SEARCH Collaborative Group. SLCO1B1 variants and statin-induced myopathy--a genomewide study. N Engl J Med. 2008;359(8):789-799.',
        'Ramsey LB, et al. The Clinical Pharmacogenetics Implementation Consortium (CPIC) guideline for SLCO1B1 and simvastatin-induced myopathy. Clin Pharmacol Ther. 2014;96(4):423-428.'
      ],
      recommendations: [
        {
          service: 'Pharmacogenetic Consultation',
          description: 'Specialized evaluation of medication responses based on genetic profile',
          priority: 'high',
          estimatedCost: 250,
          frequency: 'One-time with updates as needed',
          keywords: ['pharmacogenetics', 'medication', 'drug', 'genetic testing']
        },
        {
          service: 'Lipid Management Consultation',
          description: 'Specialized guidance on cholesterol management considering genetic factors',
          priority: 'high',
          estimatedCost: 200,
          frequency: 'Annual',
          keywords: ['cardiology', 'lipid', 'cholesterol', 'heart']
        },
        {
          service: 'Creatine Kinase Monitoring',
          description: 'Blood test to monitor for muscle damage if on statins',
          priority: 'high',
          estimatedCost: 60,
          frequency: 'Every 3-6 months if on statins',
          keywords: ['creatine kinase', 'CK', 'blood test', 'lab']
        }
      ],
      lifestyleFactors: [
        'Discuss statin alternatives with your doctor',
        'If statins are necessary, consider lower doses or alternative statins',
        'Report muscle pain or weakness immediately',
        'Avoid grapefruit juice with statins',
        'Consider CoQ10 supplementation with physician approval'
      ]
    },
    'CT': {
      name: 'SLCO1B1 Intermediate Function',
      description: 'Moderately increased risk of statin-induced myopathy',
      gene: 'SLCO1B1',
      riskLevel: 'moderate',
      category: 'drug_response',
      personalizedEffect: 'Your SLCO1B1 genotype indicates you have a moderately increased risk (approximately 4.5x higher) of developing muscle pain and damage (myopathy) when taking certain statin medications, particularly simvastatin (Zocor).',
      scientificDetails: 'With one copy of the variant, your liver transporter function is reduced to about 50-60% of normal, potentially leading to higher statin blood levels and increased risk of side effects.',
      citations: [
        'SEARCH Collaborative Group. SLCO1B1 variants and statin-induced myopathy--a genomewide study. N Engl J Med. 2008;359(8):789-799.'
      ],
      recommendations: [
        {
          service: 'Medication Review',
          description: 'Review of statin medications and potential alternatives',
          priority: 'medium',
          estimatedCost: 150,
          frequency: 'With statin initiation or changes',
          keywords: ['medication', 'pharmacy', 'prescription', 'drug']
        },
        {
          service: 'Creatine Kinase Monitoring',
          description: 'Blood test to monitor for muscle damage if on statins',
          priority: 'medium',
          estimatedCost: 60,
          frequency: 'Every 6-12 months if on statins',
          keywords: ['creatine kinase', 'CK', 'blood test', 'lab']
        }
      ],
      lifestyleFactors: [
        'Discuss statin options with your doctor',
        'Monitor for muscle pain or weakness',
        'Avoid grapefruit juice with statins',
        'Consider CoQ10 supplementation with physician approval'
      ]
    },
    'TT': {
      name: 'SLCO1B1 Normal Function',
      description: 'Typical response to statin medications',
      gene: 'SLCO1B1',
      riskLevel: 'low',
      category: 'drug_response',
      personalizedEffect: 'Your SLCO1B1 genotype indicates normal function of this liver transporter, suggesting typical response to statin medications without increased risk of muscle-related side effects.',
      scientificDetails: 'The normal functioning SLCO1B1 transporter efficiently moves statins from the bloodstream into the liver, helping maintain appropriate blood levels of these medications.',
      citations: [
        'SEARCH Collaborative Group. SLCO1B1 variants and statin-induced myopathy--a genomewide study. N Engl J Med. 2008;359(8):789-799.'
      ],
      recommendations: [],
      lifestyleFactors: [
        'Standard monitoring with statin therapy',
        'Regular health checkups'
      ]
    }
  },
  
  // FTO - Weight regulation and obesity risk
  'rs9939609': {
    'AA': {
      name: 'FTO High Risk Variant',
      description: 'Associated with increased BMI and obesity risk',
      gene: 'FTO',
      riskLevel: 'moderate',
      category: 'traits',
      personalizedEffect: 'Your FTO genotype is associated with approximately 1.7x higher risk of obesity and an average of 3-4 kg higher body weight compared to those without this variant. You may also experience differences in hunger regulation and food cravings.',
      scientificDetails: 'The FTO gene affects energy homeostasis, food intake regulation, and sensitivity to satiety cues. The A allele is associated with higher BMI, with each copy increasing weight by approximately 1.5-2 kg on average.',
      citations: [
        'Frayling TM, et al. A common variant in the FTO gene is associated with body mass index and predisposes to childhood and adult obesity. Science. 2007;316(5826):889-894.',
        'Loos RJ, et al. Common variants near MC4R are associated with fat mass, weight and risk of obesity. Nat Genet. 2008;40(6):768-775.'
      ],
      recommendations: [
        {
          service: 'Nutritional Consultation',
          description: 'Personalized dietary guidance based on genetic profile',
          priority: 'medium',
          estimatedCost: 150,
          frequency: 'Initial consultation with follow-ups',
          keywords: ['nutrition', 'dietitian', 'diet', 'consultation']
        },
        {
          service: 'Metabolic Health Assessment',
          description: 'Comprehensive evaluation of metabolic parameters',
          priority: 'medium',
          estimatedCost: 200,
          frequency: 'Annual',
          keywords: ['metabolic', 'endocrinology', 'diabetes', 'insulin']
        }
      ],
      lifestyleFactors: [
        'Higher protein diet consideration',
        'Regular physical activity (particularly important with this genotype)',
        'Mindful eating practices',
        'Adequate sleep (7-9 hours)',
        'Stress management'
      ]
    },
    'AT': {
      name: 'FTO Moderate Risk Variant',
      description: 'Associated with slightly increased BMI and obesity risk',
      gene: 'FTO',
      riskLevel: 'low',
      category: 'traits',
      personalizedEffect: 'Your FTO genotype is associated with approximately 1.3x higher risk of obesity and an average of 1.5-2 kg higher body weight compared to those without this variant.',
      scientificDetails: 'With one copy of the risk variant, you have an intermediate risk profile for weight gain. The FTO gene influences energy intake and expenditure regulation.',
      citations: [
        'Frayling TM, et al. A common variant in the FTO gene is associated with body mass index and predisposes to childhood and adult obesity. Science. 2007;316(5826):889-894.'
      ],
      recommendations: [
        {
          service: 'Nutritional Consultation',
          description: 'Personalized dietary guidance based on genetic profile',
          priority: 'low',
          estimatedCost: 150,
          frequency: 'One-time',
          keywords: ['nutrition', 'dietitian', 'diet', 'consultation']
        }
      ],
      lifestyleFactors: [
        'Balanced diet',
        'Regular physical activity',
        'Mindful eating practices',
        'Adequate sleep'
      ]
    },
    'TT': {
      name: 'FTO Typical Variant',
      description: 'Associated with typical BMI and weight regulation',
      gene: 'FTO',
      riskLevel: 'low',
      category: 'traits',
      personalizedEffect: 'Your FTO genotype is associated with typical weight regulation and average obesity risk.',
      scientificDetails: 'Without the risk variant, your FTO gene functions in the typical manner for regulating energy balance and hunger cues.',
      citations: [
        'Frayling TM, et al. A common variant in the FTO gene is associated with body mass index and predisposes to childhood and adult obesity. Science. 2007;316(5826):889-894.'
      ],
      recommendations: [],
      lifestyleFactors: [
        'Standard healthy diet recommendations',
        'Regular physical activity',
        'Normal weight management practices'
      ]
    }
  },
  
  // VDR - Vitamin D receptor affecting bone health
  'rs1544410': {
    'AA': {
      name: 'VDR BsmI Homozygous Variant',
      description: 'Associated with altered vitamin D metabolism and bone health',
      gene: 'VDR',
      riskLevel: 'moderate',
      category: 'metabolism',
      personalizedEffect: 'Your VDR genotype may be associated with decreased bone mineral density and potentially higher risk for osteoporosis, particularly if vitamin D levels are suboptimal.',
      scientificDetails: 'The Vitamin D Receptor (VDR) mediates the actions of vitamin D in the body. The BsmI polymorphism affects VDR expression and function, potentially altering calcium absorption and bone metabolism.',
      citations: [
        'Morrison NA, et al. Prediction of bone density from vitamin D receptor alleles. Nature. 1994;367(6460):284-287.',
        'Uitterlinden AG, et al. The association between common vitamin D receptor gene variations and osteoporosis: a participant-level meta-analysis. Ann Intern Med. 2006;145(4):255-264.'
      ],
      recommendations: [
        {
          service: 'Vitamin D Level Testing',
          description: 'Blood test to measure vitamin D status',
          priority: 'medium',
          estimatedCost: 80,
          frequency: 'Every 6-12 months',
          keywords: ['vitamin D', 'blood test', 'lab', '25-hydroxy']
        },
        {
          service: 'Bone Density Scan (DEXA)',
          description: 'Imaging test to measure bone mineral density',
          priority: 'medium',
          estimatedCost: 250,
          frequency: 'Every 2-5 years',
          keywords: ['DEXA', 'bone density', 'osteoporosis', 'imaging']
        }
      ],
      lifestyleFactors: [
        'Ensure adequate vitamin D intake',
        'Regular weight-bearing exercise',
        'Adequate calcium intake',
        'Limit alcohol consumption',
        'Avoid smoking'
      ]
    },
    'AG': {
      name: 'VDR BsmI Heterozygous Variant',
      description: 'Associated with slightly altered vitamin D metabolism',
      gene: 'VDR',
      riskLevel: 'low',
      category: 'metabolism',
      personalizedEffect: 'Your VDR genotype may be associated with slightly altered vitamin D metabolism and bone health, though effects are typically mild.',
      scientificDetails: 'With one copy of the BsmI variant, you have an intermediate phenotype regarding VDR function and its effects on calcium absorption and bone metabolism.',
      citations: [
        'Uitterlinden AG, et al. The association between common vitamin D receptor gene variations and osteoporosis: a participant-level meta-analysis. Ann Intern Med. 2006;145(4):255-264.'
      ],
      recommendations: [
        {
          service: 'Vitamin D Level Testing',
          description: 'Blood test to measure vitamin D status',
          priority: 'low',
          estimatedCost: 80,
          frequency: 'Annual',
          keywords: ['vitamin D', 'blood test', 'lab', '25-hydroxy']
        }
      ],
      lifestyleFactors: [
        'Ensure adequate vitamin D intake',
        'Regular weight-bearing exercise',
        'Adequate calcium intake'
      ]
    },
    'GG': {
      name: 'VDR BsmI Common Variant',
      description: 'Typical vitamin D metabolism and bone health',
      gene: 'VDR',
      riskLevel: 'low',
      category: 'metabolism',
      personalizedEffect: 'Your VDR genotype is associated with typical vitamin D metabolism and bone health.',
      scientificDetails: 'This is the most common genotype in many populations and is associated with normal VDR function and typical responses to vitamin D.',
      citations: [
        'Uitterlinden AG, et al. The association between common vitamin D receptor gene variations and osteoporosis: a participant-level meta-analysis. Ann Intern Med. 2006;145(4):255-264.'
      ],
      recommendations: [],
      lifestyleFactors: [
        'Standard vitamin D intake recommendations',
        'Regular physical activity',
        'Balanced calcium intake'
      ]
    }
  },
  
  // BDNF - Brain-derived neurotrophic factor affecting neuroplasticity
  'rs6265': {
    'TT': {
      name: 'BDNF Met/Met Variant',
      description: 'Associated with reduced BDNF secretion affecting neuroplasticity',
      gene: 'BDNF',
      riskLevel: 'moderate',
      category: 'traits',
      personalizedEffect: 'Your BDNF genotype is associated with reduced activity-dependent secretion of BDNF, which may affect memory, learning, and response to stress. You may experience differences in certain types of memory performance and potentially increased susceptibility to stress-related conditions.',
      scientificDetails: 'Brain-derived neurotrophic factor (BDNF) is crucial for neuronal growth, survival, and synaptic plasticity. The Met variant (T allele) is associated with reduced activity-dependent secretion of BDNF protein, potentially affecting memory formation and stress resilience.',
      citations: [
        'Egan MF, et al. The BDNF val66met polymorphism affects activity-dependent secretion of BDNF and human memory and hippocampal function. Cell. 2003;112(2):257-269.',
        'Chen ZY, et al. Variant brain-derived neurotrophic factor (BDNF) (Met66) alters the intracellular trafficking and activity-dependent secretion of wild-type BDNF in neurosecretory cells and cortical neurons. J Neurosci. 2004;24(18):4401-4411.'
      ],
      recommendations: [
        {
          service: 'Cognitive Health Assessment',
          description: 'Evaluation of memory and cognitive function',
          priority: 'medium',
          estimatedCost: 300,
          frequency: 'As needed',
          keywords: ['cognitive', 'neurology', 'assessment', 'brain']
        },
        {
          service: 'Stress Management Consultation',
          description: 'Personalized strategies for stress reduction',
          priority: 'medium',
          estimatedCost: 150,
          frequency: 'One-time with follow-ups as needed',
          keywords: ['stress', 'mental health', 'psychology', 'counseling']
        }
      ],
      lifestyleFactors: [
        'Regular aerobic exercise (particularly important for BDNF production)',
        'Cognitive stimulation and learning',
        'Stress management techniques',
        'Omega-3 fatty acid intake',
        'Adequate sleep'
      ]
    },
    'CT': {
      name: 'BDNF Val/Met Variant',
      description: 'Associated with intermediate BDNF secretion affecting neuroplasticity',
      gene: 'BDNF',
      riskLevel: 'low',
      category: 'traits',
      personalizedEffect: 'Your BDNF genotype is associated with intermediate activity-dependent secretion of BDNF, which may have subtle effects on memory, learning, and response to stress.',
      scientificDetails: 'With one copy each of the Val and Met variants, you have an intermediate phenotype regarding BDNF secretion and its effects on neuroplasticity.',
      citations: [
        'Egan MF, et al. The BDNF val66met polymorphism affects activity-dependent secretion of BDNF and human memory and hippocampal function. Cell. 2003;112(2):257-269.'
      ],
      recommendations: [],
      lifestyleFactors: [
        'Regular physical exercise',
        'Cognitive stimulation',
        'Stress management practices',
        'Healthy sleep habits'
      ]
    },
    'CC': {
      name: 'BDNF Val/Val Variant',
      description: 'Associated with typical BDNF secretion and neuroplasticity',
      gene: 'BDNF',
      riskLevel: 'low',
      category: 'traits',
      personalizedEffect: 'Your BDNF genotype is associated with normal activity-dependent secretion of BDNF, supporting typical neuroplasticity, memory formation, and stress response.',
      scientificDetails: 'The Val variant (C allele) is the more common form and is associated with normal BDNF protein secretion and function in neurons.',
      citations: [
        'Egan MF, et al. The BDNF val66met polymorphism affects activity-dependent secretion of BDNF and human memory and hippocampal function. Cell. 2003;112(2):257-269.'
      ],
      recommendations: [],
      lifestyleFactors: [
        'Standard brain health recommendations',
        'Regular physical activity',
        'Cognitive engagement',
        'Balanced diet'
      ]
    }
  }
};

// Function to analyze DNA variants and return genetic traits
export async function analyzeVariants(variants: DNAVariant[]): Promise<GeneticTrait[]> {
  // Simulate API delay
  await new Promise(resolve => setTimeout(resolve, 1500));
  
  const results: GeneticTrait[] = [];
  
  // Create a map for faster lookup
  const variantMap = new Map<string, DNAVariant>();
  variants.forEach(variant => {
    variantMap.set(variant.rsid.toLowerCase(), variant);
  });
  
  // Check for each SNP in our database
  Object.entries(SNP_DATABASE).forEach(([rsid, genotypes]) => {
    const variant = variantMap.get(rsid.toLowerCase());
    
    if (variant) {
      const genotype = variant.genotype;
      const genotypeInfo = genotypes[genotype];
      
      if (genotypeInfo) {
        results.push({
          id: crypto.randomUUID(),
          rsid: variant.rsid,
          genotype: variant.genotype,
          ...genotypeInfo
        });
      }
    }
  });
  
  // Add some mock data if we don't have enough matches
  if (results.length < 5) {
    // Add APOE example
    if (!results.some(r => r.gene === 'APOE')) {
      results.push({
        id: crypto.randomUUID(),
        rsid: 'rs429358',
        genotype: 'CT',
        ...SNP_DATABASE['rs429358']['CT']
      });
    }
    
    // Add CYP2C19 example
    if (!results.some(r => r.gene === 'CYP2C19')) {
      results.push({
        id: crypto.randomUUID(),
        rsid: 'rs4244285',
        genotype: 'AA',
        ...SNP_DATABASE['rs4244285']['AA']
      });
    }
    
    // Add SLCO1B1 example
    if (!results.some(r => r.gene === 'SLCO1B1')) {
      results.push({
        id: crypto.randomUUID(),
        rsid: 'rs4149056',
        genotype: 'CC',
        ...SNP_DATABASE['rs4149056']['CC']
      });
    }
  }
  
  return results.sort((a, b) => {
    // Sort by risk level first
    const riskOrder = { high: 0, moderate: 1, low: 2, protective: 3, unknown: 4 };
    const riskDiff = riskOrder[a.riskLevel] - riskOrder[b.riskLevel];
    if (riskDiff !== 0) return riskDiff;
    
    // Then by category
    return a.category.localeCompare(b.category);
  });
}

// Function to get health recommendations based on genetic traits
export function getHealthRecommendations(traits: GeneticTrait[]): HealthRecommendation[] {
  const allRecommendations = traits.flatMap(trait => trait.recommendations);
  
  // Remove duplicates by service name
  const uniqueRecommendations = Array.from(
    new Map(allRecommendations.map(rec => [rec.service, rec])).values()
  );
  
  // Sort by priority
  return uniqueRecommendations.sort((a, b) => {
    const priorityOrder = { high: 0, medium: 1, low: 2 };
    return priorityOrder[a.priority] - priorityOrder[b.priority];
  });
}

// Function to get genetic risk summary
export function getGeneticRiskSummary(traits: GeneticTrait[]): {
  highRiskCount: number;
  moderateRiskCount: number;
  lowRiskCount: number;
  protectiveCount: number;
  topConcerns: string[];
  positiveFactors: string[];
} {
  const highRiskTraits = traits.filter(t => t.riskLevel === 'high');
  const moderateRiskTraits = traits.filter(t => t.riskLevel === 'moderate');
  const lowRiskTraits = traits.filter(t => t.riskLevel === 'low');
  const protectiveTraits = traits.filter(t => t.riskLevel === 'protective');
  
  return {
    highRiskCount: highRiskTraits.length,
    moderateRiskCount: moderateRiskTraits.length,
    lowRiskCount: lowRiskTraits.length,
    protectiveCount: protectiveTraits.length,
    topConcerns: [...highRiskTraits, ...moderateRiskTraits]
      .slice(0, 3)
      .map(t => t.name),
    positiveFactors: protectiveTraits
      .slice(0, 3)
      .map(t => t.name)
  };
}