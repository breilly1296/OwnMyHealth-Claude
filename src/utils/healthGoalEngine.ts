import type { 
  Biomarker, 
  InsurancePlan, 
  HealthNeedsAnalysis,
  DetectedCondition,
  RecommendedService
} from '../types';

// Health goal types and structures
export interface HealthGoal {
  id: string;
  title: string;
  description: string;
  category: HealthGoalCategory;
  priority: 'low' | 'medium' | 'high' | 'urgent';
  targetDate?: string;
  requiredServices: RequiredService[];
  triggeringBiomarkers?: string[]; // Biomarker names that suggest this goal
  estimatedCost: number;
  frequency: 'one-time' | 'annual' | 'bi-annual' | 'quarterly' | 'monthly';
  prerequisites?: string[];
  relatedGoals?: string[];
  userDefined: boolean;
  createdAt: string;
}

export type HealthGoalCategory = 
  | 'preventive_screening'
  | 'diagnostic_testing'
  | 'condition_management'
  | 'wellness_optimization'
  | 'emergency_preparedness'
  | 'specialist_consultation'
  | 'medication_management'
  | 'lifestyle_intervention';

export interface RequiredService {
  serviceCode: string;
  serviceName: string;
  category: string;
  cptCodes?: string[];
  estimatedCost: number;
  frequency: string;
  urgency: 'routine' | 'follow-up' | 'urgent' | 'immediate';
  alternatives?: AlternativeService[];
}

export interface AlternativeService {
  serviceCode: string;
  serviceName: string;
  costDifference: number;
  coverageDifference: number;
  description: string;
}

export interface CoveragePathway {
  goalId: string;
  planId: string;
  planName: string;
  totalCoverage: number; // Percentage of goal covered
  estimatedOutOfPocket: number;
  estimatedAnnualCost: number;
  coverageSteps: CoverageStep[];
  requirements: PathwayRequirement[];
  timeline: PathwayTimeline;
  alternatives: AlternativePathway[];
  riskFactors: string[];
  recommendations: string[];
  confidence: number;
}

export interface CoverageStep {
  stepNumber: number;
  serviceName: string;
  serviceCode: string;
  covered: boolean;
  costStructure: {
    type: 'copay' | 'coinsurance' | 'deductible' | 'not_covered';
    amount?: number;
    percentage?: number;
  };
  estimatedCost: number;
  requirements: string[];
  notes?: string;
}

export interface PathwayRequirement {
  type: 'prior_authorization' | 'referral' | 'step_therapy' | 'network_provider' | 'deductible_met';
  description: string;
  estimatedTime: string;
  difficulty: 'easy' | 'moderate' | 'difficult';
  tips: string[];
}

export interface PathwayTimeline {
  totalTimeframe: string;
  milestones: TimelineMilestone[];
  criticalDates: string[];
}

export interface TimelineMilestone {
  date: string;
  description: string;
  action: string;
  estimatedCost: number;
}

export interface AlternativePathway {
  description: string;
  costDifference: number;
  coverageDifference: number;
  timeframeDifference: string;
  pros: string[];
  cons: string[];
}

export interface GoalMatchingResult {
  goal: HealthGoal;
  matchScore: number;
  matchReasons: string[];
  urgencyScore: number;
  feasibilityScore: number;
  costEffectivenessScore: number;
  recommendedAction: 'pursue_immediately' | 'plan_for_future' | 'consider_alternatives' | 'not_recommended';
}

export interface OptimalCoveragePlan {
  goalId: string;
  bestPathway: CoveragePathway;
  alternativePathways: CoveragePathway[];
  costComparison: CostComparison;
  actionPlan: ActionPlan;
  riskAssessment: RiskAssessment;
}

export interface CostComparison {
  withInsurance: number;
  withoutInsurance: number;
  savings: number;
  savingsPercentage: number;
  breakdownByService: ServiceCostBreakdown[];
}

export interface ServiceCostBreakdown {
  serviceName: string;
  fullCost: number;
  insurancePays: number;
  youPay: number;
  savingsAmount: number;
}

export interface ActionPlan {
  immediateActions: ActionItem[];
  shortTermActions: ActionItem[];
  longTermActions: ActionItem[];
  contingencyPlans: ContingencyPlan[];
}

export interface ActionItem {
  id: string;
  description: string;
  dueDate: string;
  priority: 'high' | 'medium' | 'low';
  estimatedTime: string;
  dependencies: string[];
  resources: string[];
}

