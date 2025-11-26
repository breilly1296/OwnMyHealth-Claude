import type { 
  Biomarker, 
  DetectedCondition, 
  HealthcareProvider,
  ProviderRecommendation 
} from '../types';

// Comprehensive condition-to-specialist mapping with biomarker triggers
export const CONDITION_PROVIDER_MAPPING = {
  // Bone Health Conditions
  'Low Bone Density': {
    triggeringBiomarkers: ['Bone Mineral Density', 'T-Score', 'Z-Score', 'Vitamin D', 'Calcium'],
    biomarkerThresholds: {
      'Bone Mineral Density': { operator: '<', value: 1.0 },
      'T-Score': { operator: '<', value: -1.0 },
      'Z-Score': { operator: '<', value: -2.0 },
      'Vitamin D': { operator: '<', value: 30 },
      'Calcium': { operator: '<', value: 8.5 }
    },
    primarySpecialists: [
      {
        specialty: 'Endocrinology',
        reason: 'Hormone-related bone loss evaluation and treatment',
        urgency: 'routine',
        confidence: 0.9
      },
      {
        specialty: 'Rheumatology',
        reason: 'Osteoporosis management and bone health optimization',
        urgency: 'routine',
        confidence: 0.8
      }
    ],
    secondarySpecialists: [
      {
        specialty: 'Orthopedics',
        reason: 'Fracture risk assessment and prevention',
        urgency: 'routine',
        confidence: 0.6
      },
      {
        specialty: 'Internal Medicine',
        reason: 'Comprehensive bone health evaluation',
        urgency: 'routine',
        confidence: 0.7
      }
    ],
    requiredServices: [
      'DEXA Scan',
      'Vitamin D Level',
      'Calcium Level',
      'Parathyroid Hormone (PTH)',
      'Bone Turnover Markers'
    ]
  },

  // Metabolic Conditions
  'Insulin Resistance/Prediabetes': {
    triggeringBiomarkers: ['Glucose (Fasting)', 'Hemoglobin A1C', 'Insulin', 'HOMA-IR'],
    biomarkerThresholds: {
      'Glucose (Fasting)': { operator: '>=', value: 100 },
      'Hemoglobin A1C': { operator: '>=', value: 5.7 },
      'Insulin': { operator: '>=', value: 15 },
      'HOMA-IR': { operator: '>=', value: 2.5 }
    },
    primarySpecialists: [
      {
        specialty: 'Endocrinology',
        reason: 'Diabetes prevention and metabolic disorder management',
        urgency: 'urgent',
        confidence: 0.95
      }
    ],
    secondarySpecialists: [
      {
        specialty: 'Internal Medicine',
        reason: 'Comprehensive metabolic health assessment',
        urgency: 'routine',
        confidence: 0.8
      },
      {
        specialty: 'Nutrition/Dietitian',
        reason: 'Dietary intervention for glucose control',
        urgency: 'routine',
        confidence: 0.9
      }
    ],
    requiredServices: [
      'Glucose Tolerance Test',
      'Insulin Level',
      'Hemoglobin A1C',
      'Lipid Panel',
      'Microalbumin'
    ]
  },

  // Cardiovascular Risk
  'Cardiovascular Disease Risk': {
    triggeringBiomarkers: ['Total Cholesterol', 'LDL Cholesterol', 'HDL Cholesterol', 'Triglycerides', 'CRP', 'Blood Pressure (Systolic)', 'Homocysteine'],
    biomarkerThresholds: {
      'Total Cholesterol': { operator: '>=', value: 240 },
      'LDL Cholesterol': { operator: '>=', value: 160 },
      'HDL Cholesterol': { operator: '<', value: 40 },
      'Triglycerides': { operator: '>=', value: 200 },
      'CRP': { operator: '>=', value: 3.0 },
      'Blood Pressure (Systolic)': { operator: '>=', value: 140 },
      'Homocysteine': { operator: '>=', value: 15 }
    },
    primarySpecialists: [
      {
        specialty: 'Cardiology',
        reason: 'Cardiovascular risk assessment and prevention',
        urgency: 'urgent',
        confidence: 0.9
      }
    ],
    secondarySpecialists: [
      {
        specialty: 'Internal Medicine',
        reason: 'Comprehensive cardiovascular risk management',
        urgency: 'routine',
        confidence: 0.8
      },
      {
        specialty: 'Preventive Medicine',
        reason: 'Risk factor modification and lifestyle intervention',
        urgency: 'routine',
        confidence: 0.7
      }
    ],
    requiredServices: [
      'Echocardiogram',
      'Stress Test',
      'Carotid Ultrasound',
      'Ankle-Brachial Index',
      'Coronary Calcium Score'
    ]
  },

  // Thyroid Dysfunction
  'Thyroid Dysfunction': {
    triggeringBiomarkers: ['TSH', 'Free T4', 'Free T3', 'Reverse T3', 'Thyroid Antibodies'],
    biomarkerThresholds: {
      'TSH': { operator: 'outside', range: [0.4, 4.0] },
      'Free T4': { operator: 'outside', range: [0.7, 1.9] },
      'Free T3': { operator: 'outside', range: [2.0, 4.4] }
    },
    primarySpecialists: [
      {
        specialty: 'Endocrinology',
        reason: 'Thyroid hormone optimization and autoimmune evaluation',
        urgency: 'routine',
        confidence: 0.95
      }
    ],
    secondarySpecialists: [
      {
        specialty: 'Internal Medicine',
        reason: 'Initial thyroid function assessment',
        urgency: 'routine',
        confidence: 0.7
      }
    ],
    requiredServices: [
      'Thyroid Ultrasound',
      'Thyroid Antibodies',
      'Complete Thyroid Panel',
      'Thyroid Biopsy (if indicated)'
    ]
  },

  // Hormonal Imbalances
  'PCOS/Hormonal Imbalance': {
    triggeringBiomarkers: ['Testosterone (Total)', 'Free Testosterone', 'DHEA-S', 'LH', 'FSH', 'Insulin', 'AMH'],
    biomarkerThresholds: {
      'Testosterone (Total)': { operator: '>=', value: 70 }, // High for women
      'DHEA-S': { operator: '>=', value: 350 },
      'LH': { operator: '>=', value: 15 },
      'Insulin': { operator: '>=', value: 15 }
    },
    primarySpecialists: [
      {
        specialty: 'Reproductive Endocrinology',
        reason: 'PCOS diagnosis and fertility management',
        urgency: 'routine',
        confidence: 0.9
      },
      {
        specialty: 'Endocrinology',
        reason: 'Hormonal imbalance evaluation and metabolic management',
        urgency: 'routine',
        confidence: 0.85
      }
    ],
    secondarySpecialists: [
      {
        specialty: 'Gynecology',
        reason: 'Reproductive health and menstrual irregularities',
        urgency: 'routine',
        confidence: 0.8
      },
      {
        specialty: 'Dermatology',
        reason: 'Hormonal acne and hirsutism treatment',
        urgency: 'routine',
        confidence: 0.6
      }
    ],
    requiredServices: [
      'Pelvic Ultrasound',
      'Comprehensive Hormone Panel',
      'Glucose Tolerance Test',
      'Lipid Panel',
      'Anti-Müllerian Hormone (AMH)'
    ]
  },

  // Kidney Function Issues
  'Kidney Function Decline': {
    triggeringBiomarkers: ['Creatinine', 'BUN', 'eGFR', 'Uric Acid', 'Microalbumin', 'Cystatin C'],
    biomarkerThresholds: {
      'Creatinine': { operator: '>=', value: 1.3 },
      'BUN': { operator: '>=', value: 20 },
      'eGFR': { operator: '<', value: 90 },
      'Uric Acid': { operator: '>=', value: 7.2 }
    },
    primarySpecialists: [
      {
        specialty: 'Nephrology',
        reason: 'Kidney function evaluation and chronic kidney disease management',
        urgency: 'urgent',
        confidence: 0.9
      }
    ],
    secondarySpecialists: [
      {
        specialty: 'Internal Medicine',
        reason: 'Initial kidney function assessment',
        urgency: 'routine',
        confidence: 0.7
      },
      {
        specialty: 'Urology',
        reason: 'Structural kidney and urinary tract evaluation',
        urgency: 'routine',
        confidence: 0.6
      }
    ],
    requiredServices: [
      'Kidney Ultrasound',
      '24-Hour Urine Collection',
      'Kidney Biopsy (if indicated)',
      'Renal Doppler Study'
    ]
  },

  // Liver Function Issues
  'Liver Function Abnormalities': {
    triggeringBiomarkers: ['ALT', 'AST', 'Alkaline Phosphatase', 'Total Bilirubin', 'Albumin', 'GGT'],
    biomarkerThresholds: {
      'ALT': { operator: '>=', value: 55 },
      'AST': { operator: '>=', value: 48 },
      'Alkaline Phosphatase': { operator: '>=', value: 115 },
      'Total Bilirubin': { operator: '>=', value: 1.2 }
    },
    primarySpecialists: [
      {
        specialty: 'Hepatology',
        reason: 'Liver disease evaluation and management',
        urgency: 'urgent',
        confidence: 0.9
      },
      {
        specialty: 'Gastroenterology',
        reason: 'Digestive system and liver function assessment',
        urgency: 'routine',
        confidence: 0.85
      }
    ],
    secondarySpecialists: [
      {
        specialty: 'Internal Medicine',
        reason: 'Initial liver function evaluation',
        urgency: 'routine',
        confidence: 0.7
      }
    ],
    requiredServices: [
      'Liver Ultrasound',
      'Hepatitis Panel',
      'Liver Biopsy (if indicated)',
      'FibroScan',
      'Autoimmune Liver Panel'
    ]
  },

  // Inflammatory Conditions
  'Chronic Inflammation': {
    triggeringBiomarkers: ['CRP', 'ESR', 'Ferritin', 'IL-6', 'TNF-alpha'],
    biomarkerThresholds: {
      'CRP': { operator: '>=', value: 3.0 },
      'ESR': { operator: '>=', value: 22 },
      'Ferritin': { operator: '>=', value: 250 }
    },
    primarySpecialists: [
      {
        specialty: 'Rheumatology',
        reason: 'Autoimmune and inflammatory condition evaluation',
        urgency: 'routine',
        confidence: 0.8
      }
    ],
    secondarySpecialists: [
      {
        specialty: 'Internal Medicine',
        reason: 'Comprehensive inflammatory marker assessment',
        urgency: 'routine',
        confidence: 0.7
      },
      {
        specialty: 'Immunology',
        reason: 'Immune system dysfunction evaluation',
        urgency: 'routine',
        confidence: 0.6
      }
    ],
    requiredServices: [
      'Autoimmune Panel',
      'Complement Levels',
      'Immunoglobulin Levels',
      'Tissue Biopsy (if indicated)'
    ]
  },

  // Nutritional Deficiencies
  'Vitamin D Deficiency': {
    triggeringBiomarkers: ['Vitamin D', 'Calcium', 'Phosphate', 'PTH'],
    biomarkerThresholds: {
      'Vitamin D': { operator: '<', value: 30 },
      'Calcium': { operator: '<', value: 8.5 },
      'PTH': { operator: '>=', value: 65 }
    },
    primarySpecialists: [
      {
        specialty: 'Endocrinology',
        reason: 'Vitamin D metabolism and bone health optimization',
        urgency: 'routine',
        confidence: 0.8
      }
    ],
    secondarySpecialists: [
      {
        specialty: 'Internal Medicine',
        reason: 'Nutritional deficiency assessment and supplementation',
        urgency: 'routine',
        confidence: 0.9
      },
      {
        specialty: 'Nutrition/Dietitian',
        reason: 'Dietary optimization for vitamin D absorption',
        urgency: 'routine',
        confidence: 0.7
      }
    ],
    requiredServices: [
      'DEXA Scan',
      'Parathyroid Hormone',
      'Magnesium Level',
      'Vitamin K Level'
    ]
  },

  // Anemia/Blood Disorders
  'Anemia': {
    triggeringBiomarkers: ['Hemoglobin', 'Hematocrit', 'Iron', 'Ferritin', 'TIBC', 'Vitamin B12', 'Folate'],
    biomarkerThresholds: {
      'Hemoglobin': { operator: '<', value: 13.5 },
      'Hematocrit': { operator: '<', value: 38.8 },
      'Iron': { operator: '<', value: 60 },
      'Ferritin': { operator: '<', value: 20 }
    },
    primarySpecialists: [
      {
        specialty: 'Hematology',
        reason: 'Blood disorder evaluation and anemia management',
        urgency: 'routine',
        confidence: 0.9
      }
    ],
    secondarySpecialists: [
      {
        specialty: 'Internal Medicine',
        reason: 'Initial anemia workup and iron deficiency assessment',
        urgency: 'routine',
        confidence: 0.8
      },
      {
        specialty: 'Gastroenterology',
        reason: 'GI bleeding evaluation if iron deficiency anemia',
        urgency: 'routine',
        confidence: 0.6
      }
    ],
    requiredServices: [
      'Complete Blood Count with Differential',
      'Iron Studies',
      'Reticulocyte Count',
      'Peripheral Blood Smear',
      'Bone Marrow Biopsy (if indicated)'
    ]
  }
};

