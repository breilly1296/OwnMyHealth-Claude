import type { Biomarker, RiskAssessment } from '../../types';

export interface PlainEnglishSummary {
  biomarkerId: string;
  simpleExplanation: string;
  whatItMeans: string;
  analogy?: string;
  normalContext: string;
  yourResult: string;
  actionNeeded: string;
  whyItMatters: string;
  nextSteps: string[];
  relatedFactors: string[];
  timeframe: string;
}

// Plain English explanations for each biomarker
const BIOMARKER_EXPLANATIONS = {
  'Glucose (Fasting)': {
    simple: 'Blood sugar level after not eating for 8+ hours',
    whatItMeans: 'This measures how well your body processes sugar from food',
    analogy: 'Think of glucose like fuel in your car - you need the right amount, not too much or too little',
    normalContext: 'A healthy level shows your body can properly manage sugar from meals',
    whyItMatters: 'High levels over time can damage blood vessels, nerves, and organs',
    relatedFactors: ['diet', 'exercise', 'stress', 'sleep', 'weight'],
    timeframe: 'Reflects your blood sugar control over the past 8-12 hours'
  },
  'Total Cholesterol': {
    simple: 'A waxy substance in your blood that can build up in arteries',
    whatItMeans: 'This measures all types of cholesterol combined in your bloodstream',
    analogy: 'Like grease in your kitchen pipes - a little is normal, but too much can cause blockages',
    normalContext: 'Your body needs some cholesterol to make hormones and cell walls',
    whyItMatters: 'High levels can lead to heart attacks and strokes by blocking blood flow',
    relatedFactors: ['diet', 'exercise', 'genetics', 'weight', 'age'],
    timeframe: 'Reflects your average cholesterol levels over the past 2-3 months'
  },
  'HDL Cholesterol': {
    simple: 'The "good" cholesterol that helps clean your arteries',
    whatItMeans: 'HDL acts like a cleanup crew, removing bad cholesterol from your blood vessels',
    analogy: 'Like having a good cleaning service for your arteries - more is better',
    normalContext: 'Higher levels protect against heart disease',
    whyItMatters: 'Low levels mean less protection against heart disease and stroke',
    relatedFactors: ['exercise', 'healthy fats', 'not smoking', 'moderate alcohol'],
    timeframe: 'Shows your current protective cholesterol levels'
  },
  'LDL Cholesterol': {
    simple: 'The "bad" cholesterol that can clog your arteries',
    whatItMeans: 'LDL carries cholesterol to your arteries where it can stick and cause blockages',
    analogy: 'Like sticky mud that builds up in your garden hose, reducing water flow',
    normalContext: 'Lower levels reduce your risk of heart problems',
    whyItMatters: 'High levels directly increase your risk of heart attacks and strokes',
    relatedFactors: ['saturated fat intake', 'exercise', 'weight', 'genetics'],
    timeframe: 'Reflects your recent dietary and lifestyle patterns'
  },
  'Blood Pressure (Systolic)': {
    simple: 'The pressure in your arteries when your heart beats',
    whatItMeans: 'This measures how hard your blood pushes against artery walls',
    analogy: 'Like water pressure in your home - too high can damage the pipes over time',
    normalContext: 'Normal pressure allows blood to flow smoothly without straining your heart',
    whyItMatters: 'High pressure can damage your heart, brain, kidneys, and eyes',
    relatedFactors: ['salt intake', 'stress', 'exercise', 'weight', 'alcohol'],
    timeframe: 'Shows your blood pressure at the moment it was measured'
  },
  'Hemoglobin': {
    simple: 'The protein in red blood cells that carries oxygen throughout your body',
    whatItMeans: 'This measures your blood\'s ability to deliver oxygen to your organs',
    analogy: 'Like delivery trucks carrying oxygen packages to every part of your body',
    normalContext: 'Normal levels ensure all your organs get enough oxygen to function well',
    whyItMatters: 'Low levels cause fatigue and weakness; high levels can thicken blood',
    relatedFactors: ['iron intake', 'vitamin B12', 'kidney function', 'chronic diseases'],
    timeframe: 'Reflects your oxygen-carrying capacity over the past 2-3 months'
  },
  'Vitamin D': {
    simple: 'The "sunshine vitamin" that helps your body absorb calcium',
    whatItMeans: 'This measures whether you have enough vitamin D for healthy bones and immune function',
    analogy: 'Like a key that unlocks your body\'s ability to use calcium properly',
    normalContext: 'Adequate levels support strong bones, teeth, and immune system',
    whyItMatters: 'Low levels can lead to weak bones, frequent infections, and mood problems',
    relatedFactors: ['sun exposure', 'diet', 'supplements', 'skin color', 'geographic location'],
    timeframe: 'Shows your vitamin D status over the past few weeks'
  },
  'TSH': {
    simple: 'A hormone that tells your thyroid gland how hard to work',
    whatItMeans: 'This measures whether your thyroid is producing the right amount of hormones',
    analogy: 'Like a thermostat that controls your body\'s metabolic furnace',
    normalContext: 'Normal levels mean your metabolism is running at the right speed',
    whyItMatters: 'Abnormal levels can cause weight changes, fatigue, and mood problems',
    relatedFactors: ['stress', 'iodine intake', 'genetics', 'age', 'other medications'],
    timeframe: 'Reflects your thyroid function over the past few weeks'
  },
  'CRP': {
    simple: 'A protein that increases when there\'s inflammation in your body',
    whatItMeans: 'This measures how much inflammation is present throughout your body',
    analogy: 'Like a smoke detector that goes off when there\'s a fire somewhere in your house',
    normalContext: 'Low levels suggest minimal inflammation and lower disease risk',
    whyItMatters: 'High levels indicate increased risk of heart disease and other health problems',
    relatedFactors: ['infections', 'stress', 'diet', 'exercise', 'chronic diseases'],
    timeframe: 'Shows current inflammation levels, can change within days'
  },
  'Creatinine': {
    simple: 'A waste product that your kidneys should filter out of your blood',
    whatItMeans: 'This measures how well your kidneys are cleaning waste from your blood',
    analogy: 'Like checking if your home\'s water filter is working properly',
    normalContext: 'Normal levels show your kidneys are effectively removing waste',
    whyItMatters: 'High levels suggest your kidneys aren\'t working as well as they should',
    relatedFactors: ['hydration', 'muscle mass', 'medications', 'kidney disease'],
    timeframe: 'Reflects kidney function over the past few days'
  },
  'Testosterone (Total)': {
    simple: 'The main male hormone that affects energy, muscle, and mood',
    whatItMeans: 'This measures the amount of testosterone circulating in your blood',
    analogy: 'Like fuel for your body\'s engine - affects how strong and energetic you feel',
    normalContext: 'Normal levels support healthy muscle mass, energy, and mood',
    whyItMatters: 'Low levels can cause fatigue, mood changes, and reduced muscle mass',
    relatedFactors: ['age', 'exercise', 'sleep', 'stress', 'weight', 'medications'],
    timeframe: 'Shows hormone levels at the time of testing, can vary throughout the day'
  }
};