export interface ContingencyPlan {
  scenario: string;
  probability: number;
  impact: 'low' | 'medium' | 'high';
  mitigationSteps: string[];
  alternativeActions: string[];
}

export interface RiskAssessment {
  overallRisk: 'low' | 'medium' | 'high';
  riskFactors: RiskFactor[];
  mitigationStrategies: string[];
  monitoringRecommendations: string[];
}

export interface RiskFactor {
  factor: string;
  impact: 'low' | 'medium' | 'high';
  probability: number;
  description: string;
  mitigation: string;
}

// Predefined health goals based on common biomarker patterns
const PREDEFINED_HEALTH_GOALS: Omit<HealthGoal, 'id' | 'userDefined' | 'createdAt'>[] = [
  {
    title: 'Get Vitamin D Test',
    description: 'Test vitamin D levels to assess deficiency and bone health',
    category: 'diagnostic_testing',
    priority: 'medium',
    requiredServices: [
      {
        serviceCode: 'LB001',
        serviceName: 'Vitamin D 25-Hydroxy Test',
        category: 'Laboratory Tests',
        cptCodes: ['82306'],
        estimatedCost: 80,
        frequency: 'annual',
        urgency: 'routine'
      }
    ],
    triggeringBiomarkers: ['Vitamin D'],
    estimatedCost: 80,
    frequency: 'annual'
  },
  {
    title: 'PCOS Management Program',
    description: 'Comprehensive evaluation and management of PCOS symptoms',
    category: 'condition_management',
    priority: 'high',
    requiredServices: [
      {
        serviceCode: 'SP003',
        serviceName: 'Endocrinology Consultation',
        category: 'Specialist Care',
        estimatedCost: 350,
        frequency: 'bi-annual',
        urgency: 'follow-up'
      },
      {
        serviceCode: 'LB002',
        serviceName: 'Hormone Panel',
        category: 'Laboratory Tests',
        estimatedCost: 250,
        frequency: 'quarterly',
        urgency: 'routine'
      },
      {
        serviceCode: 'DI004',
        serviceName: 'Pelvic Ultrasound',
        category: 'Imaging',
        estimatedCost: 300,
        frequency: 'annual',
        urgency: 'routine'
      }
    ],
    triggeringBiomarkers: ['Testosterone (Total)', 'LH', 'FSH', 'Insulin'],
    estimatedCost: 1200,
    frequency: 'annual'
  },
  {
    title: 'Cardiovascular Risk Assessment',
    description: 'Comprehensive evaluation of heart disease risk factors',
    category: 'preventive_screening',
    priority: 'high',
    requiredServices: [
      {
        serviceCode: 'SP002',
        serviceName: 'Cardiology Consultation',
        category: 'Specialist Care',
        estimatedCost: 400,
        frequency: 'annual',
        urgency: 'urgent'
      },
      {
        serviceCode: 'DI005',
        serviceName: 'Echocardiogram',
        category: 'Imaging',
        estimatedCost: 500,
        frequency: 'annual',
        urgency: 'routine'
      },
      {
        serviceCode: 'LB003',
        serviceName: 'Lipid Panel',
        category: 'Laboratory Tests',
        estimatedCost: 120,
        frequency: 'quarterly',
        urgency: 'routine'
      }
    ],
    triggeringBiomarkers: ['Total Cholesterol', 'LDL Cholesterol', 'HDL Cholesterol', 'CRP', 'Blood Pressure (Systolic)'],
    estimatedCost: 1500,
    frequency: 'annual'
  },
  {
    title: 'Diabetes Prevention Program',
    description: 'Early intervention for prediabetes and diabetes risk factors',
    category: 'condition_management',
    priority: 'urgent',
    requiredServices: [
      {
        serviceCode: 'SP003',
        serviceName: 'Endocrinology Consultation',
        category: 'Specialist Care',
        estimatedCost: 300,
        frequency: 'quarterly',
        urgency: 'urgent'
      },
      {
        serviceCode: 'LB004',
        serviceName: 'Glucose Tolerance Test',
        category: 'Laboratory Tests',
        estimatedCost: 150,
        frequency: 'annual',
        urgency: 'routine'
      },
      {
        serviceCode: 'ED001',
        serviceName: 'Diabetes Education Program',
        category: 'Education',
        estimatedCost: 200,
        frequency: 'one-time',
        urgency: 'follow-up'
      }
    ],
    triggeringBiomarkers: ['Glucose (Fasting)', 'Hemoglobin A1C', 'Insulin'],
    estimatedCost: 1300,
    frequency: 'annual'
  },
  {
    title: 'Thyroid Function Optimization',
    description: 'Comprehensive thyroid evaluation and hormone optimization',
    category: 'condition_management',
    priority: 'medium',
    requiredServices: [
      {
        serviceCode: 'SP003',
        serviceName: 'Endocrinology Consultation',
        category: 'Specialist Care',
        estimatedCost: 320,
        frequency: 'bi-annual',
        urgency: 'follow-up'
      },
      {
        serviceCode: 'LB005',
        serviceName: 'Complete Thyroid Panel',
        category: 'Laboratory Tests',
        estimatedCost: 200,
        frequency: 'bi-annual',
        urgency: 'routine'
      },
      {
        serviceCode: 'DI006',
        serviceName: 'Thyroid Ultrasound',
        category: 'Imaging',
        estimatedCost: 250,
        frequency: 'annual',
        urgency: 'routine'
      }
    ],
    triggeringBiomarkers: ['TSH', 'Free T4', 'Free T3'],
    estimatedCost: 1000,
    frequency: 'annual'
  },
  {
    title: 'Bone Health Assessment',
    description: 'Comprehensive evaluation of bone density and fracture risk',
    category: 'preventive_screening',
    priority: 'medium',
    requiredServices: [
      {
        serviceCode: 'DI007',
        serviceName: 'DEXA Bone Density Scan',
        category: 'Imaging',
        estimatedCost: 300,
        frequency: 'annual',
        urgency: 'routine'
      },
      {
        serviceCode: 'LB006',
        serviceName: 'Bone Metabolism Panel',
        category: 'Laboratory Tests',
        estimatedCost: 180,
        frequency: 'annual',
        urgency: 'routine'
      }
    ],
    triggeringBiomarkers: ['Vitamin D', 'Calcium', 'Bone Mineral Density'],
    estimatedCost: 480,
    frequency: 'annual'
  },
  {
    title: 'Annual Preventive Care Package',
    description: 'Comprehensive annual physical and preventive screenings',
    category: 'preventive_screening',
    priority: 'medium',
    requiredServices: [
      {
        serviceCode: 'PC002',
        serviceName: 'Annual Physical Exam',
        category: 'Primary Care',
        estimatedCost: 250,
        frequency: 'annual',
        urgency: 'routine'
      },
      {
        serviceCode: 'LB007',
        serviceName: 'Comprehensive Metabolic Panel',
        category: 'Laboratory Tests',
        estimatedCost: 150,
        frequency: 'annual',
        urgency: 'routine'
      },
      {
        serviceCode: 'PR002',
        serviceName: 'Cancer Screening Package',
        category: 'Preventive Care',
        estimatedCost: 400,
        frequency: 'annual',
        urgency: 'routine'
      }
    ],
    estimatedCost: 800,
    frequency: 'annual'
  }
];