// Function to detect conditions based on biomarker values
export function detectConditionsFromBiomarkers(biomarkers: Biomarker[]): DetectedCondition[] {
  const detectedConditions: DetectedCondition[] = [];

  Object.entries(CONDITION_PROVIDER_MAPPING).forEach(([conditionName, mapping]) => {
    const relevantBiomarkers = biomarkers.filter(biomarker => 
      mapping.triggeringBiomarkers.includes(biomarker.name)
    );

    if (relevantBiomarkers.length === 0) return;

    let matchingBiomarkers = 0;
    let totalWeight = 0;
    const triggeringBiomarkers: Biomarker[] = [];

    relevantBiomarkers.forEach(biomarker => {
      const threshold = mapping.biomarkerThresholds[biomarker.name];
      if (!threshold) return;

      let isAbnormal = false;
      
      if (threshold.operator === '<') {
        isAbnormal = biomarker.value < threshold.value;
      } else if (threshold.operator === '>=') {
        isAbnormal = biomarker.value >= threshold.value;
      } else if (threshold.operator === 'outside' && threshold.range) {
        isAbnormal = biomarker.value < threshold.range[0] || biomarker.value > threshold.range[1];
      }

      if (isAbnormal) {
        matchingBiomarkers++;
        triggeringBiomarkers.push(biomarker);
        
        // Calculate severity based on how far outside normal range
        const deviation = calculateDeviation(biomarker, threshold);
        totalWeight += deviation;
      }
    });

    // Require at least 1 abnormal biomarker and calculate confidence
    if (matchingBiomarkers > 0) {
      const confidence = Math.min(
        0.3 + (matchingBiomarkers / mapping.triggeringBiomarkers.length) * 0.4 + 
        Math.min(totalWeight / matchingBiomarkers, 1) * 0.3,
        1.0
      );

      // Only include if confidence is reasonable
      if (confidence >= 0.4) {
        const severity = determineSeverity(totalWeight / matchingBiomarkers, matchingBiomarkers);
        
        detectedConditions.push({
          condition: {
            id: conditionName.toLowerCase().replace(/\s+/g, '-'),
            name: conditionName,
            description: `Detected based on ${matchingBiomarkers} abnormal biomarker(s)`,
            biomarkerIndicators: mapping.triggeringBiomarkers,
            requiredServices: mapping.requiredServices.map(service => ({
              id: service.toLowerCase().replace(/\s+/g, '-'),
              name: service,
              category: 'Diagnostic Test' as const,
              description: `${service} for ${conditionName} evaluation`,
              averageCost: 200,
              frequency: 'As needed' as const,
              urgency: 'routine' as const
            })),
            recommendedFrequency: {
              initial: 'Within 2-4 weeks',
              followUp: 'Every 3-6 months',
              monitoring: 'Every 6-12 months'
            },
            severity: severity,
            urgency: severity === 'severe' ? 'urgent' as const : 'routine' as const
          },
          confidence,
          triggeringBiomarkers,
          severity,
          riskFactors: generateRiskFactors(conditionName, triggeringBiomarkers)
        });
      }
    }
  });

  return detectedConditions.sort((a, b) => b.confidence - a.confidence);
}

