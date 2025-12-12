import type {
  InsurancePlan,
  DetectedCondition,
  Biomarker
} from '../../types';
import { detectConditionsFromBiomarkers, getSpecialistRecommendations } from './conditionProviderMapping';

// Provider directory types
export interface HealthcareProvider {
  id: string;
  name: string;
  specialty: string;
  credentials: string[];
  address: {
    street: string;
    city: string;
    state: string;
    zipCode: string;
    coordinates?: {
      lat: number;
      lng: number;
    };
  };
  phone: string;
  website?: string;
  rating: number;
  reviewCount: number;
  acceptingNewPatients: boolean;
  languages: string[];
  hospitalAffiliations: string[];
  insuranceAccepted: string[];
  distance?: number;
  nextAvailableAppointment?: string;
  profileImage?: string;
  education: EducationInfo[];
  boardCertifications: string[];
  specialtyFocus?: string[]; // Sub-specialties or areas of focus
  conditionsManaged?: string[]; // Specific conditions this provider manages
}

export interface EducationInfo {
  institution: string;
  degree: string;
  year: number;
}

export interface ProviderSearchCriteria {
  specialty: string;
  location: {
    lat: number;
    lng: number;
    radius: number; // in miles
  };
  insurancePlans: string[];
  acceptingNewPatients?: boolean;
  minRating?: number;
  languages?: string[];
  gender?: 'male' | 'female';
  conditionsManaged?: string[]; // Filter by specific conditions
  urgency?: 'urgent' | 'routine' | 'preventive';
}

export interface ProviderSearchResult {
  providers: HealthcareProvider[];
  totalCount: number;
  searchCriteria: ProviderSearchCriteria;
  suggestions: ProviderSuggestion[];
  conditionMatches?: ConditionMatch[]; // How well providers match detected conditions
}

export interface ProviderSuggestion {
  type: 'specialty' | 'location' | 'insurance' | 'availability' | 'condition';
  message: string;
  action: string;
}

export interface ConditionMatch {
  providerId: string;
  matchedConditions: string[];
  matchScore: number; // 0-1 score of how well provider matches conditions
  specialtyRelevance: number; // How relevant the specialty is to conditions
}