// Health Goal Engine Class
export class HealthGoalEngine {
  private goals: Map<string, HealthGoal> = new Map();
  private userGoals: Map<string, HealthGoal> = new Map();

  constructor() {
    this.initializePredefinedGoals();
  }

  // Initialize predefined goals
  private initializePredefinedGoals(): void {
    PREDEFINED_HEALTH_GOALS.forEach(goalTemplate => {
      const goal: HealthGoal = {
        ...goalTemplate,
        id: crypto.randomUUID(),
        userDefined: false,
        createdAt: new Date().toISOString()
      };
      this.goals.set(goal.id, goal);
    });
  }

  // Add user-defined goal
  addUserGoal(goalData: Omit<HealthGoal, 'id' | 'userDefined' | 'createdAt'>): HealthGoal {
    const goal: HealthGoal = {
      ...goalData,
      id: crypto.randomUUID(),
      userDefined: true,
      createdAt: new Date().toISOString()
    };
    
    this.userGoals.set(goal.id, goal);
    return goal;
  }

  // Match health goals based on biomarkers and health needs
  matchHealthGoals(
    biomarkers: Biomarker[],
    healthNeeds: HealthNeedsAnalysis,
    userPreferences?: {
      priorityCategories?: HealthGoalCategory[];
      maxBudget?: number;
      timeframe?: string;
    }
  ): GoalMatchingResult[] {
    const allGoals = [...this.goals.values(), ...this.userGoals.values()];
    const results: GoalMatchingResult[] = [];

    allGoals.forEach(goal => {
      const matchResult = this.calculateGoalMatch(goal, biomarkers, healthNeeds, userPreferences);
      if (matchResult.matchScore > 0.3) { // Only include goals with reasonable match
        results.push(matchResult);
      }
    });

    return results.sort((a, b) => b.matchScore - a.matchScore);
  }

