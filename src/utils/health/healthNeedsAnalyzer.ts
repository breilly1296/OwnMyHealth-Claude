import type {
  Biomarker,
  RiskAssessment,
  InsurancePlan,
  InsuranceBenefit,
  HealthNeedsAnalysis,
  HealthCondition,
  MedicalService,
  DetectedCondition,
  RecommendedService,
  ServiceCoverage,
  CostEstimate,
  PriorityAction,
  PreventiveRecommendation
} from '../../types';

// Health conditions database with biomarker indicators
const HEALTH_CONDITIONS: HealthCondition[] = [
  {
    id: 'pcos',
    name: 'Polycystic Ovary Syndrome (PCOS)',
    description: 'Hormonal disorder affecting women of reproductive age',
    biomarkerIndicators: ['Testosterone (Total)', 'LH', 'FSH', 'Insulin', 'Glucose (Fasting)', 'DHEA-S'],
    requiredServices: [
      {
        id: 'endocrinology-visit',
        name: 'Endocrinology Consultation',
        category: 'Specialist Visit',
        description: 'Specialist evaluation for hormonal disorders',
        averageCost: 350,
        frequency: 'Bi-annual',
        urgency: 'follow-up',
        specialistType: 'Endocrinologist'
      },
      {
        id: 'hormone-panel',
        name: 'Comprehensive Hormone Panel',
        category: 'Lab Test',
        description: 'Testing for reproductive and metabolic hormones',
        averageCost: 250,
        frequency: 'Quarterly',
        urgency: 'routine'
      },
      {
        id: 'pelvic-ultrasound',
        name: 'Pelvic Ultrasound',
        category: 'Imaging',
        description: 'Imaging to assess ovarian morphology',
        averageCost: 300,
        frequency: 'Annual',
        urgency: 'routine'
      },
      {
        id: 'glucose-tolerance-test',
        name: 'Glucose Tolerance Test',
        category: 'Diagnostic Test',
        description: 'Assessment of insulin resistance',
        averageCost: 150,
        frequency: 'Annual',
        urgency: 'routine'
      }
    ],
    recommendedFrequency: {
      initial: 'Within 2-4 weeks',
      followUp: 'Every 3-6 months',
      monitoring: 'Every 6-12 months'
    },
    severity: 'moderate',
    urgency: 'follow-up'
  },
  {
    id: 'diabetes-prediabetes',
    name: 'Diabetes/Prediabetes',
    description: 'Elevated blood glucose levels indicating diabetes risk',
    biomarkerIndicators: ['Glucose (Fasting)', 'Hemoglobin A1C', 'Insulin'],
    requiredServices: [
      {
        id: 'endocrinology-diabetes',
        name: 'Diabetes Specialist Consultation',
        category: 'Specialist Visit',
        description: 'Endocrinologist specializing in diabetes management',
        averageCost: 300,
        frequency: 'Quarterly',
        urgency: 'urgent',
        specialistType: 'Endocrinologist'
      },
      {
        id: 'diabetes-panel',
        name: 'Diabetes Monitoring Panel',
        category: 'Lab Test',
        description: 'Comprehensive glucose and diabetes markers',
        averageCost: 180,
        frequency: 'Quarterly',
        urgency: 'routine'
      },
      {
        id: 'diabetes-education',
        name: 'Diabetes Education Program',
        category: 'Therapy',
        description: 'Educational program for diabetes management',
        averageCost: 200,
        frequency: 'One-time',
        urgency: 'follow-up'
      },
      {
        id: 'nutritionist-consultation',
        name: 'Nutritionist Consultation',
        category: 'Specialist Visit',
        description: 'Dietary counseling for diabetes management',
        averageCost: 150,
        frequency: 'Quarterly',
        urgency: 'follow-up',
        specialistType: 'Nutritionist'
      }
    ],
    recommendedFrequency: {
      initial: 'Within 1-2 weeks',
      followUp: 'Every 3 months',
      monitoring: 'Every 3-6 months'
    },
    severity: 'severe',
    urgency: 'urgent'
  },
  {
    id: 'thyroid-dysfunction',
    name: 'Thyroid Dysfunction',
    description: 'Abnormal thyroid hormone levels',
    biomarkerIndicators: ['TSH', 'Free T4', 'Free T3', 'Thyroid Antibodies'],
    requiredServices: [
      {
        id: 'endocrinology-thyroid',
        name: 'Thyroid Specialist Consultation',
        category: 'Specialist Visit',
        description: 'Endocrinologist specializing in thyroid disorders',
        averageCost: 320,
        frequency: 'Bi-annual',
        urgency: 'follow-up',
        specialistType: 'Endocrinologist'
      },
      {
        id: 'thyroid-panel',
        name: 'Complete Thyroid Panel',
        category: 'Lab Test',
        description: 'Comprehensive thyroid function testing',
        averageCost: 200,
        frequency: 'Bi-annual',
        urgency: 'routine'
      },
      {
        id: 'thyroid-ultrasound',
        name: 'Thyroid Ultrasound',
        category: 'Imaging',
        description: 'Imaging assessment of thyroid structure',
        averageCost: 250,
        frequency: 'Annual',
        urgency: 'routine'
      }
    ],
    recommendedFrequency: {
      initial: 'Within 2-3 weeks',
      followUp: 'Every 6 months',
      monitoring: 'Every 6-12 months'
    },
    severity: 'moderate',
    urgency: 'follow-up'
  },
  {
    id: 'cardiovascular-risk',
    name: 'Cardiovascular Disease Risk',
    description: 'Elevated risk factors for heart disease',
    biomarkerIndicators: ['Total Cholesterol', 'LDL Cholesterol', 'HDL Cholesterol', 'Triglycerides', 'CRP', 'Blood Pressure (Systolic)'],
    requiredServices: [
      {
        id: 'cardiology-consultation',
        name: 'Cardiology Consultation',
        category: 'Specialist Visit',
        description: 'Cardiovascular risk assessment and management',
        averageCost: 400,
        frequency: 'Annual',
        urgency: 'urgent',
        specialistType: 'Cardiologist'
      },
      {
        id: 'lipid-panel',
        name: 'Comprehensive Lipid Panel',
        category: 'Lab Test',
        description: 'Complete cholesterol and lipid assessment',
        averageCost: 120,
        frequency: 'Quarterly',
        urgency: 'routine'
      },
      {
        id: 'echocardiogram',
        name: 'Echocardiogram',
        category: 'Imaging',
        description: 'Heart structure and function assessment',
        averageCost: 500,
        frequency: 'Annual',
        urgency: 'routine'
      },
      {
        id: 'stress-test',
        name: 'Cardiac Stress Test',
        category: 'Diagnostic Test',
        description: 'Exercise or pharmacological stress testing',
        averageCost: 600,
        frequency: 'Annual',
        urgency: 'follow-up'
      }
    ],
    recommendedFrequency: {
      initial: 'Within 1-2 weeks',
      followUp: 'Every 3-6 months',
      monitoring: 'Every 6-12 months'
    },
    severity: 'severe',
    urgency: 'urgent'
  },
  {
    id: 'vitamin-d-deficiency',
    name: 'Vitamin D Deficiency',
    description: 'Insufficient vitamin D levels',
    biomarkerIndicators: ['Vitamin D'],
    requiredServices: [
      {
        id: 'primary-care-vitamin-d',
        name: 'Primary Care Follow-up',
        category: 'Specialist Visit',
        description: 'Primary care management of vitamin D deficiency',
        averageCost: 200,
        frequency: 'Bi-annual',
        urgency: 'routine',
        specialistType: 'Primary Care Physician'
      },
      {
        id: 'vitamin-d-monitoring',
        name: 'Vitamin D Level Monitoring',
        category: 'Lab Test',
        description: 'Regular monitoring of vitamin D levels',
        averageCost: 80,
        frequency: 'Quarterly',
        urgency: 'routine'
      },
      {
        id: 'bone-density-scan',
        name: 'Bone Density Scan (DEXA)',
        category: 'Imaging',
        description: 'Assessment of bone health',
        averageCost: 300,
        frequency: 'Annual',
        urgency: 'routine'
      }
    ],
    recommendedFrequency: {
      initial: 'Within 2-4 weeks',
      followUp: 'Every 3 months',
      monitoring: 'Every 6 months'
    },
    severity: 'mild',
    urgency: 'routine'
  },
  {
    id: 'chronic-inflammation',
    name: 'Chronic Inflammation',
    description: 'Elevated inflammatory markers',
    biomarkerIndicators: ['CRP', 'ESR', 'Ferritin'],
    requiredServices: [
      {
        id: 'rheumatology-consultation',
        name: 'Rheumatology Consultation',
        category: 'Specialist Visit',
        description: 'Evaluation for autoimmune and inflammatory conditions',
        averageCost: 380,
        frequency: 'Bi-annual',
        urgency: 'follow-up',
        specialistType: 'Rheumatologist'
      },
      {
        id: 'inflammatory-panel',
        name: 'Comprehensive Inflammatory Panel',
        category: 'Lab Test',
        description: 'Testing for inflammatory and autoimmune markers',
        averageCost: 300,
        frequency: 'Quarterly',
        urgency: 'routine'
      },
      {
        id: 'autoimmune-screening',
        name: 'Autoimmune Antibody Screening',
        category: 'Lab Test',
        description: 'Testing for autoimmune conditions',
        averageCost: 400,
        frequency: 'Annual',
        urgency: 'routine'
      }
    ],
    recommendedFrequency: {
      initial: 'Within 2-3 weeks',
      followUp: 'Every 3-6 months',
      monitoring: 'Every 6 months'
    },
    severity: 'moderate',
    urgency: 'follow-up'
  }
];