// Enhanced mock provider data with condition specializations
const MOCK_PROVIDERS: HealthcareProvider[] = [
  {
    id: 'endo-001',
    name: 'Dr. Sarah Chen',
    specialty: 'Endocrinology',
    credentials: ['MD', 'Board Certified Endocrinologist'],
    address: {
      street: '123 Medical Center Dr',
      city: 'San Francisco',
      state: 'CA',
      zipCode: '94102',
      coordinates: { lat: 37.7749, lng: -122.4194 }
    },
    phone: '(415) 555-0123',
    website: 'https://example-medical.com/dr-chen',
    rating: 4.8,
    reviewCount: 127,
    acceptingNewPatients: true,
    languages: ['English', 'Mandarin'],
    hospitalAffiliations: ['UCSF Medical Center', 'California Pacific Medical Center'],
    insuranceAccepted: ['Blue Cross Blue Shield', 'Aetna', 'UnitedHealthcare', 'Kaiser Permanente'],
    nextAvailableAppointment: '2024-04-15',
    profileImage: 'https://images.unsplash.com/photo-1559839734-2b71ea197ec2?w=400&h=400&fit=crop&crop=face',
    education: [
      { institution: 'Harvard Medical School', degree: 'MD', year: 2010 },
      { institution: 'Johns Hopkins', degree: 'Endocrinology Fellowship', year: 2014 }
    ],
    boardCertifications: ['American Board of Internal Medicine', 'American Board of Endocrinology'],
    specialtyFocus: ['PCOS', 'Diabetes', 'Thyroid Disorders', 'Bone Health'],
    conditionsManaged: ['PCOS/Hormonal Imbalance', 'Insulin Resistance/Prediabetes', 'Thyroid Dysfunction', 'Low Bone Density', 'Vitamin D Deficiency']
  },
  {
    id: 'cardio-001',
    name: 'Dr. Michael Rodriguez',
    specialty: 'Cardiology',
    credentials: ['MD', 'FACC', 'Board Certified Cardiologist'],
    address: {
      street: '456 Heart Institute Way',
      city: 'San Francisco',
      state: 'CA',
      zipCode: '94105',
      coordinates: { lat: 37.7849, lng: -122.4094 }
    },
    phone: '(415) 555-0456',
    website: 'https://heart-institute.com/dr-rodriguez',
    rating: 4.9,
    reviewCount: 203,
    acceptingNewPatients: true,
    languages: ['English', 'Spanish'],
    hospitalAffiliations: ['UCSF Medical Center', 'St. Mary\'s Medical Center'],
    insuranceAccepted: ['Blue Cross Blue Shield', 'Aetna', 'Cigna', 'UnitedHealthcare'],
    nextAvailableAppointment: '2024-04-18',
    profileImage: 'https://images.unsplash.com/photo-1612349317150-e413f6a5b16d?w=400&h=400&fit=crop&crop=face',
    education: [
      { institution: 'Stanford Medical School', degree: 'MD', year: 2008 },
      { institution: 'Mayo Clinic', degree: 'Cardiology Fellowship', year: 2012 }
    ],
    boardCertifications: ['American Board of Internal Medicine', 'American Board of Cardiovascular Disease'],
    specialtyFocus: ['Preventive Cardiology', 'Lipid Disorders', 'Hypertension', 'Heart Failure'],
    conditionsManaged: ['Cardiovascular Disease Risk', 'Chronic Inflammation']
  },
  {
    id: 'rheum-001',
    name: 'Dr. Emily Johnson',
    specialty: 'Rheumatology',
    credentials: ['MD', 'PhD', 'Board Certified Rheumatologist'],
    address: {
      street: '789 Autoimmune Clinic Blvd',
      city: 'San Francisco',
      state: 'CA',
      zipCode: '94107',
      coordinates: { lat: 37.7649, lng: -122.3994 }
    },
    phone: '(415) 555-0789',
    rating: 4.7,
    reviewCount: 89,
    acceptingNewPatients: false,
    languages: ['English'],
    hospitalAffiliations: ['UCSF Medical Center'],
    insuranceAccepted: ['Blue Cross Blue Shield', 'UnitedHealthcare', 'Medicare'],
    nextAvailableAppointment: '2024-05-02',
    profileImage: 'https://images.unsplash.com/photo-1594824475317-29bb4b8b2b8e?w=400&h=400&fit=crop&crop=face',
    education: [
      { institution: 'University of Pennsylvania', degree: 'MD/PhD', year: 2009 },
      { institution: 'Hospital for Special Surgery', degree: 'Rheumatology Fellowship', year: 2013 }
    ],
    boardCertifications: ['American Board of Internal Medicine', 'American Board of Rheumatology'],
    specialtyFocus: ['Osteoporosis', 'Autoimmune Disorders', 'Inflammatory Arthritis'],
    conditionsManaged: ['Low Bone Density', 'Chronic Inflammation']
  },
  {
    id: 'repro-endo-001',
    name: 'Dr. Lisa Park',
    specialty: 'Reproductive Endocrinology',
    credentials: ['MD', 'Board Certified Reproductive Endocrinologist'],
    address: {
      street: '321 Women\'s Health Center',
      city: 'San Francisco',
      state: 'CA',
      zipCode: '94103',
      coordinates: { lat: 37.7549, lng: -122.4294 }
    },
    phone: '(415) 555-0321',
    rating: 4.6,
    reviewCount: 156,
    acceptingNewPatients: true,
    languages: ['English', 'Korean'],
    hospitalAffiliations: ['California Pacific Medical Center', 'St. Mary\'s Medical Center'],
    insuranceAccepted: ['Blue Cross Blue Shield', 'Aetna', 'Kaiser Permanente'],
    nextAvailableAppointment: '2024-04-12',
    profileImage: 'https://images.unsplash.com/photo-1582750433449-648ed127bb54?w=400&h=400&fit=crop&crop=face',
    education: [
      { institution: 'UCLA Medical School', degree: 'MD', year: 2011 },
      { institution: 'Cedars-Sinai', degree: 'REI Fellowship', year: 2016 }
    ],
    boardCertifications: ['American Board of Obstetrics and Gynecology', 'American Board of Reproductive Endocrinology'],
    specialtyFocus: ['PCOS', 'Fertility', 'Hormonal Disorders', 'Menstrual Irregularities'],
    conditionsManaged: ['PCOS/Hormonal Imbalance', 'Insulin Resistance/Prediabetes']
  },
  {
    id: 'nephro-001',
    name: 'Dr. James Wilson',
    specialty: 'Nephrology',
    credentials: ['MD', 'Board Certified Nephrologist'],
    address: {
      street: '555 Kidney Care Center',
      city: 'San Francisco',
      state: 'CA',
      zipCode: '94108',
      coordinates: { lat: 37.7849, lng: -122.4194 }
    },
    phone: '(415) 555-0555',
    rating: 4.5,
    reviewCount: 98,
    acceptingNewPatients: true,
    languages: ['English'],
    hospitalAffiliations: ['UCSF Medical Center', 'California Pacific Medical Center'],
    insuranceAccepted: ['Blue Cross Blue Shield', 'UnitedHealthcare', 'Aetna'],
    nextAvailableAppointment: '2024-04-20',
    profileImage: 'https://images.unsplash.com/photo-1622253692010-333f2da6031d?w=400&h=400&fit=crop&crop=face',
    education: [
      { institution: 'Johns Hopkins Medical School', degree: 'MD', year: 2009 },
      { institution: 'Mayo Clinic', degree: 'Nephrology Fellowship', year: 2013 }
    ],
    boardCertifications: ['American Board of Internal Medicine', 'American Board of Nephrology'],
    specialtyFocus: ['Chronic Kidney Disease', 'Hypertension', 'Electrolyte Disorders'],
    conditionsManaged: ['Kidney Function Decline']
  },
  {
    id: 'hemato-001',
    name: 'Dr. Maria Gonzalez',
    specialty: 'Hematology',
    credentials: ['MD', 'Board Certified Hematologist'],
    address: {
      street: '777 Blood Center Ave',
      city: 'San Francisco',
      state: 'CA',
      zipCode: '94109',
      coordinates: { lat: 37.7649, lng: -122.4094 }
    },
    phone: '(415) 555-0777',
    rating: 4.7,
    reviewCount: 134,
    acceptingNewPatients: true,
    languages: ['English', 'Spanish'],
    hospitalAffiliations: ['UCSF Medical Center'],
    insuranceAccepted: ['Blue Cross Blue Shield', 'Aetna', 'UnitedHealthcare'],
    nextAvailableAppointment: '2024-04-25',
    profileImage: 'https://images.unsplash.com/photo-1594824475317-29bb4b8b2b8e?w=400&h=400&fit=crop&crop=face',
    education: [
      { institution: 'Stanford Medical School', degree: 'MD', year: 2012 },
      { institution: 'UCSF', degree: 'Hematology Fellowship', year: 2016 }
    ],
    boardCertifications: ['American Board of Internal Medicine', 'American Board of Hematology'],
    specialtyFocus: ['Anemia', 'Iron Deficiency', 'Blood Disorders'],
    conditionsManaged: ['Anemia']
  }
];