  // Calculate optimal coverage pathway for a specific goal
  calculateOptimalCoverage(
    goal: HealthGoal,
    insurancePlans: InsurancePlan[],
    userPreferences?: {
      preferLowerCost?: boolean;
      preferBetterCoverage?: boolean;
      preferFasterAccess?: boolean;
    }
  ): OptimalCoveragePlan {
    const pathways = insurancePlans.map(plan => 
      this.analyzeCoveragePathway(goal, plan)
    );

    // Sort pathways based on user preferences
    const sortedPathways = this.sortPathwaysByPreferences(pathways, userPreferences);
    const bestPathway = sortedPathways[0];
    const alternatives = sortedPathways.slice(1, 4); // Top 3 alternatives

    return {
      goalId: goal.id,
      bestPathway,
      alternativePathways: alternatives,
      costComparison: this.generateCostComparison(goal, bestPathway),
      actionPlan: this.generateActionPlan(goal, bestPathway),
      riskAssessment: this.assessRisks(goal, bestPathway)
    };
  }

  // Calculate goal match score
  private calculateGoalMatch(
    goal: HealthGoal,
    biomarkers: Biomarker[],
    healthNeeds: HealthNeedsAnalysis,
    userPreferences?: any
  ): GoalMatchingResult {
    let matchScore = 0;
    const matchReasons: string[] = [];

    // Biomarker-based matching
    if (goal.triggeringBiomarkers) {
      const matchingBiomarkers = biomarkers.filter(b => 
        goal.triggeringBiomarkers!.some(trigger => 
          b.name.toLowerCase().includes(trigger.toLowerCase())
        )
      );

      if (matchingBiomarkers.length > 0) {
        const biomarkerScore = (matchingBiomarkers.length / goal.triggeringBiomarkers.length) * 0.4;
        matchScore += biomarkerScore;
        matchReasons.push(`${matchingBiomarkers.length} relevant biomarker(s) detected`);

        // Check if biomarkers are out of range
        const outOfRangeBiomarkers = matchingBiomarkers.filter(b => 
          b.value < b.normalRange.min || b.value > b.normalRange.max
        );
        
        if (outOfRangeBiomarkers.length > 0) {
          matchScore += 0.2;
          matchReasons.push(`${outOfRangeBiomarkers.length} biomarker(s) out of normal range`);
        }
      }
    }

    // Health needs-based matching
    const relatedConditions = healthNeeds.detectedConditions.filter(condition =>
      goal.requiredServices.some(service =>
        condition.condition.requiredServices.some(reqService =>
          reqService.name.toLowerCase().includes(service.serviceName.toLowerCase())
        )
      )
    );

    if (relatedConditions.length > 0) {
      matchScore += 0.3;
      matchReasons.push(`Related to ${relatedConditions.length} detected condition(s)`);
    }

    // Priority-based matching
    const priorityScore = this.calculatePriorityScore(goal.priority);
    matchScore += priorityScore * 0.1;

    // User preference matching
    if (userPreferences?.priorityCategories?.includes(goal.category)) {
      matchScore += 0.2;
      matchReasons.push('Matches your priority categories');
    }

    // Budget consideration
    if (userPreferences?.maxBudget && goal.estimatedCost <= userPreferences.maxBudget) {
      matchScore += 0.1;
      matchReasons.push('Within your budget');
    }

    // Calculate component scores
    const urgencyScore = this.calculateUrgencyScore(goal, biomarkers);
    const feasibilityScore = this.calculateFeasibilityScore(goal);
    const costEffectivenessScore = this.calculateCostEffectivenessScore(goal);

    // Determine recommended action
    const recommendedAction = this.determineRecommendedAction(
      matchScore, urgencyScore, feasibilityScore, costEffectivenessScore
    );

    return {
      goal,
      matchScore: Math.min(matchScore, 1.0),
      matchReasons,
      urgencyScore,
      feasibilityScore,
      costEffectivenessScore,
      recommendedAction
    };
  }