// Preventive care recommendations based on age and risk factors
const PREVENTIVE_RECOMMENDATIONS: PreventiveRecommendation[] = [
  {
    id: 'annual-physical',
    title: 'Annual Physical Examination',
    description: 'Comprehensive yearly health assessment',
    category: 'Screening',
    frequency: 'Annual',
    riskFactors: ['General health maintenance'],
    estimatedCost: 250,
    insuranceCoverage: 'Typically Covered'
  },
  {
    id: 'mammogram',
    title: 'Mammogram Screening',
    description: 'Breast cancer screening',
    category: 'Screening',
    frequency: 'Annual',
    ageRecommendation: '40+ years',
    riskFactors: ['Family history of breast cancer', 'Age over 40'],
    estimatedCost: 300,
    insuranceCoverage: 'Typically Covered'
  },
  {
    id: 'colonoscopy',
    title: 'Colonoscopy Screening',
    description: 'Colorectal cancer screening',
    category: 'Screening',
    frequency: 'Every 10 years',
    ageRecommendation: '45+ years',
    riskFactors: ['Family history of colorectal cancer', 'Age over 45'],
    estimatedCost: 1200,
    insuranceCoverage: 'Typically Covered'
  },
  {
    id: 'bone-density',
    title: 'Bone Density Screening',
    description: 'Osteoporosis screening',
    category: 'Screening',
    frequency: 'Every 2 years',
    ageRecommendation: '65+ years (women), 70+ years (men)',
    riskFactors: ['Postmenopausal', 'Low vitamin D', 'Family history of osteoporosis'],
    estimatedCost: 300,
    insuranceCoverage: 'Typically Covered'
  }
];