// Enhanced search function with condition-based filtering
export async function searchProviders(criteria: ProviderSearchCriteria): Promise<ProviderSearchResult> {
  // Minimal delay to maintain async behavior (removed 1000ms artificial delay)

  // Filter providers based on criteria
  let filteredProviders = MOCK_PROVIDERS.filter(provider => {
    // Specialty match
    if (!provider.specialty.toLowerCase().includes(criteria.specialty.toLowerCase())) {
      return false;
    }

    // Insurance match
    if (criteria.insurancePlans.length > 0) {
      const hasMatchingInsurance = criteria.insurancePlans.some(plan => 
        provider.insuranceAccepted.some(accepted => 
          accepted.toLowerCase().includes(plan.toLowerCase()) ||
          plan.toLowerCase().includes(accepted.toLowerCase())
        )
      );
      if (!hasMatchingInsurance) return false;
    }

    // Accepting new patients
    if (criteria.acceptingNewPatients && !provider.acceptingNewPatients) {
      return false;
    }

    // Minimum rating
    if (criteria.minRating && provider.rating < criteria.minRating) {
      return false;
    }

    // Languages
    if (criteria.languages && criteria.languages.length > 0) {
      const hasMatchingLanguage = criteria.languages.some(lang => 
        provider.languages.includes(lang)
      );
      if (!hasMatchingLanguage) return false;
    }

    // Condition-based filtering
    if (criteria.conditionsManaged && criteria.conditionsManaged.length > 0) {
      const hasMatchingCondition = criteria.conditionsManaged.some(condition => 
        provider.conditionsManaged?.includes(condition)
      );
      if (!hasMatchingCondition) return false;
    }

    return true;
  });

  // Calculate distances and sort by distance
  filteredProviders = filteredProviders.map(provider => ({
    ...provider,
    distance: calculateDistance(
      criteria.location.lat,
      criteria.location.lng,
      provider.address.coordinates?.lat || 37.7749,
      provider.address.coordinates?.lng || -122.4194
    )
  })).sort((a, b) => (a.distance || 0) - (b.distance || 0));

  // Filter by radius
  filteredProviders = filteredProviders.filter(provider => 
    (provider.distance || 0) <= criteria.location.radius
  );

  // Calculate condition matches if conditions are specified
  const conditionMatches = criteria.conditionsManaged ? 
    calculateConditionMatches(filteredProviders, criteria.conditionsManaged) : [];

  // Sort by condition match score if available, otherwise by distance
  if (conditionMatches.length > 0) {
    filteredProviders.sort((a, b) => {
      const matchA = conditionMatches.find(m => m.providerId === a.id);
      const matchB = conditionMatches.find(m => m.providerId === b.id);
      return (matchB?.matchScore || 0) - (matchA?.matchScore || 0);
    });
  }

  // Generate suggestions
  const suggestions = generateSearchSuggestions(criteria, filteredProviders);

  return {
    providers: filteredProviders,
    totalCount: filteredProviders.length,
    searchCriteria: criteria,
    suggestions,
    conditionMatches
  };
}

