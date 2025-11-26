import type { 
  Biomarker, 
  InsurancePlan, 
  HealthNeedsAnalysis,
  InsuranceTermExplanation,
  InsuranceEducationModule,
  InsuranceScenario,
  CostBreakdownItem,
  PersonalizedInsuranceGuide,
  AnnualCostProjection,
  InsuranceOptimizationTip
} from '../types';

// Core insurance terms with contextual explanations
const INSURANCE_TERMS: Record<string, Omit<InsuranceTermExplanation, 'userSpecificExample'>> = {
  deductible: {
    term: 'Deductible',
    definition: 'The amount you pay out-of-pocket before your insurance starts covering costs.',
    contextualExample: 'If you have a $2,000 deductible, you pay the first $2,000 of medical bills each year, then insurance kicks in.',
    relatedTerms: ['Out-of-Pocket Maximum', 'Coinsurance', 'Copay'],
    tips: [
      'Higher deductibles usually mean lower monthly premiums',
      'Preventive care is often covered before meeting your deductible',
      'HSA-eligible plans typically have higher deductibles but tax advantages'
    ],
    commonMisconceptions: [
      'Copays don\'t always count toward your deductible',
      'You don\'t pay the deductible upfront - it\'s cumulative throughout the year',
      'Emergency room visits may have separate deductibles'
    ]
  },
  copay: {
    term: 'Copay',
    definition: 'A fixed amount you pay for specific services, like doctor visits or prescriptions.',
    contextualExample: 'A $30 copay means you pay $30 for a doctor visit, regardless of the actual cost.',
    relatedTerms: ['Coinsurance', 'Deductible', 'Premium'],
    tips: [
      'Copays are usually due at the time of service',
      'Specialist copays are typically higher than primary care',
      'Some plans have different copays for generic vs. brand-name drugs'
    ],
    commonMisconceptions: [
      'Copays and coinsurance are not the same thing',
      'Having a copay doesn\'t mean you won\'t have other costs',
      'Copays may not count toward your deductible on some plans'
    ]
  },
  coinsurance: {
    term: 'Coinsurance',
    definition: 'The percentage of costs you pay after meeting your deductible.',
    contextualExample: 'With 20% coinsurance, if a procedure costs $1,000 after your deductible, you pay $200 and insurance pays $800.',
    relatedTerms: ['Deductible', 'Out-of-Pocket Maximum', 'Copay'],
    tips: [
      'Lower coinsurance percentages mean you pay less',
      'Coinsurance applies until you reach your out-of-pocket maximum',
      'In-network providers typically have lower coinsurance rates'
    ],
    commonMisconceptions: [
      'Coinsurance is not a fixed dollar amount like copays',
      'You don\'t pay coinsurance until after meeting your deductible',
      'Coinsurance rates can vary by service type'
    ]
  },
  outOfPocketMaximum: {
    term: 'Out-of-Pocket Maximum',
    definition: 'The most you\'ll pay for covered services in a year. After this, insurance pays 100%.',
    contextualExample: 'With a $6,000 out-of-pocket max, once you\'ve paid $6,000 in deductibles, copays, and coinsurance, insurance covers everything else.',
    relatedTerms: ['Deductible', 'Coinsurance', 'Copay'],
    tips: [
      'This is your financial safety net for major medical expenses',
      'Premiums don\'t count toward your out-of-pocket maximum',
      'Out-of-network costs may not count toward this limit'
    ],
    commonMisconceptions: [
      'The out-of-pocket max is not the same as your deductible',
      'Not all costs count toward this maximum',
      'Family plans have both individual and family maximums'
    ]
  },
  premium: {
    term: 'Premium',
    definition: 'The monthly amount you pay for your insurance coverage.',
    contextualExample: 'A $400 monthly premium means you pay $4,800 per year just to have insurance, regardless of whether you use it.',
    relatedTerms: ['Deductible', 'Coverage', 'Network'],
    tips: [
      'You pay premiums even if you don\'t use medical services',
      'Higher premiums often mean lower deductibles and copays',
      'Employer contributions can significantly reduce your premium costs'
    ],
    commonMisconceptions: [
      'Paying premiums doesn\'t guarantee free medical care',
      'Premium costs don\'t count toward deductibles or out-of-pocket maximums',
      'Missing premium payments can result in coverage cancellation'
    ]
  },
  network: {
    term: 'Provider Network',
    definition: 'The group of doctors, hospitals, and other healthcare providers that have contracts with your insurance.',
    contextualExample: 'In-network providers have agreed to accept lower payments from your insurance, resulting in lower costs for you.',
    relatedTerms: ['In-Network', 'Out-of-Network', 'Referral'],
    tips: [
      'Always verify a provider is in-network before scheduling',
      'Emergency care is typically covered at in-network rates regardless of hospital',
      'Networks can change, so check annually during open enrollment'
    ],
    commonMisconceptions: [
      'All doctors at an in-network hospital are not necessarily in-network',
      'Being in-network doesn\'t guarantee the lowest possible cost',
      'You can\'t always see any specialist without a referral, even in-network'
    ]
  },
  priorAuthorization: {
    term: 'Prior Authorization',
    definition: 'Approval from your insurance company required before certain services or medications are covered.',
    contextualExample: 'Your doctor must get approval before ordering an MRI to ensure insurance will cover the cost.',
    relatedTerms: ['Formulary', 'Network', 'Coverage'],
    tips: [
      'Prior auth can take several days to weeks to process',
      'Your doctor\'s office typically handles the prior auth process',
      'Emergency services usually don\'t require prior authorization'
    ],
    commonMisconceptions: [
      'Prior auth doesn\'t guarantee the service will be covered',
      'You can\'t get prior auth for services you\'ve already received',
      'Prior auth requirements can change during the plan year'
    ]
  },
  formulary: {
    term: 'Formulary',
    definition: 'The list of prescription drugs covered by your insurance plan.',
    contextualExample: 'If your medication is on the formulary, you\'ll pay less. If not, you might pay full price or need prior authorization.',
    relatedTerms: ['Prior Authorization', 'Generic', 'Brand Name'],
    tips: [
      'Generic drugs are usually preferred and cost less',
      'Formularies can change during the year with notice',
      'Your doctor can request exceptions for non-formulary drugs'
    ],
    commonMisconceptions: [
      'Being on the formulary doesn\'t mean the drug is free',
      'All generic versions of a drug may not be on the formulary',
      'Formulary placement can affect prior authorization requirements'
    ]
  }
};