export function detectHealthConditions(
  biomarkers: Biomarker[], 
  riskAssessments: RiskAssessment[]
): DetectedCondition[] {
  const detectedConditions: DetectedCondition[] = [];

  HEALTH_CONDITIONS.forEach(condition => {
    const relevantBiomarkers = biomarkers.filter(biomarker => 
      condition.biomarkerIndicators.some(indicator => 
        biomarker.name.toLowerCase().includes(indicator.toLowerCase()) ||
        indicator.toLowerCase().includes(biomarker.name.toLowerCase())
      )
    );

    if (relevantBiomarkers.length === 0) return;

    // Calculate confidence based on number of matching biomarkers and their risk levels
    const matchingRisks = riskAssessments.filter(risk => 
      relevantBiomarkers.some(biomarker => biomarker.id === risk.biomarkerId)
    );

    const highRiskCount = matchingRisks.filter(r => r.riskLevel === 'high' || r.riskLevel === 'critical').length;
    const moderateRiskCount = matchingRisks.filter(r => r.riskLevel === 'moderate').length;
    
    let confidence = 0;
    let severity: DetectedCondition['severity'] = 'mild';

    // Calculate confidence based on biomarker matches and risk levels
    const biomarkerMatchRatio = relevantBiomarkers.length / condition.biomarkerIndicators.length;
    confidence = biomarkerMatchRatio * 0.6; // Base confidence from biomarker matches

    if (highRiskCount > 0) {
      confidence += 0.3;
      severity = 'severe';
    } else if (moderateRiskCount > 0) {
      confidence += 0.2;
      severity = 'moderate';
    } else {
      confidence += 0.1;
    }

    // Only include conditions with reasonable confidence
    if (confidence >= 0.4) {
      const riskFactors = matchingRisks.flatMap(r => r.riskFactors);
      
      detectedConditions.push({
        condition,
        confidence,
        triggeringBiomarkers: relevantBiomarkers,
        severity,
        riskFactors: [...new Set(riskFactors)] // Remove duplicates
      });
    }
  });

  return detectedConditions.sort((a, b) => b.confidence - a.confidence);
}