// Function to get specialist recommendations based on detected conditions
export function getSpecialistRecommendations(
  detectedConditions: DetectedCondition[]
): ProviderRecommendation[] {
  const recommendations: ProviderRecommendation[] = [];
  const specialtyMap = new Map<string, ProviderRecommendation>();

  detectedConditions.forEach(detectedCondition => {
    const conditionName = detectedCondition.condition.name;
    const mapping = CONDITION_PROVIDER_MAPPING[conditionName];
    
    if (!mapping) return;

    // Add primary specialists
    mapping.primarySpecialists.forEach(specialist => {
      const key = specialist.specialty;
      const existingRec = specialtyMap.get(key);
      
      if (!existingRec || specialist.confidence > existingRec.confidence) {
        specialtyMap.set(key, {
          specialty: specialist.specialty,
          reason: `${specialist.reason} (${conditionName})`,
          urgency: detectedCondition.severity === 'severe' ? 'urgent' : specialist.urgency,
          expectedCosts: {
            consultation: getSpecialtyCost(specialist.specialty, 'consultation'),
            followUp: getSpecialtyCost(specialist.specialty, 'followUp'),
            diagnostics: getSpecialtyCost(specialist.specialty, 'diagnostics')
          },
          insuranceCoverage: [], // Will be populated with actual insurance data
          timeframe: getTimeframe(detectedCondition.severity, specialist.urgency),
          confidence: specialist.confidence * detectedCondition.confidence,
          relatedConditions: [conditionName],
          requiredServices: mapping.requiredServices
        });
      } else if (existingRec) {
        // Merge conditions for existing specialty
        existingRec.relatedConditions.push(conditionName);
        existingRec.reason += `, ${specialist.reason}`;
      }
    });

    // Add secondary specialists if condition is severe or primary specialists are limited
    if (detectedCondition.severity === 'severe' || mapping.primarySpecialists.length < 2) {
      mapping.secondarySpecialists.forEach(specialist => {
        const key = specialist.specialty;
        if (!specialtyMap.has(key)) {
          specialtyMap.set(key, {
            specialty: specialist.specialty,
            reason: `${specialist.reason} (${conditionName})`,
            urgency: specialist.urgency,
            expectedCosts: {
              consultation: getSpecialtyCost(specialist.specialty, 'consultation'),
              followUp: getSpecialtyCost(specialist.specialty, 'followUp'),
              diagnostics: getSpecialtyCost(specialist.specialty, 'diagnostics')
            },
            insuranceCoverage: [],
            timeframe: getTimeframe(detectedCondition.severity, specialist.urgency),
            confidence: specialist.confidence * detectedCondition.confidence * 0.8, // Lower confidence for secondary
            relatedConditions: [conditionName],
            requiredServices: mapping.requiredServices
          });
        }
      });
    }
  });

  return Array.from(specialtyMap.values())
    .sort((a, b) => {
      // Sort by urgency first, then confidence
      const urgencyOrder = { urgent: 3, routine: 2, preventive: 1 };
      const urgencyDiff = urgencyOrder[b.urgency] - urgencyOrder[a.urgency];
      if (urgencyDiff !== 0) return urgencyDiff;
      return (b.confidence || 0) - (a.confidence || 0);
    });
}