// Enhanced function to get recommendations based on biomarkers
export function getRecommendedSpecialistsFromBiomarkers(
  biomarkers: Biomarker[],
  userLocation: { lat: number; lng: number },
  insurancePlans: InsurancePlan[]
): ProviderSearchCriteria[] {
  // Detect conditions from biomarkers
  const detectedConditions = detectConditionsFromBiomarkers(biomarkers);
  
  // Get specialist recommendations
  const specialistRecommendations = getSpecialistRecommendations(detectedConditions);
  
  const recommendations: ProviderSearchCriteria[] = [];
  
  specialistRecommendations.forEach(rec => {
    recommendations.push({
      specialty: rec.specialty,
      location: {
        ...userLocation,
        radius: rec.urgency === 'urgent' ? 50 : 25 // Larger radius for urgent cases
      },
      insurancePlans: insurancePlans.map(plan => plan.insurerName),
      acceptingNewPatients: true,
      minRating: rec.urgency === 'urgent' ? 3.5 : 4.0, // Lower rating threshold for urgent cases
      conditionsManaged: rec.relatedConditions,
      urgency: rec.urgency
    });
  });

  return recommendations;
}

export async function getProviderDetails(providerId: string): Promise<HealthcareProvider | null> {
  // Removed 500ms artificial delay - returns immediately for better UX
  return MOCK_PROVIDERS.find(provider => provider.id === providerId) || null;
}

export async function checkInsuranceAcceptance(
  providerId: string, 
  insurancePlan: string
): Promise<{
  accepted: boolean;
  copay?: number;
  coinsurance?: number;
  notes?: string;
}> {
  // Removed 300ms artificial delay - returns immediately for better UX
  const provider = MOCK_PROVIDERS.find(p => p.id === providerId);
  if (!provider) {
    return { accepted: false };
  }

  const accepted = provider.insuranceAccepted.some(plan => 
    plan.toLowerCase().includes(insurancePlan.toLowerCase()) ||
    insurancePlan.toLowerCase().includes(plan.toLowerCase())
  );

  if (accepted) {
    // Mock insurance details - in production, this would come from insurance verification
    return {
      accepted: true,
      copay: provider.specialty === 'Cardiology' ? 60 : 
             provider.specialty === 'Reproductive Endocrinology' ? 55 :
             provider.specialty === 'Endocrinology' ? 50 : 40,
      coinsurance: 20,
      notes: 'Specialist visit copay applies. Prior authorization may be required for certain procedures.'
    };
  }

  return { 
    accepted: false, 
    notes: 'This provider is not in your insurance network. You may still see them but will pay out-of-network rates.' 
  };
}

// Enhanced function to generate provider recommendations with condition matching
export function generateProviderRecommendationsFromBiomarkers(
  biomarkers: Biomarker[],
  userLocation: { lat: number; lng: number },
  insurancePlans: InsurancePlan[]
): {
  urgentReferrals: ProviderRecommendation[];
  routineReferrals: ProviderRecommendation[];
  preventiveReferrals: ProviderRecommendation[];
  detectedConditions: DetectedCondition[];
} {
  // Detect conditions from biomarkers
  const detectedConditions = detectConditionsFromBiomarkers(biomarkers);
  
  // Get specialist recommendations
  const specialistRecommendations = getSpecialistRecommendations(detectedConditions);

  const urgentReferrals: ProviderRecommendation[] = [];
  const routineReferrals: ProviderRecommendation[] = [];
  const preventiveReferrals: ProviderRecommendation[] = [];

  specialistRecommendations.forEach(rec => {
    const recommendation: ProviderRecommendation = {
      specialty: rec.specialty,
      reason: rec.reason,
      urgency: rec.urgency,
      expectedCosts: rec.expectedCosts,
      insuranceCoverage: insurancePlans.map(plan => ({
        planName: plan.planName,
        copay: rec.expectedCosts.consultation * 0.15, // Estimate 15% copay
        coinsurance: 20,
        covered: true
      })),
      timeframe: rec.timeframe,
      confidence: rec.confidence,
      relatedConditions: rec.relatedConditions,
      requiredServices: rec.requiredServices
    };

    if (recommendation.urgency === 'urgent') {
      urgentReferrals.push(recommendation);
    } else if (recommendation.urgency === 'routine') {
      routineReferrals.push(recommendation);
    } else {
      preventiveReferrals.push(recommendation);
    }
  });

  return {
    urgentReferrals,
    routineReferrals,
    preventiveReferrals,
    detectedConditions
  };
}