export function generateRecommendedServices(detectedConditions: DetectedCondition[]): RecommendedService[] {
  const serviceMap = new Map<string, RecommendedService>();

  detectedConditions.forEach(detectedCondition => {
    const { condition, severity } = detectedCondition;
    
    condition.requiredServices.forEach(service => {
      const existingService = serviceMap.get(service.id);
      
      if (existingService) {
        // Update existing service with higher urgency if needed
        if (getUrgencyPriority(service.urgency) > getUrgencyPriority(existingService.urgency)) {
          existingService.urgency = service.urgency;
        }
        existingService.relatedConditions.push(condition.name);
      } else {
        const recommendedService: RecommendedService = {
          service,
          reason: `Recommended for ${condition.name} management`,
          urgency: severity === 'severe' ? 'urgent' : severity === 'moderate' ? 'follow-up' : 'routine',
          estimatedCost: service.averageCost,
          frequency: service.frequency,
          relatedConditions: [condition.name]
        };
        
        serviceMap.set(service.id, recommendedService);
      }
    });
  });

  return Array.from(serviceMap.values()).sort((a, b) => 
    getUrgencyPriority(b.urgency) - getUrgencyPriority(a.urgency)
  );
}

function getUrgencyPriority(urgency: string): number {
  switch (urgency) {
    case 'immediate': return 4;
    case 'urgent': return 3;
    case 'follow-up': return 2;
    case 'routine': return 1;
    default: return 0;
  }
}

