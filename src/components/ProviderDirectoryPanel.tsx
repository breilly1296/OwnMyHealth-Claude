import React, { useState, useEffect } from 'react';
import { 
  MapPin, 
  Phone, 
  Star, 
  Clock, 
  Users, 
  Shield, 
  Search,
  Filter,
  Navigation,
  Calendar,
  CheckCircle,
  XCircle,
  AlertCircle,
  ExternalLink,
  User,
  Award,
  Building,
  Globe,
  DollarSign,
  Loader2,
  Target,
  TrendingUp,
  Activity,
  Zap,
  Heart
} from 'lucide-react';
import type { 
  HealthcareProvider, 
  ProviderSearchCriteria, 
  ProviderSearchResult,
  InsurancePlan,
  HealthNeedsAnalysis,
  ProviderRecommendation,
  Biomarker
} from '../types';
import { 
  searchProviders, 
  getRecommendedSpecialistsFromBiomarkers, 
  checkInsuranceAcceptance,
  getCurrentLocation,
  generateProviderRecommendationsFromBiomarkers
} from '../utils/providerDirectory';

interface ProviderDirectoryPanelProps {
  healthNeeds: HealthNeedsAnalysis;
  insurancePlans: InsurancePlan[];
  biomarkers?: Biomarker[]; // Add biomarkers prop for condition detection
}

const SPECIALTY_OPTIONS = [
  'Endocrinology',
  'Reproductive Endocrinology',
  'Cardiology',
  'Rheumatology',
  'Nephrology',
  'Hematology',
  'Hepatology',
  'Gynecology',
  'Internal Medicine',
  'Family Medicine',
  'Dermatology',
  'Orthopedics',
  'Neurology',
  'Psychiatry'
];