  // Analyze coverage pathway for a specific plan
  private analyzeCoveragePathway(goal: HealthGoal, plan: InsurancePlan): CoveragePathway {
    const coverageSteps: CoverageStep[] = [];
    let totalEstimatedCost = 0;
    let totalCoverage = 0;

    goal.requiredServices.forEach((service, index) => {
      const benefit = this.findMatchingBenefit(service, plan);
      const step = this.createCoverageStep(service, benefit, index + 1);
      
      coverageSteps.push(step);
      totalEstimatedCost += step.estimatedCost;
      totalCoverage += step.covered ? 1 : 0;
    });

    const coveragePercentage = (totalCoverage / goal.requiredServices.length) * 100;
    const requirements = this.extractPathwayRequirements(coverageSteps, plan);
    const timeline = this.generateTimeline(goal, coverageSteps);
    const alternatives = this.generateAlternatives(goal, plan);

    return {
      goalId: goal.id,
      planId: plan.id,
      planName: plan.planName,
      totalCoverage: coveragePercentage,
      estimatedOutOfPocket: totalEstimatedCost,
      estimatedAnnualCost: this.calculateAnnualCost(goal, totalEstimatedCost),
      coverageSteps,
      requirements,
      timeline,
      alternatives,
      riskFactors: this.identifyRiskFactors(goal, plan),
      recommendations: this.generateRecommendations(goal, plan, coveragePercentage),
      confidence: this.calculatePathwayConfidence(coverageSteps, plan)
    };
  }

  // Helper methods
  private calculatePriorityScore(priority: string): number {
    switch (priority) {
      case 'urgent': return 1.0;
      case 'high': return 0.8;
      case 'medium': return 0.6;
      case 'low': return 0.4;
      default: return 0.5;
    }
  }

  private calculateUrgencyScore(goal: HealthGoal, biomarkers: Biomarker[]): number {
    let urgencyScore = this.calculatePriorityScore(goal.priority);

    // Increase urgency if related biomarkers are severely out of range
    if (goal.triggeringBiomarkers) {
      const severeBiomarkers = biomarkers.filter(b => {
        if (!goal.triggeringBiomarkers!.includes(b.name)) return false;
        
        const range = b.normalRange.max - b.normalRange.min;
        const deviation = Math.abs(b.value - (b.normalRange.min + b.normalRange.max) / 2);
        return (deviation / range) > 0.5; // More than 50% deviation from center
      });

      if (severeBiomarkers.length > 0) {
        urgencyScore = Math.min(urgencyScore + 0.3, 1.0);
      }
    }

    return urgencyScore;
  }

  private calculateFeasibilityScore(goal: HealthGoal): number {
    let feasibilityScore = 0.8; // Base feasibility

    // Reduce feasibility for complex goals
    if (goal.requiredServices.length > 5) {
      feasibilityScore -= 0.2;
    }

    // Reduce feasibility for very expensive goals
    if (goal.estimatedCost > 5000) {
      feasibilityScore -= 0.2;
    }

    // Reduce feasibility if prerequisites exist
    if (goal.prerequisites && goal.prerequisites.length > 0) {
      feasibilityScore -= 0.1;
    }

    return Math.max(feasibilityScore, 0.1);
  }

  private calculateCostEffectivenessScore(goal: HealthGoal): number {
    // Simple cost-effectiveness based on goal category and estimated cost
    const categoryMultipliers = {
      'preventive_screening': 0.9,
      'diagnostic_testing': 0.8,
      'condition_management': 0.7,
      'wellness_optimization': 0.6,
      'emergency_preparedness': 0.8,
      'specialist_consultation': 0.7,
      'medication_management': 0.8,
      'lifestyle_intervention': 0.9
    };

    const baseScore = categoryMultipliers[goal.category] || 0.7;
    
    // Adjust based on cost
    if (goal.estimatedCost < 500) return Math.min(baseScore + 0.2, 1.0);
    if (goal.estimatedCost < 1000) return baseScore;
    if (goal.estimatedCost < 2000) return Math.max(baseScore - 0.1, 0.1);
    return Math.max(baseScore - 0.2, 0.1);
  }

  private determineRecommendedAction(
    matchScore: number,
    urgencyScore: number,
    feasibilityScore: number,
    costEffectivenessScore: number
  ): GoalMatchingResult['recommendedAction'] {
    const overallScore = (matchScore + urgencyScore + feasibilityScore + costEffectivenessScore) / 4;

    if (overallScore >= 0.8 && urgencyScore >= 0.7) return 'pursue_immediately';
    if (overallScore >= 0.6 && feasibilityScore >= 0.6) return 'plan_for_future';
    if (overallScore >= 0.4) return 'consider_alternatives';
    return 'not_recommended';
  }