export function generatePersonalizedInsuranceGuide(
  biomarkers: Biomarker[],
  insurancePlans: InsurancePlan[],
  healthNeeds: HealthNeedsAnalysis
): PersonalizedInsuranceGuide {
  const userProfile = {
    detectedConditions: healthNeeds.detectedConditions.map(dc => dc.condition.name),
    recommendedServices: healthNeeds.recommendedServices.map(rs => rs.service.name),
    riskFactors: Array.from(new Set(healthNeeds.detectedConditions.flatMap(dc => dc.riskFactors))),
    currentPlans: insurancePlans.map(plan => plan.planName)
  };

  const educationModules = generateEducationModules(userProfile, insurancePlans, healthNeeds);
  const costProjections = generateCostProjections(userProfile, insurancePlans, healthNeeds);
  const optimizationTips = generateOptimizationTips(userProfile, insurancePlans, healthNeeds);
  const glossary = generatePersonalizedGlossary(userProfile, insurancePlans, healthNeeds);

  return {
    userProfile,
    educationModules,
    costProjections,
    optimizationTips,
    glossary
  };
}

function generateEducationModules(
  userProfile: any,
  insurancePlans: InsurancePlan[],
  healthNeeds: HealthNeedsAnalysis
): InsuranceEducationModule[] {
  const modules: InsuranceEducationModule[] = [];

  // Module 1: Understanding Your Costs
  modules.push({
    id: 'cost-basics',
    title: 'Understanding Your Healthcare Costs',
    description: 'Learn how deductibles, copays, and coinsurance work with your specific health needs',
    terms: generateCostTerms(userProfile, insurancePlans, healthNeeds),
    scenarios: generateCostScenarios(userProfile, insurancePlans, healthNeeds),
    recommendations: [
      'Track your healthcare spending to understand when you\'ll meet your deductible',
      'Use in-network providers to minimize costs',
      'Consider the total cost of care, not just premiums, when choosing plans'
    ]
  });

  // Module 2: Navigating Your Network
  if (userProfile.recommendedServices.length > 0) {
    modules.push({
      id: 'network-navigation',
      title: 'Finding the Right Providers',
      description: 'How to find in-network specialists and facilities for your health conditions',
      terms: generateNetworkTerms(userProfile, insurancePlans),
      scenarios: generateNetworkScenarios(userProfile, insurancePlans, healthNeeds),
      recommendations: [
        'Always verify provider network status before scheduling appointments',
        'Ask about facility fees when scheduling procedures',
        'Understand referral requirements for your plan type'
      ]
    });
  }

  // Module 3: Managing Prescriptions
  if (healthNeeds.detectedConditions.some(dc => dc.condition.name.includes('Diabetes') || dc.condition.name.includes('PCOS'))) {
    modules.push({
      id: 'prescription-management',
      title: 'Understanding Prescription Coverage',
      description: 'How formularies and drug tiers affect your medication costs',
      terms: generatePrescriptionTerms(userProfile, insurancePlans),
      scenarios: generatePrescriptionScenarios(userProfile, insurancePlans, healthNeeds),
      recommendations: [
        'Ask your doctor about generic alternatives',
        'Use your plan\'s preferred pharmacies for better pricing',
        'Consider 90-day supplies for maintenance medications'
      ]
    });
  }

  return modules;
}

