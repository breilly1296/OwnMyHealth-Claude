import type { 
  Biomarker, 
  RiskAssessment, 
  TrendAnalysis, 
  HealthInsight, 
  CorrelationAnalysis, 
  AIAnalysisResult,
  TrendPoint 
} from '../types';

// Clinical thresholds and risk factors
const CLINICAL_THRESHOLDS = {
  'Glucose (Fasting)': {
    optimal: { min: 70, max: 85 },
    normal: { min: 70, max: 100 },
    prediabetic: { min: 100, max: 125 },
    diabetic: { min: 126, max: Infinity },
    riskFactors: ['diabetes', 'metabolic syndrome', 'cardiovascular disease']
  },
  'Total Cholesterol': {
    optimal: { min: 0, max: 180 },
    normal: { min: 0, max: 200 },
    borderline: { min: 200, max: 239 },
    high: { min: 240, max: Infinity },
    riskFactors: ['cardiovascular disease', 'stroke', 'atherosclerosis']
  },
  'HDL Cholesterol': {
    low: { min: 0, max: 40 },
    normal: { min: 40, max: 60 },
    optimal: { min: 60, max: Infinity },
    riskFactors: ['cardiovascular disease', 'metabolic syndrome']
  },
  'LDL Cholesterol': {
    optimal: { min: 0, max: 100 },
    near_optimal: { min: 100, max: 129 },
    borderline: { min: 130, max: 159 },
    high: { min: 160, max: 189 },
    very_high: { min: 190, max: Infinity },
    riskFactors: ['cardiovascular disease', 'atherosclerosis']
  },
  'Blood Pressure (Systolic)': {
    optimal: { min: 90, max: 120 },
    elevated: { min: 120, max: 129 },
    stage1: { min: 130, max: 139 },
    stage2: { min: 140, max: 179 },
    crisis: { min: 180, max: Infinity },
    riskFactors: ['hypertension', 'cardiovascular disease', 'stroke']
  },
  'Vitamin D': {
    deficient: { min: 0, max: 20 },
    insufficient: { min: 20, max: 30 },
    sufficient: { min: 30, max: 100 },
    excess: { min: 100, max: Infinity },
    riskFactors: ['bone disease', 'immune dysfunction', 'depression']
  },
  'TSH': {
    low: { min: 0, max: 0.4 },
    normal: { min: 0.4, max: 4.0 },
    elevated: { min: 4.0, max: 10 },
    high: { min: 10, max: Infinity },
    riskFactors: ['thyroid dysfunction', 'metabolic disorders']
  },
  'CRP': {
    low: { min: 0, max: 1 },
    average: { min: 1, max: 3 },
    high: { min: 3, max: 10 },
    very_high: { min: 10, max: Infinity },
    riskFactors: ['inflammation', 'cardiovascular disease', 'autoimmune disorders']
  }
};