// Helper functions
function calculateDeviation(biomarker: Biomarker, threshold: any): number {
  if (threshold.operator === '<') {
    const normalMin = biomarker.normalRange.min;
    return Math.max(0, (normalMin - biomarker.value) / normalMin);
  } else if (threshold.operator === '>=') {
    const normalMax = biomarker.normalRange.max;
    return Math.max(0, (biomarker.value - normalMax) / normalMax);
  } else if (threshold.operator === 'outside' && threshold.range) {
    const [min, max] = threshold.range;
    if (biomarker.value < min) {
      return (min - biomarker.value) / min;
    } else if (biomarker.value > max) {
      return (biomarker.value - max) / max;
    }
  }
  return 0;
}

function determineSeverity(averageDeviation: number, abnormalCount: number): 'mild' | 'moderate' | 'severe' {
  if (averageDeviation > 0.5 || abnormalCount >= 3) return 'severe';
  if (averageDeviation > 0.2 || abnormalCount >= 2) return 'moderate';
  return 'mild';
}

function generateRiskFactors(conditionName: string, biomarkers: Biomarker[]): string[] {
  const riskFactors: string[] = [];
  
  // Add biomarker-specific risk factors
  biomarkers.forEach(biomarker => {
    if (biomarker.name.includes('Cholesterol')) {
      riskFactors.push('cardiovascular disease', 'atherosclerosis');
    } else if (biomarker.name.includes('Glucose')) {
      riskFactors.push('diabetes', 'metabolic syndrome');
    } else if (biomarker.name.includes('Bone')) {
      riskFactors.push('osteoporosis', 'fracture risk');
    } else if (biomarker.name.includes('Testosterone')) {
      riskFactors.push('PCOS', 'insulin resistance');
    }
  });

  // Add condition-specific risk factors
  if (conditionName.includes('Cardiovascular')) {
    riskFactors.push('heart attack', 'stroke', 'peripheral artery disease');
  } else if (conditionName.includes('Bone')) {
    riskFactors.push('fractures', 'mobility issues', 'falls');
  } else if (conditionName.includes('Diabetes')) {
    riskFactors.push('neuropathy', 'retinopathy', 'nephropathy');
  }

  return [...new Set(riskFactors)]; // Remove duplicates
}