function generateCostTerms(
  userProfile: any,
  insurancePlans: InsurancePlan[],
  healthNeeds: HealthNeedsAnalysis
): InsuranceTermExplanation[] {
  const terms: InsuranceTermExplanation[] = [];
  
  // Get user's actual plan costs for examples
  const primaryPlan = insurancePlans[0];
  if (!primaryPlan) return [];

  const deductible = primaryPlan.costs.find(c => c.type === 'Deductible');
  const premium = primaryPlan.costs.find(c => c.type === 'Premium');

  // Deductible explanation with user's actual numbers
  if (deductible) {
    terms.push({
      ...INSURANCE_TERMS.deductible,
      userSpecificExample: `With your ${primaryPlan.planName} plan, you have a $${deductible.amount.toLocaleString()} deductible. This means if you need the recommended endocrinology consultation ($350), you'll pay the full $350 until you've spent $${deductible.amount.toLocaleString()} total this year.`
    });
  }

  // Copay explanation with user's services
  const specialistBenefit = primaryPlan.benefits.find(b => b.category === 'Specialist Care');
  if (specialistBenefit?.inNetworkCoverage.copay) {
    terms.push({
      ...INSURANCE_TERMS.copay,
      userSpecificExample: `For your recommended specialist visits (like endocrinology for PCOS management), you'll pay a $${specialistBenefit.inNetworkCoverage.copay} copay each time, regardless of what the doctor charges.`
    });
  }

  // Coinsurance with user's imaging needs
  const imagingBenefit = primaryPlan.benefits.find(b => b.category === 'Imaging');
  if (imagingBenefit?.inNetworkCoverage.coinsurance) {
    terms.push({
      ...INSURANCE_TERMS.coinsurance,
      userSpecificExample: `For imaging tests like the recommended pelvic ultrasound ($300), after meeting your deductible, you'll pay ${imagingBenefit.inNetworkCoverage.coinsurance}% (${(300 * imagingBenefit.inNetworkCoverage.coinsurance / 100).toFixed(0)}) and insurance covers the rest.`
    });
  }

  return terms;
}