// Risk assessment algorithms
export function assessBiomarkerRisk(biomarker: Biomarker): RiskAssessment {
  const thresholds = CLINICAL_THRESHOLDS[biomarker.name as keyof typeof CLINICAL_THRESHOLDS];
  
  if (!thresholds) {
    return assessGenericRisk(biomarker);
  }

  const value = biomarker.value;
  let riskLevel: RiskAssessment['riskLevel'] = 'low';
  let riskScore = 0;
  let recommendations: string[] = [];
  let clinicalSignificance = '';
  let urgency: RiskAssessment['urgency'] = 'routine';

  // Assess risk based on specific biomarker thresholds
  switch (biomarker.name) {
    case 'Glucose (Fasting)':
      if (value >= 126) {
        riskLevel = 'critical';
        riskScore = 90;
        urgency = 'immediate';
        clinicalSignificance = 'Diabetic range - immediate medical attention required';
        recommendations = [
          'Consult endocrinologist immediately',
          'Begin glucose monitoring',
          'Implement strict dietary changes',
          'Consider medication management'
        ];
      } else if (value >= 100) {
        riskLevel = 'high';
        riskScore = 70;
        urgency = 'urgent';
        clinicalSignificance = 'Prediabetic range - high risk for diabetes';
        recommendations = [
          'Schedule follow-up with physician',
          'Implement lifestyle modifications',
          'Regular glucose monitoring',
          'Nutritional counseling'
        ];
      }
      break;

    case 'Blood Pressure (Systolic)':
      if (value >= 180) {
        riskLevel = 'critical';
        riskScore = 95;
        urgency = 'immediate';
        clinicalSignificance = 'Hypertensive crisis - emergency medical care needed';
        recommendations = [
          'Seek emergency medical care immediately',
          'Do not delay treatment',
          'Monitor for symptoms of stroke or heart attack'
        ];
      } else if (value >= 140) {
        riskLevel = 'high';
        riskScore = 75;
        urgency = 'urgent';
        clinicalSignificance = 'Stage 2 hypertension - medication likely needed';
        recommendations = [
          'Consult physician for medication',
          'Daily blood pressure monitoring',
          'Reduce sodium intake',
          'Increase physical activity'
        ];
      }
      break;

    case 'Total Cholesterol':
      if (value >= 240) {
        riskLevel = 'high';
        riskScore = 80;
        urgency = 'urgent';
        clinicalSignificance = 'High cholesterol - significant cardiovascular risk';
        recommendations = [
          'Consult cardiologist',
          'Consider statin therapy',
          'Implement heart-healthy diet',
          'Regular lipid monitoring'
        ];
      }
      break;

    case 'CRP':
      if (value >= 10) {
        riskLevel = 'critical';
        riskScore = 85;
        urgency = 'immediate';
        clinicalSignificance = 'Very high inflammation - possible acute condition';
        recommendations = [
          'Immediate medical evaluation',
          'Investigate underlying cause',
          'Monitor for infection or autoimmune disease'
        ];
      } else if (value >= 3) {
        riskLevel = 'moderate';
        riskScore = 60;
        urgency = 'follow-up';
        clinicalSignificance = 'Elevated inflammation - cardiovascular risk factor';
        recommendations = [
          'Anti-inflammatory diet',
          'Regular exercise',
          'Stress management',
          'Follow-up testing'
        ];
      }
      break;
  }

  return {
    biomarkerId: biomarker.id,
    riskLevel,
    riskScore,
    riskFactors: thresholds.riskFactors || [],
    recommendations,
    clinicalSignificance,
    urgency
  };
}

function assessGenericRisk(biomarker: Biomarker): RiskAssessment {
  const { value, normalRange } = biomarker;
  const range = normalRange.max - normalRange.min;
  const deviation = Math.abs(value - (normalRange.min + normalRange.max) / 2);
  const percentDeviation = (deviation / range) * 100;

  let riskLevel: RiskAssessment['riskLevel'] = 'low';
  let riskScore = 0;
  let urgency: RiskAssessment['urgency'] = 'routine';

  if (value < normalRange.min || value > normalRange.max) {
    if (percentDeviation > 50) {
      riskLevel = 'high';
      riskScore = 75;
      urgency = 'urgent';
    } else if (percentDeviation > 25) {
      riskLevel = 'moderate';
      riskScore = 50;
      urgency = 'follow-up';
    } else {
      riskLevel = 'moderate';
      riskScore = 30;
      urgency = 'follow-up';
    }
  }

  return {
    biomarkerId: biomarker.id,
    riskLevel,
    riskScore,
    riskFactors: ['abnormal range'],
    recommendations: [
      'Discuss with healthcare provider',
      'Consider retesting',
      'Monitor trends over time'
    ],
    clinicalSignificance: value < normalRange.min ? 'Below normal range' : 'Above normal range',
    urgency
  };
}