export default function ProviderDirectoryPanel({ healthNeeds, insurancePlans, biomarkers = [] }: ProviderDirectoryPanelProps) {
  const [searchResults, setSearchResults] = useState<ProviderSearchResult | null>(null);
  const [selectedProvider, setSelectedProvider] = useState<HealthcareProvider | null>(null);
  const [userLocation, setUserLocation] = useState<{ lat: number; lng: number } | null>(null);
  const [searchCriteria, setSearchCriteria] = useState<ProviderSearchCriteria>({
    specialty: '',
    location: { lat: 37.7749, lng: -122.4194, radius: 25 },
    insurancePlans: insurancePlans.map(plan => plan.insurerName),
    acceptingNewPatients: true,
    minRating: 4.0
  });
  const [isSearching, setIsSearching] = useState(false);
  const [insuranceVerification, setInsuranceVerification] = useState<Map<string, any>>(new Map());
  const [activeTab, setActiveTab] = useState<'smart-recommendations' | 'search'>('smart-recommendations');

  useEffect(() => {
    // Get user's current location
    getCurrentLocation().then(location => {
      if (location) {
        setUserLocation(location);
        setSearchCriteria(prev => ({
          ...prev,
          location: { ...location, radius: 25 }
        }));
      }
    });
  }, []);

  const handleSearch = async () => {
    if (!searchCriteria.specialty) return;
    
    setIsSearching(true);
    try {
      const results = await searchProviders(searchCriteria);
      setSearchResults(results);
    } catch (error) {
      console.error('Search failed:', error);
    } finally {
      setIsSearching(false);
    }
  };

  const handleProviderSelect = async (provider: HealthcareProvider) => {
    setSelectedProvider(provider);
    
    // Check insurance acceptance for each plan
    const verifications = new Map();
    for (const plan of insurancePlans) {
      try {
        const verification = await checkInsuranceAcceptance(provider.id, plan.insurerName);
        verifications.set(plan.id, verification);
      } catch (error) {
        console.error('Insurance verification failed:', error);
      }
    }
    setInsuranceVerification(verifications);
  };

  // Generate smart recommendations based on biomarkers
  const smartRecommendations = biomarkers.length > 0 ? 
    generateProviderRecommendationsFromBiomarkers(
      biomarkers,
      userLocation || { lat: 37.7749, lng: -122.4194 },
      insurancePlans
    ) : {
      urgentReferrals: [],
      routineReferrals: [],
      preventiveReferrals: [],
      detectedConditions: []
    };

  const formatDistance = (distance?: number) => {
    if (!distance) return '';
    return distance < 1 ? `${(distance * 5280).toFixed(0)} ft` : `${distance.toFixed(1)} mi`;
  };

  const formatNextAppointment = (date?: string) => {
    if (!date) return 'Call for availability';
    const appointmentDate = new Date(date);
    const today = new Date();
    const diffTime = appointmentDate.getTime() - today.getTime();
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    
    if (diffDays <= 7) return `${diffDays} days`;
    if (diffDays <= 30) return `${Math.ceil(diffDays / 7)} weeks`;
    return `${Math.ceil(diffDays / 30)} months`;
  };

  const getConditionIcon = (condition: string) => {
    if (condition.includes('Bone')) return <Activity className="w-4 h-4" />;
    if (condition.includes('Cardiovascular')) return <Heart className="w-4 h-4" />;
    if (condition.includes('Diabetes') || condition.includes('Insulin')) return <TrendingUp className="w-4 h-4" />;
    if (condition.includes('Thyroid')) return <Zap className="w-4 h-4" />;
    if (condition.includes('PCOS') || condition.includes('Hormonal')) return <Target className="w-4 h-4" />;
    return <AlertCircle className="w-4 h-4" />;
  };

  const renderProviderCard = (provider: HealthcareProvider, recommendation?: ProviderRecommendation) => (
    <div 
      key={provider.id}
      className="border border-gray-200 rounded-lg p-4 hover:shadow-md transition-shadow cursor-pointer"
      onClick={() => handleProviderSelect(provider)}
    >
      <div className="flex items-start space-x-4">
        {provider.profileImage && (
          <img 
            src={provider.profileImage} 
            alt={provider.name}
            className="w-16 h-16 rounded-full object-cover"
          />
        )}
        
        <div className="flex-1">
          <div className="flex items-start justify-between">
            <div>
              <h3 className="font-medium text-gray-900">{provider.name}</h3>
              <p className="text-sm text-gray-600">{provider.specialty}</p>
              
              {/* Specialty Focus */}
              {provider.specialtyFocus && provider.specialtyFocus.length > 0 && (
                <div className="flex flex-wrap gap-1 mt-1">
                  {provider.specialtyFocus.slice(0, 3).map((focus, index) => (
                    <span key={index} className="inline-flex items-center px-2 py-0.5 bg-blue-100 text-blue-700 text-xs rounded">
                      {focus}
                    </span>
                  ))}
                  {provider.specialtyFocus.length > 3 && (
                    <span className="text-xs text-gray-500">+{provider.specialtyFocus.length - 3} more</span>
                  )}
                </div>
              )}

              <div className="flex items-center mt-2">
                <div className="flex items-center">
                  <Star className="w-4 h-4 text-yellow-400 fill-current" />
                  <span className="text-sm text-gray-600 ml-1">
                    {provider.rating} ({provider.reviewCount} reviews)
                  </span>
                </div>
                {provider.distance && (
                  <>
                    <span className="mx-2 text-gray-300">•</span>
                    <span className="text-sm text-gray-600">{formatDistance(provider.distance)}</span>
                  </>
                )}
              </div>
            </div>
            
            <div className="text-right">
              <div className={`inline-flex items-center px-2 py-1 rounded-full text-xs font-medium ${
                provider.acceptingNewPatients 
                  ? 'bg-green-100 text-green-800' 
                  : 'bg-red-100 text-red-800'
              }`}>
                {provider.acceptingNewPatients ? (
                  <CheckCircle className="w-3 h-3 mr-1" />
                ) : (
                  <XCircle className="w-3 h-3 mr-1" />
                )}
                {provider.acceptingNewPatients ? 'Accepting Patients' : 'Not Accepting'}
              </div>
              
              <div className="text-sm text-gray-600 mt-1 flex items-center">
                <Clock className="w-3 h-3 mr-1" />
                Next: {formatNextAppointment(provider.nextAvailableAppointment)}
              </div>
            </div>
          </div>

          <div className="mt-3 flex items-center space-x-4 text-sm text-gray-600">
            <div className="flex items-center">
              <MapPin className="w-4 h-4 mr-1" />
              {provider.address.city}, {provider.address.state}
            </div>
            <div className="flex items-center">
              <Phone className="w-4 h-4 mr-1" />
              {provider.phone}
            </div>
          </div>

          {/* Condition Matches */}
          {provider.conditionsManaged && provider.conditionsManaged.length > 0 && (
            <div className="mt-3">
              <p className="text-xs text-gray-500 mb-1">Manages conditions:</p>
              <div className="flex flex-wrap gap-1">
                {provider.conditionsManaged.slice(0, 2).map((condition, index) => (
                  <span key={index} className="inline-flex items-center px-2 py-0.5 bg-green-100 text-green-700 text-xs rounded">
                    {getConditionIcon(condition)}
                    <span className="ml-1">{condition}</span>
                  </span>
                ))}
                {provider.conditionsManaged.length > 2 && (
                  <span className="text-xs text-gray-500">+{provider.conditionsManaged.length - 2} more</span>
                )}
              </div>
            </div>
          )}

          {recommendation && (
            <div className="mt-3 p-3 bg-blue-50 border border-blue-200 rounded-lg">
              <p className="text-sm text-blue-800">
                <strong>Recommended for:</strong> {recommendation.reason}
              </p>
              <div className="flex items-center justify-between mt-2 text-xs text-blue-700">
                <span>Expected consultation: ${recommendation.expectedCosts.consultation}</span>
                <span className={`px-2 py-1 rounded ${
                  recommendation.urgency === 'urgent' ? 'bg-red-100 text-red-800' :
                  recommendation.urgency === 'routine' ? 'bg-yellow-100 text-yellow-800' :
                  'bg-green-100 text-green-800'
                }`}>
                  {recommendation.timeframe}
                </span>
              </div>
              {recommendation.confidence && (
                <div className="mt-1 text-xs text-blue-600">
                  Match confidence: {Math.round(recommendation.confidence * 100)}%
                </div>
              )}
            </div>
          )}

          <div className="mt-3 flex flex-wrap gap-2">
            {provider.insuranceAccepted.slice(0, 3).map((insurance, index) => (
              <span key={index} className="inline-flex items-center px-2 py-1 bg-gray-100 text-gray-700 text-xs rounded">
                <Shield className="w-3 h-3 mr-1" />
                {insurance}
              </span>
            ))}
            {provider.insuranceAccepted.length > 3 && (
              <span className="text-xs text-gray-500">
                +{provider.insuranceAccepted.length - 3} more
              </span>
            )}
          </div>
        </div>
      </div>
    </div>
  );

  const renderProviderDetails = () => {
    if (!selectedProvider) return null;

    return (
      <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
        <div className="bg-white rounded-lg w-full max-w-4xl max-h-[90vh] overflow-y-auto">
          {/* Header */}
          <div className="p-6 border-b border-gray-200">
            <div className="flex items-start justify-between">
              <div className="flex items-start space-x-4">
                {selectedProvider.profileImage && (
                  <img 
                    src={selectedProvider.profileImage} 
                    alt={selectedProvider.name}
                    className="w-20 h-20 rounded-full object-cover"
                  />
                )}
                <div>
                  <h2 className="text-2xl font-semibold text-gray-900">{selectedProvider.name}</h2>
                  <p className="text-lg text-gray-600">{selectedProvider.specialty}</p>
                  <div className="flex items-center mt-2">
                    <div className="flex items-center">
                      <Star className="w-5 h-5 text-yellow-400 fill-current" />
                      <span className="text-gray-600 ml-1">
                        {selectedProvider.rating} ({selectedProvider.reviewCount} reviews)
                      </span>
                    </div>
                    {selectedProvider.distance && (
                      <>
                        <span className="mx-3 text-gray-300">•</span>
                        <span className="text-gray-600">{formatDistance(selectedProvider.distance)} away</span>
                      </>
                    )}
                  </div>
                </div>
              </div>
              <button 
                onClick={() => setSelectedProvider(null)}
                className="text-gray-500 hover:text-gray-700"
              >
                <XCircle className="w-6 h-6" />
              </button>
            </div>
          </div>

          {/* Content */}
          <div className="p-6 space-y-6">
            {/* Specialty Focus & Conditions Managed */}
            {(selectedProvider.specialtyFocus || selectedProvider.conditionsManaged) && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {selectedProvider.specialtyFocus && (
                  <div>
                    <h3 className="font-medium text-gray-900 mb-3">Areas of Focus</h3>
                    <div className="flex flex-wrap gap-2">
                      {selectedProvider.specialtyFocus.map((focus, index) => (
                        <span key={index} className="inline-flex items-center px-3 py-1 bg-blue-100 text-blue-700 text-sm rounded-full">
                          {focus}
                        </span>
                      ))}
                    </div>
                  </div>
                )}

                {selectedProvider.conditionsManaged && (
                  <div>
                    <h3 className="font-medium text-gray-900 mb-3">Conditions Managed</h3>
                    <div className="space-y-2">
                      {selectedProvider.conditionsManaged.map((condition, index) => (
                        <div key={index} className="flex items-center text-sm">
                          {getConditionIcon(condition)}
                          <span className="ml-2 text-gray-700">{condition}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Contact & Location */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div>
                <h3 className="font-medium text-gray-900 mb-3">Contact Information</h3>
                <div className="space-y-2">
                  <div className="flex items-center">
                    <Phone className="w-4 h-4 text-gray-400 mr-3" />
                    <span className="text-gray-700">{selectedProvider.phone}</span>
                  </div>
                  {selectedProvider.website && (
                    <div className="flex items-center">
                      <ExternalLink className="w-4 h-4 text-gray-400 mr-3" />
                      <a 
                        href={selectedProvider.website} 
                        target="_blank" 
                        rel="noopener noreferrer"
                        className="text-blue-600 hover:text-blue-800"
                      >
                        Visit Website
                      </a>
                    </div>
                  )}
                </div>
              </div>

              <div>
                <h3 className="font-medium text-gray-900 mb-3">Location</h3>
                <div className="flex items-start">
                  <MapPin className="w-4 h-4 text-gray-400 mr-3 mt-1" />
                  <div className="text-gray-700">
                    <div>{selectedProvider.address.street}</div>
                    <div>{selectedProvider.address.city}, {selectedProvider.address.state} {selectedProvider.address.zipCode}</div>
                  </div>
                </div>
              </div>
            </div>

            {/* Availability */}
            <div>
              <h3 className="font-medium text-gray-900 mb-3">Availability</h3>
              <div className="flex items-center space-x-4">
                <div className={`inline-flex items-center px-3 py-2 rounded-lg ${
                  selectedProvider.acceptingNewPatients 
                    ? 'bg-green-100 text-green-800' 
                    : 'bg-red-100 text-red-800'
                }`}>
                  {selectedProvider.acceptingNewPatients ? (
                    <CheckCircle className="w-4 h-4 mr-2" />
                  ) : (
                    <XCircle className="w-4 h-4 mr-2" />
                  )}
                  {selectedProvider.acceptingNewPatients ? 'Accepting New Patients' : 'Not Accepting New Patients'}
                </div>
                
                <div className="flex items-center text-gray-600">
                  <Calendar className="w-4 h-4 mr-2" />
                  Next available: {formatNextAppointment(selectedProvider.nextAvailableAppointment)}
                </div>
              </div>
            </div>

            {/* Insurance Coverage */}
            {insurancePlans.length > 0 && (
              <div>
                <h3 className="font-medium text-gray-900 mb-3">Your Insurance Coverage</h3>
                <div className="space-y-3">
                  {insurancePlans.map(plan => {
                    const verification = insuranceVerification.get(plan.id);
                    return (
                      <div key={plan.id} className="border border-gray-200 rounded-lg p-4">
                        <div className="flex items-center justify-between">
                          <div>
                            <h4 className="font-medium text-gray-900">{plan.planName}</h4>
                            <p className="text-sm text-gray-600">{plan.insurerName}</p>
                          </div>
                          
                          {verification ? (
                            <div className="text-right">
                              <div className={`inline-flex items-center px-2 py-1 rounded-full text-xs font-medium ${
                                verification.accepted 
                                  ? 'bg-green-100 text-green-800' 
                                  : 'bg-red-100 text-red-800'
                              }`}>
                                {verification.accepted ? 'In-Network' : 'Out-of-Network'}
                              </div>
                              {verification.accepted && verification.copay && (
                                <div className="text-sm text-gray-600 mt-1">
                                  ${verification.copay} copay
                                </div>
                              )}
                            </div>
                          ) : (
                            <div className="text-sm text-gray-500">Verifying...</div>
                          )}
                        </div>
                        
                        {verification?.notes && (
                          <p className="text-sm text-gray-600 mt-2">{verification.notes}</p>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Education & Credentials */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div>
                <h3 className="font-medium text-gray-900 mb-3">Education</h3>
                <div className="space-y-2">
                  {selectedProvider.education.map((edu, index) => (
                    <div key={index} className="flex items-start">
                      <Award className="w-4 h-4 text-gray-400 mr-3 mt-1" />
                      <div className="text-sm text-gray-700">
                        <div className="font-medium">{edu.degree}</div>
                        <div>{edu.institution} ({edu.year})</div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div>
                <h3 className="font-medium text-gray-900 mb-3">Board Certifications</h3>
                <div className="space-y-2">
                  {selectedProvider.boardCertifications.map((cert, index) => (
                    <div key={index} className="flex items-center">
                      <CheckCircle className="w-4 h-4 text-green-500 mr-3" />
                      <span className="text-sm text-gray-700">{cert}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* Hospital Affiliations */}
            {selectedProvider.hospitalAffiliations.length > 0 && (
              <div>
                <h3 className="font-medium text-gray-900 mb-3">Hospital Affiliations</h3>
                <div className="flex flex-wrap gap-2">
                  {selectedProvider.hospitalAffiliations.map((hospital, index) => (
                    <span key={index} className="inline-flex items-center px-3 py-1 bg-gray-100 text-gray-700 text-sm rounded-full">
                      <Building className="w-3 h-3 mr-2" />
                      {hospital}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {/* Languages */}
            {selectedProvider.languages.length > 1 && (
              <div>
                <h3 className="font-medium text-gray-900 mb-3">Languages</h3>
                <div className="flex flex-wrap gap-2">
                  {selectedProvider.languages.map((language, index) => (
                    <span key={index} className="inline-flex items-center px-3 py-1 bg-blue-100 text-blue-700 text-sm rounded-full">
                      <Globe className="w-3 h-3 mr-2" />
                      {language}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="p-6 border-t border-gray-200 bg-gray-50">
            <div className="flex justify-between items-center">
              <p className="text-sm text-gray-600">
                Information last updated: {new Date().toLocaleDateString()}
              </p>
              <div className="flex space-x-3">
                <button
                  onClick={() => setSelectedProvider(null)}
                  className="px-4 py-2 text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50"
                >
                  Close
                </button>
                <button className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700">
                  Schedule Appointment
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="bg-white rounded-lg shadow-lg p-6">
      <div className="flex items-center mb-6">
        <Users className="w-6 h-6 text-blue-600 mr-3" />
        <h2 className="text-xl font-semibold text-gray-900">Find Healthcare Providers</h2>
      </div>

      {/* Tab Navigation */}
      <div className="flex space-x-1 mb-6 bg-gray-100 p-1 rounded-lg">
        <button
          onClick={() => setActiveTab('smart-recommendations')}
          className={`flex-1 py-2 px-4 text-sm font-medium rounded-md transition-colors ${
            activeTab === 'smart-recommendations'
              ? 'bg-white text-blue-700 shadow-sm'
              : 'text-gray-600 hover:text-gray-900'
          }`}
        >
          Smart Recommendations
        </button>
        <button
          onClick={() => setActiveTab('search')}
          className={`flex-1 py-2 px-4 text-sm font-medium rounded-md transition-colors ${
            activeTab === 'search'
              ? 'bg-white text-blue-700 shadow-sm'
              : 'text-gray-600 hover:text-gray-900'
          }`}
        >
          Search Providers
        </button>
      </div>

      {activeTab === 'smart-recommendations' && (
        <div className="space-y-6">
          {/* Detected Conditions Summary */}
          {smartRecommendations.detectedConditions.length > 0 && (
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
              <h3 className="font-medium text-blue-900 mb-3">
                Detected Health Conditions Based on Your Biomarkers
              </h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {smartRecommendations.detectedConditions.map((condition, index) => (
                  <div key={index} className="flex items-center justify-between p-3 bg-white rounded border border-blue-200">
                    <div className="flex items-center">
                      {getConditionIcon(condition.condition.name)}
                      <span className="ml-2 text-sm font-medium text-gray-900">{condition.condition.name}</span>
                    </div>
                    <div className="text-right">
                      <div className={`text-xs px-2 py-1 rounded ${
                        condition.severity === 'severe' ? 'bg-red-100 text-red-800' :
                        condition.severity === 'moderate' ? 'bg-yellow-100 text-yellow-800' :
                        'bg-green-100 text-green-800'
                      }`}>
                        {condition.severity}
                      </div>
                      <div className="text-xs text-gray-500 mt-1">
                        {Math.round(condition.confidence * 100)}% confidence
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Urgent Referrals */}
          {smartRecommendations.urgentReferrals.length > 0 && (
            <div>
              <div className="flex items-center mb-4">
                <AlertCircle className="w-5 h-5 text-red-600 mr-2" />
                <h3 className="text-lg font-medium text-red-900">Urgent Referrals</h3>
                <span className="ml-2 px-2 py-1 bg-red-100 text-red-800 text-xs rounded-full">
                  {smartRecommendations.urgentReferrals.length}
                </span>
              </div>
              <div className="space-y-4">
                {smartRecommendations.urgentReferrals.map((rec, index) => (
                  <div key={index} className="border border-red-200 rounded-lg p-4 bg-red-50">
                    <h4 className="font-medium text-red-900">{rec.specialty} Specialist</h4>
                    <p className="text-sm text-red-700 mt-1">{rec.reason}</p>
                    {rec.relatedConditions && rec.relatedConditions.length > 0 && (
                      <div className="mt-2">
                        <p className="text-xs text-red-600 mb-1">Related conditions:</p>
                        <div className="flex flex-wrap gap-1">
                          {rec.relatedConditions.map((condition, cIndex) => (
                            <span key={cIndex} className="inline-flex items-center px-2 py-0.5 bg-red-200 text-red-800 text-xs rounded">
                              {getConditionIcon(condition)}
                              <span className="ml-1">{condition}</span>
                            </span>
                          ))}
                        </div>
                      </div>
                    )}
                    <div className="flex items-center justify-between mt-3">
                      <span className="text-sm text-red-600">Timeframe: {rec.timeframe}</span>
                      <button
                        onClick={() => {
                          setSearchCriteria(prev => ({ 
                            ...prev, 
                            specialty: rec.specialty,
                            conditionsManaged: rec.relatedConditions,
                            urgency: rec.urgency
                          }));
                          setActiveTab('search');
                          handleSearch();
                        }}
                        className="px-3 py-1 bg-red-600 text-white text-sm rounded hover:bg-red-700"
                      >
                        Find Providers
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Routine Referrals */}
          {smartRecommendations.routineReferrals.length > 0 && (
            <div>
              <div className="flex items-center mb-4">
                <Clock className="w-5 h-5 text-yellow-600 mr-2" />
                <h3 className="text-lg font-medium text-yellow-900">Routine Care</h3>
                <span className="ml-2 px-2 py-1 bg-yellow-100 text-yellow-800 text-xs rounded-full">
                  {smartRecommendations.routineReferrals.length}
                </span>
              </div>
              <div className="space-y-4">
                {smartRecommendations.routineReferrals.map((rec, index) => (
                  <div key={index} className="border border-yellow-200 rounded-lg p-4 bg-yellow-50">
                    <h4 className="font-medium text-yellow-900">{rec.specialty} Specialist</h4>
                    <p className="text-sm text-yellow-700 mt-1">{rec.reason}</p>
                    {rec.relatedConditions && rec.relatedConditions.length > 0 && (
                      <div className="mt-2">
                        <p className="text-xs text-yellow-600 mb-1">Related conditions:</p>
                        <div className="flex flex-wrap gap-1">
                          {rec.relatedConditions.map((condition, cIndex) => (
                            <span key={cIndex} className="inline-flex items-center px-2 py-0.5 bg-yellow-200 text-yellow-800 text-xs rounded">
                              {getConditionIcon(condition)}
                              <span className="ml-1">{condition}</span>
                            </span>
                          ))}
                        </div>
                      </div>
                    )}
                    <div className="flex items-center justify-between mt-3">
                      <span className="text-sm text-yellow-600">Timeframe: {rec.timeframe}</span>
                      <button
                        onClick={() => {
                          setSearchCriteria(prev => ({ 
                            ...prev, 
                            specialty: rec.specialty,
                            conditionsManaged: rec.relatedConditions,
                            urgency: rec.urgency
                          }));
                          setActiveTab('search');
                          handleSearch();
                        }}
                        className="px-3 py-1 bg-yellow-600 text-white text-sm rounded hover:bg-yellow-700"
                      >
                        Find Providers
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Preventive Referrals */}
          {smartRecommendations.preventiveReferrals.length > 0 && (
            <div>
              <div className="flex items-center mb-4">
                <Shield className="w-5 h-5 text-green-600 mr-2" />
                <h3 className="text-lg font-medium text-green-900">Preventive Care</h3>
                <span className="ml-2 px-2 py-1 bg-green-100 text-green-800 text-xs rounded-full">
                  {smartRecommendations.preventiveReferrals.length}
                </span>
              </div>
              <div className="space-y-4">
                {smartRecommendations.preventiveReferrals.map((rec, index) => (
                  <div key={index} className="border border-green-200 rounded-lg p-4 bg-green-50">
                    <h4 className="font-medium text-green-900">{rec.specialty} Specialist</h4>
                    <p className="text-sm text-green-700 mt-1">{rec.reason}</p>
                    {rec.relatedConditions && rec.relatedConditions.length > 0 && (
                      <div className="mt-2">
                        <p className="text-xs text-green-600 mb-1">Related conditions:</p>
                        <div className="flex flex-wrap gap-1">
                          {rec.relatedConditions.map((condition, cIndex) => (
                            <span key={cIndex} className="inline-flex items-center px-2 py-0.5 bg-green-200 text-green-800 text-xs rounded">
                              {getConditionIcon(condition)}
                              <span className="ml-1">{condition}</span>
                            </span>
                          ))}
                        </div>
                      </div>
                    )}
                    <div className="flex items-center justify-between mt-3">
                      <span className="text-sm text-green-600">Timeframe: {rec.timeframe}</span>
                      <button
                        onClick={() => {
                          setSearchCriteria(prev => ({ 
                            ...prev, 
                            specialty: rec.specialty,
                            conditionsManaged: rec.relatedConditions,
                            urgency: rec.urgency
                          }));
                          setActiveTab('search');
                          handleSearch();
                        }}
                        className="px-3 py-1 bg-green-600 text-white text-sm rounded hover:bg-green-700"
                      >
                        Find Providers
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* No recommendations message */}
          {smartRecommendations.urgentReferrals.length === 0 && 
           smartRecommendations.routineReferrals.length === 0 && 
           smartRecommendations.preventiveReferrals.length === 0 && (
            <div className="text-center py-8 text-gray-500">
              <Users className="w-12 h-12 mx-auto mb-4 text-gray-300" />
              <p>No specific provider recommendations based on your current biomarkers.</p>
              <p className="text-sm mt-2">Use the search tab to find providers by specialty.</p>
            </div>
          )}
        </div>
      )}

      {activeTab === 'search' && (
        <div className="space-y-6">
          {/* Search Form */}
          <div className="bg-gray-50 rounded-lg p-4">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Specialty
                </label>
                <select
                  value={searchCriteria.specialty}
                  onChange={(e) => setSearchCriteria(prev => ({ ...prev, specialty: e.target.value }))}
                  className="w-full border border-gray-300 rounded-md shadow-sm p-2"
                >
                  <option value="">Select specialty</option>
                  {SPECIALTY_OPTIONS.map(specialty => (
                    <option key={specialty} value={specialty}>{specialty}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Search Radius
                </label>
                <select
                  value={searchCriteria.location.radius}
                  onChange={(e) => setSearchCriteria(prev => ({ 
                    ...prev, 
                    location: { ...prev.location, radius: parseInt(e.target.value) }
                  }))}
                  className="w-full border border-gray-300 rounded-md shadow-sm p-2"
                >
                  <option value={10}>10 miles</option>
                  <option value={25}>25 miles</option>
                  <option value={50}>50 miles</option>
                  <option value={100}>100 miles</option>
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Minimum Rating
                </label>
                <select
                  value={searchCriteria.minRating}
                  onChange={(e) => setSearchCriteria(prev => ({ ...prev, minRating: parseFloat(e.target.value) }))}
                  className="w-full border border-gray-300 rounded-md shadow-sm p-2"
                >
                  <option value={0}>Any rating</option>
                  <option value={3.0}>3.0+ stars</option>
                  <option value={4.0}>4.0+ stars</option>
                  <option value={4.5}>4.5+ stars</option>
                </select>
              </div>
            </div>

            <div className="flex items-center mt-4 space-x-4">
              <label className="flex items-center">
                <input
                  type="checkbox"
                  checked={searchCriteria.acceptingNewPatients}
                  onChange={(e) => setSearchCriteria(prev => ({ ...prev, acceptingNewPatients: e.target.checked }))}
                  className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                />
                <span className="ml-2 text-sm text-gray-700">Accepting new patients only</span>
              </label>

              <button
                onClick={handleSearch}
                disabled={!searchCriteria.specialty || isSearching}
                className="flex items-center px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isSearching ? (
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                ) : (
                  <Search className="w-4 h-4 mr-2" />
                )}
                Search
              </button>
            </div>
          </div>

          {/* Search Results */}
          {searchResults && (
            <div>
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-medium text-gray-900">
                  Search Results ({searchResults.totalCount})
                </h3>
                {userLocation && (
                  <div className="flex items-center text-sm text-gray-600">
                    <Navigation className="w-4 h-4 mr-1" />
                    Searching near your location
                  </div>
                )}
              </div>

              {searchResults.suggestions.length > 0 && (
                <div className="mb-4 p-4 bg-yellow-50 border border-yellow-200 rounded-lg">
                  <h4 className="font-medium text-yellow-800 mb-2">Suggestions</h4>
                  <ul className="space-y-1">
                    {searchResults.suggestions.map((suggestion, index) => (
                      <li key={index} className="text-sm text-yellow-700">
                        <strong>{suggestion.message}:</strong> {suggestion.action}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              <div className="space-y-4">
                {searchResults.providers.map(provider => renderProviderCard(provider))}
              </div>

              {searchResults.providers.length === 0 && (
                <div className="text-center py-8 text-gray-500">
                  <Users className="w-12 h-12 mx-auto mb-4 text-gray-300" />
                  <p>No providers found matching your criteria.</p>
                  <p className="text-sm mt-2">Try expanding your search radius or adjusting your filters.</p>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Provider Details Modal */}
      {renderProviderDetails()}
    </div>
  );
}