function getSpecialtyCost(specialty: string, type: 'consultation' | 'followUp' | 'diagnostics'): number {
  const baseCosts = {
    'Endocrinology': { consultation: 350, followUp: 200, diagnostics: 300 },
    'Cardiology': { consultation: 400, followUp: 250, diagnostics: 500 },
    'Rheumatology': { consultation: 380, followUp: 220, diagnostics: 350 },
    'Nephrology': { consultation: 370, followUp: 210, diagnostics: 400 },
    'Hepatology': { consultation: 390, followUp: 230, diagnostics: 450 },
    'Hematology': { consultation: 360, followUp: 200, diagnostics: 300 },
    'Reproductive Endocrinology': { consultation: 400, followUp: 250, diagnostics: 350 },
    'Gynecology': { consultation: 300, followUp: 180, diagnostics: 250 },
    'Internal Medicine': { consultation: 250, followUp: 150, diagnostics: 200 },
    'Nutrition/Dietitian': { consultation: 150, followUp: 100, diagnostics: 50 }
  };

  return baseCosts[specialty]?.[type] || baseCosts['Internal Medicine'][type];
}

function getTimeframe(severity: 'mild' | 'moderate' | 'severe', urgency: string): string {
  if (severity === 'severe') return 'Within 1-2 weeks';
  if (urgency === 'urgent') return 'Within 2-3 weeks';
  if (severity === 'moderate') return 'Within 1 month';
  return 'Within 2-3 months';
}

// Extended provider recommendation interface
interface ExtendedProviderRecommendation extends ProviderRecommendation {
  confidence?: number;
  relatedConditions: string[];
  requiredServices: string[];
}