// Trend analysis
export function analyzeTrend(biomarker: Biomarker): TrendAnalysis | null {
  if (!biomarker.history || biomarker.history.length < 2) {
    return null;
  }

  const history = [...biomarker.history, { date: biomarker.date, value: biomarker.value }]
    .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

  if (history.length < 2) return null;

  // Calculate trend direction and strength
  const values = history.map(h => h.value);
  const n = values.length;
  
  // Linear regression for trend
  const xValues = Array.from({ length: n }, (_, i) => i);
  const xMean = xValues.reduce((sum, x) => sum + x, 0) / n;
  const yMean = values.reduce((sum, y) => sum + y, 0) / n;
  
  const numerator = xValues.reduce((sum, x, i) => sum + (x - xMean) * (values[i] - yMean), 0);
  const denominator = xValues.reduce((sum, x) => sum + Math.pow(x - xMean, 2), 0);
  
  const slope = denominator !== 0 ? numerator / denominator : 0;
  const correlation = calculateCorrelation(xValues, values);
  
  // Determine trend direction
  let trendDirection: TrendAnalysis['trendDirection'];
  if (Math.abs(slope) < 0.1) {
    trendDirection = 'stable';
  } else if (slope > 0) {
    trendDirection = 'improving';
  } else {
    trendDirection = 'declining';
  }

  // Check for volatility
  const volatility = calculateVolatility(values);
  if (volatility > 0.3) {
    trendDirection = 'volatile';
  }

  // Calculate change rate
  const firstValue = values[0];
  const lastValue = values[values.length - 1];
  const changeRate = firstValue !== 0 ? ((lastValue - firstValue) / firstValue) * 100 : 0;

  // Identify significant changes
  const significantChanges: TrendPoint[] = [];
  for (let i = 1; i < history.length; i++) {
    const prev = history[i - 1];
    const curr = history[i];
    const change = ((curr.value - prev.value) / prev.value) * 100;
    
    let significance: TrendPoint['significance'] = 'normal';
    if (Math.abs(change) > 20) {
      significance = 'concerning';
    } else if (Math.abs(change) > 10) {
      significance = 'notable';
    }

    significantChanges.push({
      date: curr.date,
      value: curr.value,
      changeFromPrevious: change,
      significance
    });
  }

  return {
    biomarkerId: biomarker.id,
    trendDirection,
    trendStrength: Math.abs(correlation),
    changeRate,
    confidence: Math.abs(correlation),
    significantChanges
  };
}

function calculateCorrelation(x: number[], y: number[]): number {
  const n = x.length;
  const xMean = x.reduce((sum, val) => sum + val, 0) / n;
  const yMean = y.reduce((sum, val) => sum + val, 0) / n;
  
  const numerator = x.reduce((sum, xi, i) => sum + (xi - xMean) * (y[i] - yMean), 0);
  const xVariance = x.reduce((sum, xi) => sum + Math.pow(xi - xMean, 2), 0);
  const yVariance = y.reduce((sum, yi) => sum + Math.pow(yi - yMean, 2), 0);
  
  const denominator = Math.sqrt(xVariance * yVariance);
  return denominator !== 0 ? numerator / denominator : 0;
}

function calculateVolatility(values: number[]): number {
  if (values.length < 2) return 0;
  
  const mean = values.reduce((sum, val) => sum + val, 0) / values.length;
  const variance = values.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / values.length;
  const standardDeviation = Math.sqrt(variance);
  
  return mean !== 0 ? standardDeviation / mean : 0;
}

// Generate health insights
export function generateHealthInsights(biomarkers: Biomarker[]): HealthInsight[] {
  const insights: HealthInsight[] = [];
  const riskAssessments = biomarkers.map(assessBiomarkerRisk);
  
  // High-risk biomarkers insight
  const highRiskBiomarkers = riskAssessments.filter(r => r.riskLevel === 'high' || r.riskLevel === 'critical');
  if (highRiskBiomarkers.length > 0) {
    insights.push({
      id: crypto.randomUUID(),
      type: 'risk',
      title: `${highRiskBiomarkers.length} High-Risk Biomarker${highRiskBiomarkers.length > 1 ? 's' : ''} Detected`,
      description: `Critical attention needed for biomarkers showing elevated risk levels.`,
      severity: 'danger',
      biomarkers: highRiskBiomarkers.map(r => r.biomarkerId),
      actionItems: [
        'Schedule immediate consultation with healthcare provider',
        'Implement recommended lifestyle changes',
        'Begin monitoring protocols'
      ],
      references: ['Clinical Guidelines', 'Risk Assessment Protocols'],
      createdAt: new Date().toISOString()
    });
  }

  // Metabolic syndrome screening
  const metabolicMarkers = biomarkers.filter(b => 
    ['Glucose (Fasting)', 'HDL Cholesterol', 'Triglycerides', 'Blood Pressure (Systolic)'].includes(b.name)
  );
  
  if (metabolicMarkers.length >= 3) {
    const abnormalCount = metabolicMarkers.filter(b => {
      const assessment = assessBiomarkerRisk(b);
      return assessment.riskLevel !== 'low';
    }).length;

    if (abnormalCount >= 2) {
      insights.push({
        id: crypto.randomUUID(),
        type: 'correlation',
        title: 'Metabolic Syndrome Risk Factors Present',
        description: `${abnormalCount} out of ${metabolicMarkers.length} metabolic markers are abnormal, suggesting increased metabolic syndrome risk.`,
        severity: 'warning',
        biomarkers: metabolicMarkers.map(b => b.id),
        actionItems: [
          'Comprehensive metabolic evaluation',
          'Lifestyle modification program',
          'Regular monitoring of all metabolic markers'
        ],
        references: ['Metabolic Syndrome Guidelines', 'AHA/NHLBI Scientific Statement'],
        createdAt: new Date().toISOString()
      });
    }
  }

  // Cardiovascular risk assessment
  const cvdMarkers = biomarkers.filter(b => 
    ['Total Cholesterol', 'LDL Cholesterol', 'HDL Cholesterol', 'CRP', 'Blood Pressure (Systolic)'].includes(b.name)
  );
  
  if (cvdMarkers.length >= 3) {
    const cvdRisk = cvdMarkers.filter(b => {
      const assessment = assessBiomarkerRisk(b);
      return assessment.riskLevel === 'high' || assessment.riskLevel === 'critical';
    }).length;

    if (cvdRisk >= 2) {
      insights.push({
        id: crypto.randomUUID(),
        type: 'risk',
        title: 'Elevated Cardiovascular Disease Risk',
        description: 'Multiple cardiovascular risk factors detected requiring immediate attention.',
        severity: 'danger',
        biomarkers: cvdMarkers.map(b => b.id),
        actionItems: [
          'Cardiology consultation recommended',
          'Comprehensive cardiovascular risk assessment',
          'Aggressive risk factor modification'
        ],
        references: ['ACC/AHA Cardiovascular Risk Guidelines'],
        createdAt: new Date().toISOString()
      });
    }
  }

  return insights;
}