  private findMatchingBenefit(service: RequiredService, plan: InsurancePlan) {
    return plan.benefits.find(benefit => 
      benefit.serviceName.toLowerCase().includes(service.serviceName.toLowerCase()) ||
      benefit.category.toLowerCase().includes(service.category.toLowerCase())
    );
  }

  private createCoverageStep(
    service: RequiredService,
    benefit: any,
    stepNumber: number
  ): CoverageStep {
    if (!benefit || !benefit.inNetworkCoverage.covered) {
      return {
        stepNumber,
        serviceName: service.serviceName,
        serviceCode: service.serviceCode,
        covered: false,
        costStructure: { type: 'not_covered' },
        estimatedCost: service.estimatedCost,
        requirements: [],
        notes: 'Service not covered by this plan'
      };
    }

    const coverage = benefit.inNetworkCoverage;
    let estimatedCost = service.estimatedCost;
    let costStructure: any = { type: 'not_covered' };

    if (coverage.copay) {
      costStructure = { type: 'copay', amount: coverage.copay };
      estimatedCost = coverage.copay;
    } else if (coverage.coinsurance) {
      costStructure = { type: 'coinsurance', percentage: coverage.coinsurance };
      estimatedCost = service.estimatedCost * (coverage.coinsurance / 100);
    } else if (coverage.deductible) {
      costStructure = { type: 'deductible' };
      estimatedCost = service.estimatedCost; // Assume deductible not met
    }

    const requirements: string[] = [];
    if (benefit.priorAuthRequired) requirements.push('Prior authorization required');
    if (benefit.referralRequired) requirements.push('Referral from primary care required');

    return {
      stepNumber,
      serviceName: service.serviceName,
      serviceCode: service.serviceCode,
      covered: true,
      costStructure,
      estimatedCost,
      requirements,
      notes: coverage.limitations?.join('; ')
    };
  }

  private extractPathwayRequirements(steps: CoverageStep[], plan: InsurancePlan): PathwayRequirement[] {
    const requirements: PathwayRequirement[] = [];

    // Check for common requirements
    const needsPriorAuth = steps.some(step => 
      step.requirements.some(req => req.includes('Prior authorization'))
    );

    if (needsPriorAuth) {
      requirements.push({
        type: 'prior_authorization',
        description: 'Some services require prior authorization from your insurance',
        estimatedTime: '3-7 business days',
        difficulty: 'moderate',
        tips: [
          'Your doctor\'s office typically handles this process',
          'Allow extra time for urgent procedures',
          'Keep documentation of approval for your records'
        ]
      });
    }

    const needsReferral = steps.some(step => 
      step.requirements.some(req => req.includes('Referral'))
    );

    if (needsReferral) {
      requirements.push({
        type: 'referral',
        description: 'Specialist visits require referral from primary care physician',
        estimatedTime: '1-2 weeks',
        difficulty: 'easy',
        tips: [
          'Schedule primary care visit first',
          'Explain your symptoms and concerns clearly',
          'Ask for referral to specific specialists if needed'
        ]
      });
    }

    return requirements;
  }

  private generateTimeline(goal: HealthGoal, steps: CoverageStep[]): PathwayTimeline {
    const milestones: TimelineMilestone[] = [];
    let currentDate = new Date();
    let totalCost = 0;

    steps.forEach((step, index) => {
      currentDate = new Date(currentDate.getTime() + (7 * 24 * 60 * 60 * 1000)); // Add 1 week
      totalCost += step.estimatedCost;

      milestones.push({
        date: currentDate.toISOString().split('T')[0],
        description: `Complete ${step.serviceName}`,
        action: step.covered ? 'Schedule appointment' : 'Consider alternatives',
        estimatedCost: step.estimatedCost
      });
    });

    return {
      totalTimeframe: `${steps.length * 1-2} weeks`,
      milestones,
      criticalDates: milestones.map(m => m.date)
    };
  }