export function analyzeInsuranceCoverage(
  recommendedServices: RecommendedService[],
  insurancePlans: InsurancePlan[]
): ServiceCoverage[] {
  return recommendedServices.map(recommendedService => {
    const { service } = recommendedService;
    
    const planCoverage = insurancePlans.map(plan => {
      // Find matching benefits in the insurance plan
      const matchingBenefits = plan.benefits.filter(benefit => 
        isServiceCovered(service, benefit)
      );

      if (matchingBenefits.length === 0) {
        return {
          planId: plan.id,
          planName: plan.planName,
          covered: false,
          deductibleApplies: true,
          priorAuthRequired: false,
          referralRequired: false,
          estimatedOutOfPocket: service.averageCost
        };
      }

      // Use the best matching benefit
      const bestBenefit = matchingBenefits[0];
      const coverage = bestBenefit.inNetworkCoverage;
      
      let estimatedOutOfPocket = 0;
      
      if (coverage.copay) {
        estimatedOutOfPocket = coverage.copay;
      } else if (coverage.coinsurance) {
        estimatedOutOfPocket = service.averageCost * (coverage.coinsurance / 100);
      } else if (coverage.coveragePercentage) {
        estimatedOutOfPocket = service.averageCost * ((100 - coverage.coveragePercentage) / 100);
      }

      return {
        planId: plan.id,
        planName: plan.planName,
        covered: coverage.covered,
        copay: coverage.copay,
        coinsurance: coverage.coinsurance,
        deductibleApplies: coverage.deductible !== undefined,
        priorAuthRequired: bestBenefit.priorAuthRequired || false,
        referralRequired: bestBenefit.referralRequired || false,
        estimatedOutOfPocket
      };
    });

    // Find the best coverage option
    const bestCoverage = planCoverage
      .filter(p => p.covered)
      .sort((a, b) => a.estimatedOutOfPocket - b.estimatedOutOfPocket)[0];

    return {
      serviceId: service.id,
      serviceName: service.name,
      planCoverage,
      bestCoverage: bestCoverage ? {
        planId: bestCoverage.planId,
        estimatedCost: bestCoverage.estimatedOutOfPocket
      } : undefined
    };
  });
}

function isServiceCovered(service: MedicalService, benefit: InsuranceBenefit): boolean {
  const serviceCategory = service.category.toLowerCase();
  const benefitCategory = benefit.category.toLowerCase();
  const serviceName = service.name.toLowerCase();
  const benefitName = benefit.serviceName.toLowerCase();

  // Direct category match
  if (serviceCategory.includes(benefitCategory) || benefitCategory.includes(serviceCategory)) {
    return true;
  }

  // Specific service name matches
  if (serviceName.includes(benefitName) || benefitName.includes(serviceName)) {
    return true;
  }

  // Specialist visit matching
  if (service.category === 'Specialist Visit' && benefit.category === 'Specialist Care') {
    return true;
  }

  // Lab test matching
  if (service.category === 'Lab Test' && (benefit.category === 'Lab Tests' || benefit.category === 'Diagnostic Tests')) {
    return true;
  }

  // Imaging matching
  if (service.category === 'Imaging' && benefit.category === 'Imaging') {
    return true;
  }

  return false;
}

export function calculateCostEstimates(
  recommendedServices: RecommendedService[],
  serviceCoverage: ServiceCoverage[]
): CostEstimate[] {
  return recommendedServices.map(recommendedService => {
    const { service } = recommendedService;
    const coverage = serviceCoverage.find(sc => sc.serviceId === service.id);
    
    // Calculate annual frequency multiplier
    const frequencyMultiplier = getAnnualFrequencyMultiplier(service.frequency);
    const annualEstimate = service.averageCost * frequencyMultiplier;

    const planComparison = coverage?.planCoverage.map(planCov => {
      const annualCost = planCov.estimatedOutOfPocket * frequencyMultiplier;
      const savings = annualEstimate - annualCost;
      
      return {
        planId: planCov.planId,
        planName: planCov.planName,
        estimatedAnnualCost: annualCost,
        savings: savings > 0 ? savings : undefined
      };
    }) || [];

    return {
      serviceId: service.id,
      serviceName: service.name,
      frequency: service.frequency,
      annualEstimate,
      planComparison
    };
  });
}

function getAnnualFrequencyMultiplier(frequency: string): number {
  switch (frequency.toLowerCase()) {
    case 'monthly': return 12;
    case 'quarterly': return 4;
    case 'bi-annual': return 2;
    case 'annual': return 1;
    case 'one-time': return 1;
    case 'as needed': return 2; // Estimate
    default: return 1;
  }
}