function generateCostScenarios(
  userProfile: any,
  insurancePlans: InsurancePlan[],
  healthNeeds: HealthNeedsAnalysis
): InsuranceScenario[] {
  const scenarios: InsuranceScenario[] = [];
  const primaryPlan = insurancePlans[0];
  if (!primaryPlan) return [];

  // Scenario: Managing PCOS with current plan
  if (userProfile.detectedConditions.includes('Polycystic Ovary Syndrome (PCOS)')) {
    const costBreakdown: CostBreakdownItem[] = [
      {
        service: 'Endocrinology Consultation',
        originalCost: 350,
        yourCost: 50, // Assuming copay
        explanation: 'Specialist visit copay',
        insuranceCovers: 300,
        whyThisCost: 'Your plan covers specialist visits with a copay after you meet any deductible requirements'
      },
      {
        service: 'Hormone Panel',
        originalCost: 250,
        yourCost: 50, // Assuming 20% coinsurance after deductible
        explanation: '20% coinsurance after deductible',
        insuranceCovers: 200,
        whyThisCost: 'Lab tests are subject to coinsurance once you\'ve met your annual deductible'
      },
      {
        service: 'Pelvic Ultrasound',
        originalCost: 300,
        yourCost: 60,
        explanation: '20% coinsurance after deductible',
        insuranceCovers: 240,
        whyThisCost: 'Imaging services typically require coinsurance payment after deductible is met'
      }
    ];

    scenarios.push({
      id: 'pcos-management',
      title: 'Managing PCOS: Your First Year Costs',
      description: 'What you can expect to pay for PCOS-related care with your current insurance',
      userSituation: `Based on your elevated testosterone levels and other biomarkers, you likely need PCOS management. Here's how your ${primaryPlan.planName} plan would handle these costs.`,
      costBreakdown,
      keyLearnings: [
        'Specialist copays provide predictable costs for regular visits',
        'Lab tests and imaging are subject to your deductible and coinsurance',
        'Total estimated annual cost for PCOS management: $160 (after insurance)'
      ],
      actionItems: [
        'Verify endocrinologists in your network before scheduling',
        'Ask about bundled lab packages to reduce costs',
        'Consider timing expensive tests early in the year if you expect to meet your deductible'
      ]
    });
  }

  return scenarios;
}

function generateNetworkTerms(
  userProfile: any,
  insurancePlans: InsurancePlan[]
): InsuranceTermExplanation[] {
  const terms: InsuranceTermExplanation[] = [];
  const primaryPlan = insurancePlans[0];

  if (primaryPlan) {
    terms.push({
      ...INSURANCE_TERMS.network,
      userSpecificExample: `Your ${primaryPlan.planName} plan has a specific network of providers. For your recommended endocrinology consultation, you'll want to find an in-network endocrinologist to avoid higher out-of-network costs.`
    });

    // Add referral explanation if it's an HMO
    if (primaryPlan.planType === 'HMO') {
      terms.push({
        term: 'Referral Requirement',
        definition: 'Permission from your primary care doctor to see a specialist.',
        contextualExample: 'HMO plans typically require referrals for specialist visits to be covered.',
        userSpecificExample: `Since you have an HMO plan, you'll need a referral from your primary care doctor before seeing an endocrinologist for PCOS management.`,
        relatedTerms: ['Primary Care Provider', 'Network', 'Prior Authorization'],
        tips: [
          'Schedule your primary care visit first to get referrals',
          'Referrals are usually valid for a specific time period',
          'Emergency care doesn\'t require referrals'
        ],
        commonMisconceptions: [
          'You can\'t see specialists without referrals in HMO plans',
          'Referrals guarantee coverage for specialist visits',
          'All tests ordered by specialists are automatically covered'
        ]
      });
    }
  }

  return terms;
}

function generateNetworkScenarios(
  userProfile: any,
  insurancePlans: InsurancePlan[],
  healthNeeds: HealthNeedsAnalysis
): InsuranceScenario[] {
  const scenarios: InsuranceScenario[] = [];
  const primaryPlan = insurancePlans[0];

  if (primaryPlan && userProfile.recommendedServices.length > 0) {
    scenarios.push({
      id: 'finding-specialists',
      title: 'Finding the Right Specialists',
      description: 'How to locate in-network providers for your health conditions',
      userSituation: `You need to find specialists for ${userProfile.detectedConditions.join(', ')}. Here's how to navigate your network effectively.`,
      costBreakdown: [
        {
          service: 'In-Network Endocrinologist',
          originalCost: 350,
          yourCost: 50,
          explanation: 'Specialist copay',
          insuranceCovers: 300,
          whyThisCost: 'In-network providers have negotiated rates with your insurance'
        },
        {
          service: 'Out-of-Network Endocrinologist',
          originalCost: 350,
          yourCost: 280,
          explanation: 'Higher coinsurance + balance billing',
          insuranceCovers: 70,
          whyThisCost: 'Out-of-network providers can charge more and you pay higher percentages'
        }
      ],
      keyLearnings: [
        'In-network providers can save you $230 per visit',
        'Always verify network status before scheduling',
        'Network directories online may not be current'
      ],
      actionItems: [
        'Call your insurance to verify provider network status',
        'Ask the provider\'s office to confirm they accept your specific plan',
        'Get referrals if required by your plan type'
      ]
    });
  }

  return scenarios;
}