  private generateAlternatives(goal: HealthGoal, plan: InsurancePlan): AlternativePathway[] {
    const alternatives: AlternativePathway[] = [];

    // Alternative: Out-of-network providers
    alternatives.push({
      description: 'Use out-of-network providers for uncovered services',
      costDifference: goal.estimatedCost * 0.3,
      coverageDifference: -20,
      timeframeDifference: 'Potentially faster access',
      pros: ['More provider options', 'Potentially shorter wait times'],
      cons: ['Higher out-of-pocket costs', 'More paperwork']
    });

    // Alternative: Delay non-urgent services
    alternatives.push({
      description: 'Prioritize urgent services and delay routine ones',
      costDifference: -goal.estimatedCost * 0.4,
      coverageDifference: 0,
      timeframeDifference: 'Spread over longer period',
      pros: ['Lower immediate costs', 'Better budget management'],
      cons: ['Delayed care', 'Potential health risks']
    });

    return alternatives;
  }

  private identifyRiskFactors(goal: HealthGoal, plan: InsurancePlan): string[] {
    const riskFactors: string[] = [];

    // Check coverage gaps
    const uncoveredServices = goal.requiredServices.filter(service => {
      const benefit = this.findMatchingBenefit(service, plan);
      return !benefit || !benefit.inNetworkCoverage.covered;
    });

    if (uncoveredServices.length > 0) {
      riskFactors.push(`${uncoveredServices.length} service(s) not covered by insurance`);
    }

    // Check for high deductible
    const deductible = plan.costs.find(c => c.type === 'Deductible');
    if (deductible && deductible.amount > 2000) {
      riskFactors.push('High deductible may result in significant out-of-pocket costs');
    }

    // Check for prior authorization requirements
    const priorAuthServices = goal.requiredServices.filter(service => {
      const benefit = this.findMatchingBenefit(service, plan);
      return benefit?.priorAuthRequired;
    });

    if (priorAuthServices.length > 0) {
      riskFactors.push('Multiple services require prior authorization');
    }

    return riskFactors;
  }

  private generateRecommendations(goal: HealthGoal, plan: InsurancePlan, coveragePercentage: number): string[] {
    const recommendations: string[] = [];

    if (coveragePercentage < 50) {
      recommendations.push('Consider supplemental insurance or alternative plans');
    }

    if (coveragePercentage >= 80) {
      recommendations.push('This plan provides excellent coverage for your health goal');
    }

    recommendations.push('Verify provider network before scheduling appointments');
    recommendations.push('Keep detailed records of all medical expenses for tax purposes');

    return recommendations;
  }

  private calculatePathwayConfidence(steps: CoverageStep[], plan: InsurancePlan): number {
    let confidence = 0.8; // Base confidence

    // Reduce confidence for uncovered services
    const uncoveredSteps = steps.filter(step => !step.covered);
    confidence -= (uncoveredSteps.length / steps.length) * 0.3;

    // Reduce confidence for complex requirements
    const complexSteps = steps.filter(step => step.requirements.length > 1);
    confidence -= (complexSteps.length / steps.length) * 0.1;

    // Increase confidence for high extraction confidence
    if (plan.extractionConfidence > 0.8) {
      confidence += 0.1;
    }

    return Math.max(confidence, 0.1);
  }

  private sortPathwaysByPreferences(
    pathways: CoveragePathway[],
    preferences?: any
  ): CoveragePathway[] {
    return pathways.sort((a, b) => {
      if (preferences?.preferLowerCost) {
        return a.estimatedOutOfPocket - b.estimatedOutOfPocket;
      }
      if (preferences?.preferBetterCoverage) {
        return b.totalCoverage - a.totalCoverage;
      }
      // Default: balance cost and coverage
      const scoreA = (a.totalCoverage / 100) - (a.estimatedOutOfPocket / 10000);
      const scoreB = (b.totalCoverage / 100) - (b.estimatedOutOfPocket / 10000);
      return scoreB - scoreA;
    });
  }

  private generateCostComparison(goal: HealthGoal, pathway: CoveragePathway): CostComparison {
    const withoutInsurance = goal.estimatedCost;
    const withInsurance = pathway.estimatedOutOfPocket;
    const savings = withoutInsurance - withInsurance;
    const savingsPercentage = (savings / withoutInsurance) * 100;

    const breakdownByService: ServiceCostBreakdown[] = goal.requiredServices.map((service, index) => {
      const step = pathway.coverageSteps[index];
      return {
        serviceName: service.serviceName,
        fullCost: service.estimatedCost,
        insurancePays: service.estimatedCost - step.estimatedCost,
        youPay: step.estimatedCost,
        savingsAmount: service.estimatedCost - step.estimatedCost
      };
    });

    return {
      withInsurance,
      withoutInsurance,
      savings,
      savingsPercentage,
      breakdownByService
    };
  }