export function generatePlainEnglishSummary(
  biomarker: Biomarker, 
  riskAssessment: RiskAssessment
): PlainEnglishSummary {
  const explanation = BIOMARKER_EXPLANATIONS[biomarker.name as keyof typeof BIOMARKER_EXPLANATIONS];

  if (!explanation) {
    return generateGenericSummary(biomarker, riskAssessment);
  }

  // Determine result interpretation
  const isHigh = biomarker.value > biomarker.normalRange.max;
  const isLow = biomarker.value < biomarker.normalRange.min;
  const isNormal = !isHigh && !isLow;

  let yourResult = '';
  let actionNeeded = '';

  if (isNormal) {
    yourResult = `Your ${biomarker.name.toLowerCase()} level of ${biomarker.value} ${biomarker.unit} is within the healthy range (${biomarker.normalRange.min}-${biomarker.normalRange.max} ${biomarker.unit}).`;
    actionNeeded = 'Keep up your current healthy habits to maintain this good result.';
  } else if (isHigh) {
    const percentageHigh = ((biomarker.value - biomarker.normalRange.max) / biomarker.normalRange.max * 100).toFixed(0);
    yourResult = `Your ${biomarker.name.toLowerCase()} level of ${biomarker.value} ${biomarker.unit} is ${percentageHigh}% above the healthy range (${biomarker.normalRange.min}-${biomarker.normalRange.max} ${biomarker.unit}).`;
    actionNeeded = getHighValueAction(biomarker.name, riskAssessment.riskLevel);
  } else {
    const percentageLow = ((biomarker.normalRange.min - biomarker.value) / biomarker.normalRange.min * 100).toFixed(0);
    yourResult = `Your ${biomarker.name.toLowerCase()} level of ${biomarker.value} ${biomarker.unit} is ${percentageLow}% below the healthy range (${biomarker.normalRange.min}-${biomarker.normalRange.max} ${biomarker.unit}).`;
    actionNeeded = getLowValueAction(biomarker.name, riskAssessment.riskLevel);
  }

  // Generate next steps based on risk level and biomarker type
  const nextSteps = generateNextSteps(biomarker.name, riskAssessment, isHigh, isLow);

  return {
    biomarkerId: biomarker.id,
    simpleExplanation: explanation.simple,
    whatItMeans: explanation.whatItMeans,
    analogy: explanation.analogy,
    normalContext: explanation.normalContext,
    yourResult,
    actionNeeded,
    whyItMatters: explanation.whyItMatters,
    nextSteps,
    relatedFactors: explanation.relatedFactors,
    timeframe: explanation.timeframe
  };
}