// Helper function to calculate condition matches
function calculateConditionMatches(
  providers: HealthcareProvider[], 
  conditions: string[]
): ConditionMatch[] {
  return providers.map(provider => {
    const matchedConditions = conditions.filter(condition => 
      provider.conditionsManaged?.includes(condition)
    );
    
    const matchScore = matchedConditions.length / conditions.length;
    
    // Bonus for specialty focus alignment
    const specialtyRelevance = provider.specialtyFocus?.some(focus => 
      conditions.some(condition => condition.toLowerCase().includes(focus.toLowerCase()))
    ) ? 0.2 : 0;

    return {
      providerId: provider.id,
      matchedConditions,
      matchScore: Math.min(matchScore + specialtyRelevance, 1.0),
      specialtyRelevance
    };
  }).filter(match => match.matchScore > 0);
}

// Utility functions
function calculateDistance(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 3959; // Earth's radius in miles
  const dLat = toRadians(lat2 - lat1);
  const dLng = toRadians(lng2 - lng1);
  const a = 
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRadians(lat1)) * Math.cos(toRadians(lat2)) *
    Math.sin(dLng / 2) * Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

function toRadians(degrees: number): number {
  return degrees * (Math.PI / 180);
}

function generateSearchSuggestions(
  criteria: ProviderSearchCriteria,
  results: HealthcareProvider[]
): ProviderSuggestion[] {
  const suggestions: ProviderSuggestion[] = [];

  if (results.length === 0) {
    suggestions.push({
      type: 'location',
      message: 'No providers found in your area',
      action: 'Try expanding your search radius to 50 miles'
    });

    if (criteria.conditionsManaged && criteria.conditionsManaged.length > 0) {
      suggestions.push({
        type: 'condition',
        message: 'No specialists found for your specific conditions',
        action: 'Consider related specialties or telehealth consultations'
      });
    }

    suggestions.push({
      type: 'insurance',
      message: 'Consider out-of-network options',
      action: 'View providers who may not accept your insurance but offer payment plans'
    });
  } else if (results.length < 3) {
    suggestions.push({
      type: 'specialty',
      message: 'Limited options available',
      action: 'Consider related specialties or telehealth consultations'
    });
  }

  const notAcceptingNewPatients = results.filter(p => !p.acceptingNewPatients).length;
  if (notAcceptingNewPatients > 0) {
    suggestions.push({
      type: 'availability',
      message: `${notAcceptingNewPatients} provider(s) not accepting new patients`,
      action: 'Join waitlists or check for cancellations'
    });
  }

  return suggestions;
}

// Location services
export async function getCurrentLocation(): Promise<{ lat: number; lng: number } | null> {
  return new Promise((resolve) => {
    if (!navigator.geolocation) {
      resolve(null);
      return;
    }

    navigator.geolocation.getCurrentPosition(
      (position) => {
        resolve({
          lat: position.coords.latitude,
          lng: position.coords.longitude
        });
      },
      () => {
        // Default to San Francisco if location access denied
        resolve({ lat: 37.7749, lng: -122.4194 });
      },
      { timeout: 10000 }
    );
  });
}

export async function geocodeAddress(_address: string): Promise<{ lat: number; lng: number } | null> {
  // In production, this would use a real geocoding service
  // For now, return San Francisco coordinates (removed 500ms artificial delay)
  return { lat: 37.7749, lng: -122.4194 };
}

// Extended provider recommendation interface
export interface ProviderRecommendation {
  specialty: string;
  reason: string;
  urgency: 'urgent' | 'routine' | 'preventive';
  expectedCosts: {
    consultation: number;
    followUp: number;
    diagnostics: number;
  };
  insuranceCoverage: {
    planName: string;
    copay: number;
    coinsurance: number;
    covered: boolean;
  }[];
  timeframe: string;
  confidence?: number;
  relatedConditions?: string[];
  requiredServices?: string[];
}