function generatePrescriptionTerms(
  userProfile: any,
  insurancePlans: InsurancePlan[]
): InsuranceTermExplanation[] {
  const terms: InsuranceTermExplanation[] = [];

  terms.push({
    ...INSURANCE_TERMS.formulary,
    userSpecificExample: 'If you need metformin for PCOS management, check if it\'s on your plan\'s formulary. Generic metformin is typically covered with low copays, while brand-name versions may require prior authorization.'
  });

  return terms;
}

function generatePrescriptionScenarios(
  userProfile: any,
  insurancePlans: InsurancePlan[],
  healthNeeds: HealthNeedsAnalysis
): InsuranceScenario[] {
  const scenarios: InsuranceScenario[] = [];

  if (userProfile.detectedConditions.some((condition: string) => 
    condition.includes('Diabetes') || condition.includes('PCOS')
  )) {
    scenarios.push({
      id: 'prescription-costs',
      title: 'Managing Prescription Costs',
      description: 'Understanding how formularies affect your medication expenses',
      userSituation: 'You may need medications for hormone regulation or glucose management. Here\'s how your insurance handles prescription costs.',
      costBreakdown: [
        {
          service: 'Generic Metformin (Tier 1)',
          originalCost: 25,
          yourCost: 10,
          explanation: 'Generic copay',
          insuranceCovers: 15,
          whyThisCost: 'Generic drugs are preferred and have the lowest copays'
        },
        {
          service: 'Brand Name Hormone Therapy (Tier 3)',
          originalCost: 200,
          yourCost: 60,
          explanation: 'Brand name copay',
          insuranceCovers: 140,
          whyThisCost: 'Brand name drugs have higher copays to encourage generic use'
        }
      ],
      keyLearnings: [
        'Generic medications can save you $50+ per prescription',
        'Formulary tier determines your copay amount',
        'Prior authorization may be required for non-preferred drugs'
      ],
      actionItems: [
        'Ask your doctor about generic alternatives',
        'Check your plan\'s formulary before filling prescriptions',
        'Consider mail-order pharmacy for maintenance medications'
      ]
    });
  }

  return scenarios;
}

function generateCostProjections(
  userProfile: any,
  insurancePlans: InsurancePlan[],
  healthNeeds: HealthNeedsAnalysis
): AnnualCostProjection[] {
  const projections: AnnualCostProjection[] = [];
  const primaryPlan = insurancePlans[0];

  if (primaryPlan && healthNeeds.estimatedCosts.length > 0) {
    const totalEstimatedServices = healthNeeds.estimatedCosts.reduce(
      (sum, cost) => sum + cost.annualEstimate, 0
    );

    const deductible = primaryPlan.costs.find(c => c.type === 'Deductible')?.amount || 0;
    const premium = primaryPlan.costs.find(c => c.type === 'Premium')?.amount || 0;

    // Conservative scenario - minimal care
    projections.push({
      scenario: 'Minimal Care',
      description: 'Only essential preventive care and urgent needs',
      estimatedCosts: {
        premiums: premium * 12,
        deductibles: Math.min(1000, deductible),
        copays: 200,
        coinsurance: 100,
        outOfPocket: 1300,
        total: (premium * 12) + 1300
      },
      breakdown: [
        {
          service: 'Annual Physical',
          originalCost: 300,
          yourCost: 0,
          explanation: 'Preventive care covered 100%',
          insuranceCovers: 300,
          whyThisCost: 'Preventive services are covered without deductible'
        }
      ]
    });

    // Recommended care scenario
    projections.push({
      scenario: 'Recommended Care',
      description: 'Following all recommended treatments for your detected conditions',
      estimatedCosts: {
        premiums: premium * 12,
        deductibles: deductible,
        copays: 600,
        coinsurance: 800,
        outOfPocket: deductible + 1400,
        total: (premium * 12) + deductible + 1400
      },
      breakdown: healthNeeds.estimatedCosts.slice(0, 3).map(cost => ({
        service: cost.serviceName,
        originalCost: cost.annualEstimate,
        yourCost: cost.planComparison[0]?.estimatedAnnualCost || cost.annualEstimate * 0.2,
        explanation: 'Copays and coinsurance',
        insuranceCovers: cost.annualEstimate - (cost.planComparison[0]?.estimatedAnnualCost || cost.annualEstimate * 0.2),
        whyThisCost: 'Based on your plan\'s cost-sharing structure'
      }))
    });
  }

  return projections;
}