// Correlation analysis
export function analyzeCorrelations(biomarkers: Biomarker[]): CorrelationAnalysis[] {
  const correlations: CorrelationAnalysis[] = [];
  
  // Known clinical correlations
  const knownCorrelations = [
    {
      markers: ['Total Cholesterol', 'LDL Cholesterol'],
      relationship: 'positive' as const,
      relevance: 'LDL cholesterol is a major component of total cholesterol'
    },
    {
      markers: ['Glucose (Fasting)', 'Hemoglobin A1C'],
      relationship: 'positive' as const,
      relevance: 'Both reflect glucose control over different time periods'
    },
    {
      markers: ['CRP', 'ESR'],
      relationship: 'positive' as const,
      relevance: 'Both are inflammatory markers that often correlate'
    },
    {
      markers: ['Creatinine', 'BUN'],
      relationship: 'positive' as const,
      relevance: 'Both reflect kidney function and often rise together'
    }
  ];

  knownCorrelations.forEach(corr => {
    const marker1 = biomarkers.find(b => b.name === corr.markers[0]);
    const marker2 = biomarkers.find(b => b.name === corr.markers[1]);
    
    if (marker1 && marker2) {
      correlations.push({
        biomarker1: marker1.id,
        biomarker2: marker2.id,
        correlationCoefficient: 0.8, // Simplified for known correlations
        significance: 0.95,
        relationship: corr.relationship,
        clinicalRelevance: corr.relevance
      });
    }
  });

  return correlations;
}

// Main AI analysis function
export function performAIAnalysis(biomarkers: Biomarker[]): AIAnalysisResult {
  const riskAssessments = biomarkers.map(assessBiomarkerRisk);
  const trendAnalyses = biomarkers.map(analyzeTrend).filter(Boolean) as TrendAnalysis[];
  const healthInsights = generateHealthInsights(biomarkers);
  const correlations = analyzeCorrelations(biomarkers);
  
  // Calculate overall health score
  const totalRiskScore = riskAssessments.reduce((sum, r) => sum + r.riskScore, 0);
  const averageRiskScore = riskAssessments.length > 0 ? totalRiskScore / riskAssessments.length : 0;
  const overallHealthScore = Math.max(0, 100 - averageRiskScore);
  
  // Generate priority actions
  const priorityActions: string[] = [];
  const criticalRisks = riskAssessments.filter(r => r.riskLevel === 'critical');
  const highRisks = riskAssessments.filter(r => r.riskLevel === 'high');
  
  if (criticalRisks.length > 0) {
    priorityActions.push('Seek immediate medical attention for critical biomarkers');
  }
  if (highRisks.length > 0) {
    priorityActions.push('Schedule urgent consultation for high-risk biomarkers');
  }
  if (trendAnalyses.some(t => t.trendDirection === 'declining')) {
    priorityActions.push('Address declining biomarker trends');
  }
  
  return {
    riskAssessments,
    trendAnalyses,
    healthInsights,
    correlations,
    overallHealthScore,
    priorityActions
  };
}