function getHighValueAction(biomarkerName: string, riskLevel: string): string {
  const actions = {
    'Glucose (Fasting)': {
      moderate: 'Consider reducing sugar and refined carbs in your diet, and increase physical activity.',
      high: 'Work with your doctor to create a diabetes prevention plan including diet and exercise changes.',
      critical: 'Seek immediate medical care as this level indicates diabetes and requires prompt treatment.'
    },
    'Total Cholesterol': {
      moderate: 'Try eating more fiber, less saturated fat, and exercising regularly.',
      high: 'Your doctor may recommend medication along with significant diet and lifestyle changes.',
      critical: 'Immediate medical evaluation needed - you may need medication to prevent heart problems.'
    },
    'Blood Pressure (Systolic)': {
      moderate: 'Reduce salt intake, exercise more, manage stress, and monitor your blood pressure regularly.',
      high: 'Your doctor will likely prescribe blood pressure medication and recommend lifestyle changes.',
      critical: 'This is a medical emergency - seek immediate care to prevent stroke or heart attack.'
    },
    'CRP': {
      moderate: 'Focus on anti-inflammatory foods, regular exercise, and stress reduction.',
      high: 'Your doctor needs to investigate the cause of this inflammation and may prescribe treatment.',
      critical: 'Immediate medical evaluation needed to rule out serious infections or inflammatory conditions.'
    }
  };

  const biomarkerActions = actions[biomarkerName as keyof typeof actions];
  if (biomarkerActions) {
    return biomarkerActions[riskLevel as keyof typeof biomarkerActions] || 
           'Discuss this result with your healthcare provider for personalized advice.';
  }

  return 'Work with your healthcare provider to bring this level back to the healthy range.';
}

function getLowValueAction(biomarkerName: string, riskLevel: string): string {
  const actions = {
    'HDL Cholesterol': {
      moderate: 'Increase exercise, eat healthy fats (like nuts and olive oil), and avoid smoking.',
      high: 'Your doctor may recommend specific strategies or medications to raise your good cholesterol.',
      critical: 'This very low level significantly increases heart disease risk - seek medical advice promptly.'
    },
    'Vitamin D': {
      moderate: 'Get more sunlight, eat vitamin D-rich foods, or consider a supplement.',
      high: 'Your doctor will likely recommend vitamin D supplements to correct this deficiency.',
      critical: 'This severe deficiency requires immediate supplementation under medical supervision.'
    },
    'Hemoglobin': {
      moderate: 'Eat iron-rich foods and consider having your iron levels checked.',
      high: 'Your doctor needs to investigate the cause of this anemia and provide appropriate treatment.',
      critical: 'This severe anemia requires immediate medical attention and possible treatment.'
    }
  };

  const biomarkerActions = actions[biomarkerName as keyof typeof actions];
  if (biomarkerActions) {
    return biomarkerActions[riskLevel as keyof typeof biomarkerActions] || 
           'Discuss this result with your healthcare provider for personalized advice.';
  }

  return 'Work with your healthcare provider to bring this level back to the healthy range.';
}

function generateNextSteps(
  biomarkerName: string,
  riskAssessment: RiskAssessment,
  _isHigh: boolean,
  _isLow: boolean
): string[] {
  const baseSteps = [];

  // Risk-level based steps
  if (riskAssessment.riskLevel === 'critical') {
    baseSteps.push('Contact your doctor immediately or seek emergency care');
    baseSteps.push('Do not wait - this result needs urgent medical attention');
  } else if (riskAssessment.riskLevel === 'high') {
    baseSteps.push('Schedule an appointment with your doctor within the next few days');
    baseSteps.push('Bring this report to discuss treatment options');
  } else if (riskAssessment.riskLevel === 'moderate') {
    baseSteps.push('Discuss this result at your next doctor visit');
    baseSteps.push('Start making the lifestyle changes mentioned above');
  }

  // Biomarker-specific steps
  const specificSteps = {
    'Glucose (Fasting)': [
      'Monitor your blood sugar levels if recommended by your doctor',
      'Keep a food diary to identify patterns',
      'Consider meeting with a nutritionist'
    ],
    'Total Cholesterol': [
      'Get a complete lipid panel if you haven\'t already',
      'Start a heart-healthy diet (Mediterranean diet is a good option)',
      'Aim for at least 150 minutes of exercise per week'
    ],
    'Blood Pressure (Systolic)': [
      'Monitor your blood pressure at home if possible',
      'Limit sodium to less than 2,300mg per day',
      'Practice stress-reduction techniques like meditation'
    ],
    'Vitamin D': [
      'Spend 10-15 minutes in sunlight daily (with sun protection)',
      'Include vitamin D-rich foods like fatty fish and fortified milk',
      'Ask your doctor about the right supplement dose for you'
    ]
  };

  const biomarkerSteps = specificSteps[biomarkerName as keyof typeof specificSteps] || [];
  
  return [...baseSteps, ...biomarkerSteps].slice(0, 5); // Limit to 5 steps
}