export function generatePriorityActions(
  detectedConditions: DetectedCondition[],
  recommendedServices: RecommendedService[],
  serviceCoverage: ServiceCoverage[]
): PriorityAction[] {
  const actions: PriorityAction[] = [];

  // Medical care actions
  const urgentServices = recommendedServices.filter(s => s.urgency === 'urgent' || s.urgency === 'immediate');
  if (urgentServices.length > 0) {
    actions.push({
      id: 'urgent-medical-care',
      title: 'Schedule Urgent Medical Appointments',
      description: `You have ${urgentServices.length} urgent medical service(s) that need immediate attention.`,
      urgency: 'urgent',
      category: 'Medical Care',
      relatedServices: urgentServices.map(s => s.service.id),
      timeframe: 'Within 1-2 weeks'
    });
  }

  // Insurance optimization actions
  const uncoveredServices = serviceCoverage.filter(sc => 
    sc.planCoverage.every(pc => !pc.covered)
  );
  
  if (uncoveredServices.length > 0) {
    actions.push({
      id: 'insurance-coverage-review',
      title: 'Review Insurance Coverage',
      description: `${uncoveredServices.length} recommended service(s) may not be covered by your current plan(s).`,
      urgency: 'follow-up',
      category: 'Insurance',
      relatedServices: uncoveredServices.map(s => s.serviceId),
      timeframe: 'Within 2-4 weeks'
    });
  }

  // Lifestyle actions for detected conditions
  const severeConditions = detectedConditions.filter(dc => dc.severity === 'severe');
  if (severeConditions.length > 0) {
    actions.push({
      id: 'lifestyle-modifications',
      title: 'Implement Lifestyle Changes',
      description: 'Your health data suggests immediate lifestyle modifications could significantly improve your health outcomes.',
      urgency: 'urgent',
      category: 'Lifestyle',
      relatedServices: [],
      timeframe: 'Start immediately'
    });
  }

  // Monitoring actions
  const monitoringServices = recommendedServices.filter(s => 
    s.service.category === 'Lab Test' || s.service.category === 'Diagnostic Test'
  );
  
  if (monitoringServices.length > 0) {
    actions.push({
      id: 'establish-monitoring',
      title: 'Establish Regular Health Monitoring',
      description: 'Set up regular testing schedule to track your health conditions.',
      urgency: 'routine',
      category: 'Monitoring',
      relatedServices: monitoringServices.map(s => s.service.id),
      timeframe: 'Within 4-6 weeks'
    });
  }

  return actions.sort((a, b) => getUrgencyPriority(b.urgency) - getUrgencyPriority(a.urgency));
}

export function analyzeHealthNeeds(
  biomarkers: Biomarker[],
  riskAssessments: RiskAssessment[],
  insurancePlans: InsurancePlan[]
): HealthNeedsAnalysis {
  // Step 1: Detect health conditions based on biomarkers
  const detectedConditions = detectHealthConditions(biomarkers, riskAssessments);
  
  // Step 2: Generate recommended services
  const recommendedServices = generateRecommendedServices(detectedConditions);
  
  // Step 3: Analyze insurance coverage for recommended services
  const insuranceCoverage = analyzeInsuranceCoverage(recommendedServices, insurancePlans);
  
  // Step 4: Calculate cost estimates
  const estimatedCosts = calculateCostEstimates(recommendedServices, insuranceCoverage);
  
  // Step 5: Generate priority actions
  const priorityActions = generatePriorityActions(detectedConditions, recommendedServices, insuranceCoverage);
  
  // Step 6: Add preventive recommendations
  const preventiveRecommendations = PREVENTIVE_RECOMMENDATIONS;

  return {
    detectedConditions,
    recommendedServices,
    insuranceCoverage,
    estimatedCosts,
    priorityActions,
    preventiveRecommendations
  };
}