function generateOptimizationTips(
  userProfile: any,
  insurancePlans: InsurancePlan[],
  healthNeeds: HealthNeedsAnalysis
): InsuranceOptimizationTip[] {
  const tips: InsuranceOptimizationTip[] = [];

  // Cost savings tips
  tips.push({
    id: 'generic-medications',
    category: 'Cost Savings',
    title: 'Choose Generic Medications When Available',
    description: 'Generic versions of medications can save you 50-80% on prescription costs.',
    potentialSavings: 600,
    difficulty: 'Easy',
    timeToImplement: 'Next prescription fill',
    userSpecific: userProfile.detectedConditions.some((c: string) => 
      c.includes('Diabetes') || c.includes('PCOS')
    )
  });

  tips.push({
    id: 'preventive-care',
    category: 'Preventive Care',
    title: 'Maximize Preventive Care Benefits',
    description: 'Use covered preventive services to catch issues early and avoid costly treatments later.',
    difficulty: 'Easy',
    timeToImplement: 'Schedule within 30 days',
    userSpecific: true
  });

  tips.push({
    id: 'network-providers',
    category: 'Network Usage',
    title: 'Always Use In-Network Providers',
    description: 'In-network providers can save you hundreds per visit compared to out-of-network options.',
    potentialSavings: 2000,
    difficulty: 'Easy',
    timeToImplement: 'Before next appointment',
    userSpecific: true
  });

  if (healthNeeds.recommendedServices.length > 3) {
    tips.push({
      id: 'timing-services',
      category: 'Cost Savings',
      title: 'Time Your Medical Services Strategically',
      description: 'If you expect to meet your deductible, schedule expensive procedures in the same year.',
      potentialSavings: 1000,
      difficulty: 'Moderate',
      timeToImplement: 'Plan for next year',
      userSpecific: true
    });
  }

  return tips;
}

function generatePersonalizedGlossary(
  userProfile: any,
  insurancePlans: InsurancePlan[],
  healthNeeds: HealthNeedsAnalysis
): InsuranceTermExplanation[] {
  const glossary: InsuranceTermExplanation[] = [];
  const primaryPlan = insurancePlans[0];

  // Add relevant terms based on user's situation
  Object.entries(INSURANCE_TERMS).forEach(([key, term]) => {
    let userSpecificExample = '';

    // Customize examples based on user's actual data
    if (key === 'deductible' && primaryPlan) {
      const deductible = primaryPlan.costs.find(c => c.type === 'Deductible');
      if (deductible) {
        userSpecificExample = `Your ${primaryPlan.planName} has a $${deductible.amount.toLocaleString()} deductible. For your recommended health services totaling approximately $${healthNeeds.estimatedCosts.reduce((sum, cost) => sum + cost.annualEstimate, 0).toLocaleString()}, you'll pay the first $${deductible.amount.toLocaleString()} before insurance coverage begins.`;
      }
    }

    glossary.push({
      ...term,
      userSpecificExample
    });
  });

  return glossary;
}

// Helper function to format currency
export function formatCurrency(amount: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0
  }).format(amount);
}

// Helper function to calculate potential savings
export function calculatePotentialSavings(
  currentPlan: InsurancePlan,
  alternativePlan: InsurancePlan,
  estimatedAnnualUsage: number
): number {
  // Simplified calculation - in reality this would be more complex
  const currentCosts = currentPlan.costs.reduce((sum, cost) => {
    if (cost.frequency === 'Monthly') return sum + (cost.amount * 12);
    if (cost.frequency === 'Annual') return sum + cost.amount;
    return sum;
  }, 0);

  const alternativeCosts = alternativePlan.costs.reduce((sum, cost) => {
    if (cost.frequency === 'Monthly') return sum + (cost.amount * 12);
    if (cost.frequency === 'Annual') return sum + cost.amount;
    return sum;
  }, 0);

  return Math.abs(currentCosts - alternativeCosts);
}