function generateGenericSummary(biomarker: Biomarker, _riskAssessment: RiskAssessment): PlainEnglishSummary {
  const isHigh = biomarker.value > biomarker.normalRange.max;
  const isLow = biomarker.value < biomarker.normalRange.min;
  
  return {
    biomarkerId: biomarker.id,
    simpleExplanation: `${biomarker.name} is a health marker measured in your blood or body`,
    whatItMeans: `This test helps your doctor understand how well certain parts of your body are functioning`,
    normalContext: `Normal levels indicate healthy function in the related body systems`,
    yourResult: `Your ${biomarker.name} level is ${biomarker.value} ${biomarker.unit}. The normal range is ${biomarker.normalRange.min}-${biomarker.normalRange.max} ${biomarker.unit}.`,
    actionNeeded: isHigh || isLow ? 
      'This result is outside the normal range and should be discussed with your healthcare provider.' :
      'This result is within the normal range.',
    whyItMatters: `Keeping this marker in the healthy range helps ensure optimal health and can prevent future health problems`,
    nextSteps: [
      'Discuss this result with your healthcare provider',
      'Ask about what factors might influence this marker',
      'Follow any recommendations for retesting or treatment'
    ],
    relatedFactors: ['diet', 'exercise', 'medications', 'other health conditions'],
    timeframe: 'Reflects your current health status'
  };
}

// Generate a comprehensive plain English report
export function generateComprehensiveReport(
  biomarkers: Biomarker[], 
  riskAssessments: RiskAssessment[]
): {
  overallSummary: string;
  keyFindings: string[];
  priorityActions: string[];
  positiveFindings: string[];
  summaries: PlainEnglishSummary[];
} {
  const summaries = biomarkers.map(biomarker => {
    const riskAssessment = riskAssessments.find(r => r.biomarkerId === biomarker.id);
    return generatePlainEnglishSummary(biomarker, riskAssessment!);
  });

  const highRiskCount = riskAssessments.filter(r => r.riskLevel === 'high' || r.riskLevel === 'critical').length;
  const normalCount = riskAssessments.filter(r => r.riskLevel === 'low').length;
  const totalCount = biomarkers.length;

  // Generate overall summary
  let overallSummary = '';
  if (highRiskCount === 0) {
    overallSummary = `Great news! Most of your lab results (${normalCount} out of ${totalCount}) are in healthy ranges. `;
    if (normalCount < totalCount) {
      overallSummary += `A few results need attention, but nothing urgent.`;
    } else {
      overallSummary += `Keep up the good work with your current health habits!`;
    }
  } else if (highRiskCount === 1) {
    overallSummary = `Your lab results show one area that needs prompt attention, while most other results are acceptable. Focus on addressing the high-priority item first.`;
  } else {
    overallSummary = `Your lab results show ${highRiskCount} areas that need medical attention. Don't be overwhelmed - your healthcare team can help you address these systematically.`;
  }

  // Key findings
  const keyFindings = riskAssessments
    .filter(r => r.riskLevel !== 'low')
    .sort((a, b) => b.riskScore - a.riskScore)
    .slice(0, 3)
    .map(r => {
      const biomarker = biomarkers.find(b => b.id === r.biomarkerId)!;
      const isHigh = biomarker.value > biomarker.normalRange.max;
      const isLow = biomarker.value < biomarker.normalRange.min;
      return `${biomarker.name} is ${isHigh ? 'elevated' : isLow ? 'low' : 'abnormal'} and ${r.riskLevel === 'critical' ? 'needs immediate attention' : r.riskLevel === 'high' ? 'requires prompt medical care' : 'should be monitored'}`;
    });

  // Priority actions
  const priorityActions = riskAssessments
    .filter(r => r.riskLevel === 'critical' || r.riskLevel === 'high')
    .slice(0, 3)
    .map(r => {
      if (r.riskLevel === 'critical') {
        return 'Seek immediate medical care for critical results';
      } else {
        return 'Schedule urgent appointment with your healthcare provider';
      }
    });

  // Positive findings
  const positiveFindings = riskAssessments
    .filter(r => r.riskLevel === 'low')
    .slice(0, 3)
    .map(r => {
      const biomarker = biomarkers.find(b => b.id === r.biomarkerId)!;
      return `${biomarker.name} is in a healthy range`;
    });

  return {
    overallSummary,
    keyFindings,
    priorityActions,
    positiveFindings,
    summaries
  };
}