  private generateActionPlan(goal: HealthGoal, pathway: CoveragePathway): ActionPlan {
    const immediateActions: ActionItem[] = [];
    const shortTermActions: ActionItem[] = [];
    const longTermActions: ActionItem[] = [];

    // Generate immediate actions
    if (pathway.requirements.some(r => r.type === 'referral')) {
      immediateActions.push({
        id: crypto.randomUUID(),
        description: 'Schedule appointment with primary care physician for referrals',
        dueDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
        priority: 'high',
        estimatedTime: '1 hour',
        dependencies: [],
        resources: ['Insurance card', 'List of symptoms']
      });
    }

    // Generate short-term actions
    pathway.coverageSteps.forEach(step => {
      if (step.covered) {
        shortTermActions.push({
          id: crypto.randomUUID(),
          description: `Schedule ${step.serviceName}`,
          dueDate: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
          priority: 'medium',
          estimatedTime: '30 minutes',
          dependencies: step.requirements,
          resources: ['Insurance information', 'Referral (if required)']
        });
      }
    });

    // Generate long-term actions
    if (goal.frequency !== 'one-time') {
      longTermActions.push({
        id: crypto.randomUUID(),
        description: `Schedule follow-up ${goal.frequency} monitoring`,
        dueDate: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
        priority: 'low',
        estimatedTime: '15 minutes',
        dependencies: [],
        resources: ['Calendar reminder']
      });
    }

    const contingencyPlans: ContingencyPlan[] = [
      {
        scenario: 'Service denied by insurance',
        probability: 0.1,
        impact: 'high',
        mitigationSteps: [
          'Appeal the decision with additional documentation',
          'Seek pre-authorization if not obtained',
          'Consider out-of-network alternatives'
        ],
        alternativeActions: [
          'Use Health Savings Account funds',
          'Negotiate payment plan with provider',
          'Seek second opinion'
        ]
      }
    ];

    return {
      immediateActions,
      shortTermActions,
      longTermActions,
      contingencyPlans
    };
  }

  private assessRisks(goal: HealthGoal, pathway: CoveragePathway): RiskAssessment {
    const riskFactors: RiskFactor[] = [];

    // Coverage risk
    if (pathway.totalCoverage < 70) {
      riskFactors.push({
        factor: 'Limited insurance coverage',
        impact: 'high',
        probability: 0.9,
        description: 'Significant out-of-pocket expenses expected',
        mitigation: 'Consider supplemental insurance or payment plans'
      });
    }

    // Access risk
    if (pathway.requirements.length > 2) {
      riskFactors.push({
        factor: 'Complex approval process',
        impact: 'medium',
        probability: 0.6,
        description: 'Multiple requirements may delay care',
        mitigation: 'Start approval processes early and track progress'
      });
    }

    // Cost risk
    if (pathway.estimatedOutOfPocket > 2000) {
      riskFactors.push({
        factor: 'High out-of-pocket costs',
        impact: 'high',
        probability: 0.8,
        description: 'Significant financial burden expected',
        mitigation: 'Explore payment plans and financial assistance programs'
      });
    }

    const overallRisk = riskFactors.length > 2 ? 'high' : 
                       riskFactors.length > 0 ? 'medium' : 'low';

    return {
      overallRisk,
      riskFactors,
      mitigationStrategies: riskFactors.map(rf => rf.mitigation),
      monitoringRecommendations: [
        'Track all medical expenses',
        'Monitor insurance claim status',
        'Keep records of all approvals and denials'
      ]
    };
  }

  private calculateAnnualCost(goal: HealthGoal, totalCost: number): number {
    const frequencyMultipliers = {
      'one-time': 1,
      'annual': 1,
      'bi-annual': 2,
      'quarterly': 4,
      'monthly': 12
    };

    return totalCost * (frequencyMultipliers[goal.frequency] || 1);
  }

  // Public methods for getting goals
  getAllGoals(): HealthGoal[] {
    return [...this.goals.values(), ...this.userGoals.values()];
  }

  getGoalById(goalId: string): HealthGoal | undefined {
    return this.goals.get(goalId) || this.userGoals.get(goalId);
  }

  getUserGoals(): HealthGoal[] {
    return Array.from(this.userGoals.values());
  }

  getPredefinedGoals(): HealthGoal[] {
    return Array.from(this.goals.values());
  }
}

// Create singleton instance
export const healthGoalEngine = new HealthGoalEngine();