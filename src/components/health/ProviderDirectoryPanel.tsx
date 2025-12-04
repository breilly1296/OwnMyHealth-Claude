import React, { useState, useEffect } from 'react';
import {
  MapPin,
  Phone,
  Star,
  Clock,
  Users,
  Shield,
  Search,
  Calendar,
  CheckCircle,
  X,
  AlertCircle,
  ExternalLink,
  Building,
  Globe,
  Loader2,
  ChevronRight,
  Stethoscope
} from 'lucide-react';
import { providerLogger } from '../../utils/logger';
import type {
  HealthcareProvider,
  ProviderSearchCriteria,
  ProviderSearchResult,
  InsurancePlan,
  HealthNeedsAnalysis,
  ProviderRecommendation,
  Biomarker
} from '../../types';
import {
  searchProviders,
  checkInsuranceAcceptance,
  getCurrentLocation,
  generateProviderRecommendationsFromBiomarkers
} from '../../utils/health/providerDirectory';

interface ProviderDirectoryPanelProps {
  healthNeeds: HealthNeedsAnalysis;
  insurancePlans: InsurancePlan[];
  biomarkers?: Biomarker[];
}

interface InsuranceVerificationResult {
  accepted: boolean;
  copay?: number;
  notes?: string;
}

const SPECIALTY_OPTIONS = [
  'Endocrinology', 'Reproductive Endocrinology', 'Cardiology', 'Rheumatology',
  'Nephrology', 'Hematology', 'Hepatology', 'Gynecology', 'Internal Medicine',
  'Family Medicine', 'Dermatology', 'Orthopedics', 'Neurology', 'Psychiatry'
];

export default function ProviderDirectoryPanel({ insurancePlans, biomarkers = [] }: ProviderDirectoryPanelProps) {
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
  const [searchError, setSearchError] = useState<string | null>(null);
  const [insuranceVerification, setInsuranceVerification] = useState<Map<string, InsuranceVerificationResult>>(new Map());
  const [activeTab, setActiveTab] = useState<'recommendations' | 'search'>('recommendations');
  const [locationError, setLocationError] = useState<string | null>(null);
  const [insuranceVerificationError, setInsuranceVerificationError] = useState<string | null>(null);

  useEffect(() => {
    getCurrentLocation()
      .then(location => {
        if (location) {
          setUserLocation(location);
          setSearchCriteria(prev => ({ ...prev, location: { ...location, radius: 25 } }));
          setLocationError(null);
        }
      })
      .catch((error) => {
        // Handle geolocation permission denied or other errors
        const errorMessage = error instanceof GeolocationPositionError
          ? error.code === 1
            ? 'Location access denied. Using default location.'
            : error.code === 2
              ? 'Location unavailable. Using default location.'
              : 'Location request timed out. Using default location.'
          : 'Could not get your location. Using default location.';
        setLocationError(errorMessage);
        providerLogger.warn('Geolocation error', { errorMessage });
      });
  }, []);

  const handleSearch = async () => {
    if (!searchCriteria.specialty) return;
    setIsSearching(true);
    setSearchError(null);
    try {
      const results = await searchProviders(searchCriteria);
      setSearchResults(results);
    } catch {
      setSearchError('Failed to search for providers. Please try again.');
    } finally {
      setIsSearching(false);
    }
  };

  const handleProviderSelect = async (provider: HealthcareProvider) => {
    setSelectedProvider(provider);
    setInsuranceVerificationError(null);
    const verifications = new Map();
    let failedVerifications = 0;

    for (const plan of insurancePlans) {
      try {
        const verification = await checkInsuranceAcceptance(provider.id, plan.insurerName);
        verifications.set(plan.id, verification);
      } catch (error) {
        // Track failed verifications instead of silently swallowing
        failedVerifications++;
        providerLogger.warn('Insurance verification failed', { insurer: plan.insurerName, error: error instanceof Error ? error.message : 'Unknown error' });
      }
    }

    setInsuranceVerification(verifications);

    // Show user-friendly message if some verifications failed
    if (failedVerifications > 0 && failedVerifications < insurancePlans.length) {
      setInsuranceVerificationError(`Could not verify ${failedVerifications} insurance plan(s). Contact provider for details.`);
    } else if (failedVerifications === insurancePlans.length && insurancePlans.length > 0) {
      setInsuranceVerificationError('Insurance verification unavailable. Please contact the provider directly.');
    }
  };

  const smartRecommendations = biomarkers.length > 0
    ? generateProviderRecommendationsFromBiomarkers(
        biomarkers,
        userLocation || { lat: 37.7749, lng: -122.4194 },
        insurancePlans
      )
    : { urgentReferrals: [], routineReferrals: [], preventiveReferrals: [], detectedConditions: [] };

  const formatDistance = (distance?: number) => {
    if (!distance) return '';
    return distance < 1 ? `${(distance * 5280).toFixed(0)} ft` : `${distance.toFixed(1)} mi`;
  };

  const formatNextAppointment = (date?: string) => {
    if (!date) return 'Call for availability';
    const appointmentDate = new Date(date);
    const today = new Date();
    const diffDays = Math.ceil((appointmentDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
    if (diffDays <= 7) return `${diffDays} days`;
    if (diffDays <= 30) return `${Math.ceil(diffDays / 7)} weeks`;
    return `${Math.ceil(diffDays / 30)} months`;
  };

  const getUrgencyStyle = (urgency: string) => {
    switch (urgency) {
      case 'urgent': return { bg: 'bg-red-500', light: 'bg-red-50', text: 'text-red-700', border: 'border-red-200' };
      case 'routine': return { bg: 'bg-amber-500', light: 'bg-amber-50', text: 'text-amber-700', border: 'border-amber-200' };
      default: return { bg: 'bg-wellness-500', light: 'bg-wellness-50', text: 'text-wellness-700', border: 'border-wellness-200' };
    }
  };

  const totalRecommendations = smartRecommendations.urgentReferrals.length +
    smartRecommendations.routineReferrals.length +
    smartRecommendations.preventiveReferrals.length;

  const tabs = [
    { id: 'recommendations' as const, label: 'Recommendations' },
    { id: 'search' as const, label: 'Search' },
  ];

  // Provider Card Component
  const ProviderCard = ({ provider, recommendation }: { provider: HealthcareProvider; recommendation?: ProviderRecommendation }) => (
    <div
      className="bg-white rounded-2xl border border-slate-200/60 p-5 hover:shadow-sm transition-all cursor-pointer"
      onClick={() => handleProviderSelect(provider)}
    >
      <div className="flex items-start gap-4">
        {provider.profileImage ? (
          <img src={provider.profileImage} alt={provider.name} className="w-14 h-14 rounded-xl object-cover" />
        ) : (
          <div className="w-14 h-14 rounded-xl bg-slate-100 flex items-center justify-center">
            <Stethoscope className="w-6 h-6 text-slate-400" />
          </div>
        )}

        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h3 className="font-semibold text-slate-900">{provider.name}</h3>
              <p className="text-sm text-slate-500">{provider.specialty}</p>
            </div>
            <span className={`flex-shrink-0 text-xs font-medium px-2.5 py-1 rounded-full ${
              provider.acceptingNewPatients
                ? 'bg-wellness-50 text-wellness-700'
                : 'bg-slate-100 text-slate-600'
            }`}>
              {provider.acceptingNewPatients ? 'Accepting' : 'Waitlist'}
            </span>
          </div>

          <div className="flex items-center gap-4 mt-3 text-sm text-slate-600">
            <div className="flex items-center gap-1">
              <Star className="w-4 h-4 text-amber-400 fill-amber-400" />
              <span>{provider.rating}</span>
              <span className="text-slate-400">({provider.reviewCount})</span>
            </div>
            {provider.distance && (
              <div className="flex items-center gap-1">
                <MapPin className="w-4 h-4 text-slate-400" />
                <span>{formatDistance(provider.distance)}</span>
              </div>
            )}
            <div className="flex items-center gap-1">
              <Clock className="w-4 h-4 text-slate-400" />
              <span>{formatNextAppointment(provider.nextAvailableAppointment)}</span>
            </div>
          </div>

          {recommendation && (
            <div className="mt-3 p-3 bg-blue-50 rounded-xl">
              <p className="text-sm text-blue-800">{recommendation.reason}</p>
              <div className="flex items-center justify-between mt-2 text-xs">
                <span className="text-blue-600">${recommendation.expectedCosts.consultation} consultation</span>
                <span className="text-blue-600">{recommendation.timeframe}</span>
              </div>
            </div>
          )}

          {provider.insuranceAccepted.length > 0 && (
            <div className="flex items-center gap-2 mt-3">
              <Shield className="w-4 h-4 text-slate-400" />
              <div className="flex gap-1.5">
                {provider.insuranceAccepted.slice(0, 2).map((ins, i) => (
                  <span key={i} className="text-xs px-2 py-0.5 bg-slate-100 text-slate-600 rounded">
                    {ins}
                  </span>
                ))}
                {provider.insuranceAccepted.length > 2 && (
                  <span className="text-xs text-slate-400">+{provider.insuranceAccepted.length - 2}</span>
                )}
              </div>
            </div>
          )}
        </div>

        <ChevronRight className="w-5 h-5 text-slate-300 flex-shrink-0" />
      </div>
    </div>
  );

  // Referral Card Component
  const ReferralCard = ({ rec, urgency }: { rec: ProviderRecommendation; urgency: string }) => {
    const style = getUrgencyStyle(urgency);
    return (
      <div className={`rounded-xl border ${style.border} ${style.light} p-4`}>
        <div className="flex items-start justify-between gap-4">
          <div className="flex-1">
            <div className="flex items-center gap-2 mb-1">
              <div className={`w-2 h-2 rounded-full ${style.bg}`} />
              <h4 className="font-medium text-slate-900">{rec.specialty}</h4>
            </div>
            <p className="text-sm text-slate-600">{rec.reason}</p>
            {rec.relatedConditions && rec.relatedConditions.length > 0 && (
              <div className="flex flex-wrap gap-1.5 mt-2">
                {rec.relatedConditions.map((condition, i) => (
                  <span key={i} className="text-xs px-2 py-0.5 bg-white/60 rounded text-slate-600">
                    {condition}
                  </span>
                ))}
              </div>
            )}
          </div>
          <button
            onClick={() => {
              setSearchCriteria(prev => ({ ...prev, specialty: rec.specialty }));
              setActiveTab('search');
              handleSearch();
            }}
            className={`flex-shrink-0 text-xs font-medium px-3 py-1.5 rounded-lg ${style.bg} text-white hover:opacity-90 transition-opacity`}
          >
            Find
          </button>
        </div>
        <div className="mt-3 pt-3 border-t border-slate-200/60 flex items-center justify-between text-xs text-slate-500">
          <span>Timeframe: {rec.timeframe}</span>
          <span>Est. ${rec.expectedCosts.consultation}</span>
        </div>
      </div>
    );
  };

  return (
    <div className="animate-fade-in max-w-6xl mx-auto">
      {/* Location Error Banner */}
      {locationError && (
        <div className="mb-4 bg-amber-50 border border-amber-200 rounded-xl p-4 flex items-center gap-3">
          <MapPin className="w-5 h-5 text-amber-600 flex-shrink-0" />
          <p className="text-amber-800 text-sm">{locationError}</p>
          <button
            onClick={() => setLocationError(null)}
            className="ml-auto text-amber-600 hover:text-amber-800"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Header */}
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-slate-900">Find Providers</h1>
        <p className="text-slate-500 mt-1">Discover specialists matched to your health needs</p>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-12 gap-4 mb-8">
        <div className="col-span-12 md:col-span-6 bg-white rounded-2xl border border-slate-200/60 p-6">
          <div className="flex items-center gap-5">
            <div className="w-14 h-14 rounded-2xl bg-blue-100 flex items-center justify-center">
              <Users className="w-7 h-7 text-blue-600" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-slate-900">
                {totalRecommendations > 0 ? `${totalRecommendations} Specialist Recommendations` : 'Find a Specialist'}
              </h2>
              <p className="text-sm text-slate-500 mt-0.5">
                {totalRecommendations > 0 ? 'Based on your biomarker analysis' : 'Search by specialty or location'}
              </p>
            </div>
          </div>
        </div>

        <div className="col-span-4 md:col-span-2 bg-red-500 rounded-2xl p-5">
          <span className="text-xs font-medium text-red-100 uppercase tracking-wide">Urgent</span>
          <p className="text-3xl font-bold text-white mt-2">{smartRecommendations.urgentReferrals.length}</p>
        </div>

        <div className="col-span-4 md:col-span-2 bg-amber-500 rounded-2xl p-5">
          <span className="text-xs font-medium text-amber-100 uppercase tracking-wide">Routine</span>
          <p className="text-3xl font-bold text-white mt-2">{smartRecommendations.routineReferrals.length}</p>
        </div>

        <div className="col-span-4 md:col-span-2 bg-wellness-500 rounded-2xl p-5">
          <span className="text-xs font-medium text-wellness-100 uppercase tracking-wide">Preventive</span>
          <p className="text-3xl font-bold text-white mt-2">{smartRecommendations.preventiveReferrals.length}</p>
        </div>
      </div>

      {/* Tab Navigation */}
      <div className="bg-slate-100 rounded-xl p-1 inline-flex mb-6">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`px-5 py-2 text-sm font-medium rounded-lg transition-all ${
              activeTab === tab.id
                ? 'bg-white text-slate-900 shadow-sm'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab Content */}
      <div className="min-h-[400px]">
        {/* Recommendations Tab */}
        {activeTab === 'recommendations' && (
          <div className="space-y-8">
            {/* Urgent */}
            {smartRecommendations.urgentReferrals.length > 0 && (
              <div>
                <div className="flex items-center gap-2 mb-4">
                  <AlertCircle className="w-5 h-5 text-red-500" />
                  <h2 className="font-semibold text-slate-900">Urgent Referrals</h2>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {smartRecommendations.urgentReferrals.map((rec, i) => (
                    <ReferralCard key={i} rec={rec} urgency="urgent" />
                  ))}
                </div>
              </div>
            )}

            {/* Routine */}
            {smartRecommendations.routineReferrals.length > 0 && (
              <div>
                <div className="flex items-center gap-2 mb-4">
                  <Clock className="w-5 h-5 text-amber-500" />
                  <h2 className="font-semibold text-slate-900">Routine Care</h2>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {smartRecommendations.routineReferrals.map((rec, i) => (
                    <ReferralCard key={i} rec={rec} urgency="routine" />
                  ))}
                </div>
              </div>
            )}

            {/* Preventive */}
            {smartRecommendations.preventiveReferrals.length > 0 && (
              <div>
                <div className="flex items-center gap-2 mb-4">
                  <Shield className="w-5 h-5 text-wellness-500" />
                  <h2 className="font-semibold text-slate-900">Preventive Care</h2>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {smartRecommendations.preventiveReferrals.map((rec, i) => (
                    <ReferralCard key={i} rec={rec} urgency="preventive" />
                  ))}
                </div>
              </div>
            )}

            {/* Empty State */}
            {totalRecommendations === 0 && (
              <div className="bg-slate-50 rounded-2xl p-12 text-center">
                <div className="w-16 h-16 bg-slate-100 rounded-2xl flex items-center justify-center mx-auto mb-4">
                  <Users className="w-8 h-8 text-slate-400" />
                </div>
                <h3 className="text-lg font-semibold text-slate-900 mb-2">No recommendations yet</h3>
                <p className="text-slate-500 text-sm max-w-md mx-auto mb-6">
                  Add biomarkers to get personalized specialist recommendations, or use the search tab to find providers.
                </p>
                <button
                  onClick={() => setActiveTab('search')}
                  className="px-5 py-2.5 bg-slate-900 text-white text-sm font-medium rounded-xl hover:bg-slate-800 transition-colors"
                >
                  Search Providers
                </button>
              </div>
            )}
          </div>
        )}

        {/* Search Tab */}
        {activeTab === 'search' && (
          <div className="space-y-6">
            {/* Search Form */}
            <div className="bg-white rounded-2xl border border-slate-200/60 p-6">
              <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                <div className="md:col-span-2">
                  <label className="block text-sm font-medium text-slate-700 mb-2">Specialty</label>
                  <select
                    value={searchCriteria.specialty}
                    onChange={(e) => setSearchCriteria(prev => ({ ...prev, specialty: e.target.value }))}
                    className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-300"
                  >
                    <option value="">Select specialty</option>
                    {SPECIALTY_OPTIONS.map(s => <option key={s} value={s}>{s}</option>)}
                  </select>
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-2">Distance</label>
                  <select
                    value={searchCriteria.location.radius}
                    onChange={(e) => setSearchCriteria(prev => ({
                      ...prev,
                      location: { ...prev.location, radius: parseInt(e.target.value) }
                    }))}
                    className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-300"
                  >
                    <option value={10}>10 miles</option>
                    <option value={25}>25 miles</option>
                    <option value={50}>50 miles</option>
                  </select>
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-2">Min Rating</label>
                  <select
                    value={searchCriteria.minRating}
                    onChange={(e) => setSearchCriteria(prev => ({ ...prev, minRating: parseFloat(e.target.value) }))}
                    className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-300"
                  >
                    <option value={0}>Any</option>
                    <option value={4.0}>4.0+</option>
                    <option value={4.5}>4.5+</option>
                  </select>
                </div>
              </div>

              <div className="flex items-center justify-between mt-5 pt-5 border-t border-slate-100">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={searchCriteria.acceptingNewPatients}
                    onChange={(e) => setSearchCriteria(prev => ({ ...prev, acceptingNewPatients: e.target.checked }))}
                    className="w-4 h-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                  />
                  <span className="text-sm text-slate-700">Accepting new patients only</span>
                </label>

                <button
                  onClick={handleSearch}
                  disabled={!searchCriteria.specialty || isSearching}
                  className="flex items-center gap-2 px-5 py-2.5 bg-slate-900 text-white text-sm font-medium rounded-xl hover:bg-slate-800 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  {isSearching ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <Search className="w-4 h-4" />
                  )}
                  Search
                </button>
              </div>
            </div>

            {/* Search Error */}
            {searchError && (
              <div className="bg-red-50 rounded-xl p-4 mb-4 flex items-center gap-3">
                <AlertCircle className="w-5 h-5 text-red-600 flex-shrink-0" />
                <p className="text-red-800 text-sm">{searchError}</p>
                <button
                  onClick={() => setSearchError(null)}
                  className="ml-auto text-red-600 hover:text-red-800"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            )}

            {/* Results */}
            {searchResults && (
              <div>
                <div className="flex items-center justify-between mb-4">
                  <h3 className="font-semibold text-slate-900">
                    {searchResults.totalCount} providers found
                  </h3>
                  {userLocation && (
                    <span className="text-sm text-slate-500 flex items-center gap-1">
                      <MapPin className="w-4 h-4" />
                      Near your location
                    </span>
                  )}
                </div>

                <div className="space-y-4">
                  {searchResults.providers.map(provider => (
                    <ProviderCard key={provider.id} provider={provider} />
                  ))}
                </div>

                {searchResults.providers.length === 0 && (
                  <div className="bg-slate-50 rounded-2xl p-12 text-center">
                    <Users className="w-12 h-12 text-slate-300 mx-auto mb-4" />
                    <p className="text-slate-600 font-medium">No providers found</p>
                    <p className="text-sm text-slate-400 mt-1">Try expanding your search radius</p>
                  </div>
                )}
              </div>
            )}

            {!searchResults && (
              <div className="bg-slate-50 rounded-2xl p-12 text-center">
                <Search className="w-12 h-12 text-slate-300 mx-auto mb-4" />
                <p className="text-slate-600 font-medium">Search for providers</p>
                <p className="text-sm text-slate-400 mt-1">Select a specialty to get started</p>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Provider Details Modal */}
      {selectedProvider && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl w-full max-w-3xl max-h-[90vh] overflow-hidden shadow-2xl animate-fade-in">
            {/* Modal Header */}
            <div className="px-6 py-5 border-b border-slate-100 flex items-start justify-between">
              <div className="flex items-center gap-4">
                {selectedProvider.profileImage ? (
                  <img src={selectedProvider.profileImage} alt={selectedProvider.name} className="w-16 h-16 rounded-xl object-cover" />
                ) : (
                  <div className="w-16 h-16 rounded-xl bg-slate-100 flex items-center justify-center">
                    <Stethoscope className="w-7 h-7 text-slate-400" />
                  </div>
                )}
                <div>
                  <h2 className="text-xl font-bold text-slate-900">{selectedProvider.name}</h2>
                  <p className="text-slate-500">{selectedProvider.specialty}</p>
                  <div className="flex items-center gap-3 mt-1">
                    <div className="flex items-center gap-1 text-sm">
                      <Star className="w-4 h-4 text-amber-400 fill-amber-400" />
                      <span className="text-slate-700">{selectedProvider.rating}</span>
                      <span className="text-slate-400">({selectedProvider.reviewCount})</span>
                    </div>
                    <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${
                      selectedProvider.acceptingNewPatients
                        ? 'bg-wellness-50 text-wellness-700'
                        : 'bg-slate-100 text-slate-600'
                    }`}>
                      {selectedProvider.acceptingNewPatients ? 'Accepting' : 'Waitlist'}
                    </span>
                  </div>
                </div>
              </div>
              <button onClick={() => setSelectedProvider(null)} className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-xl">
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Modal Content */}
            <div className="p-6 overflow-y-auto max-h-[60vh] space-y-6">
              {/* Contact & Location */}
              <div className="grid grid-cols-2 gap-6">
                <div>
                  <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">Contact</h3>
                  <div className="space-y-2">
                    <div className="flex items-center gap-3 text-sm">
                      <Phone className="w-4 h-4 text-slate-400" />
                      <span className="text-slate-700">{selectedProvider.phone}</span>
                    </div>
                    {selectedProvider.website && (
                      <div className="flex items-center gap-3 text-sm">
                        <ExternalLink className="w-4 h-4 text-slate-400" />
                        <a href={selectedProvider.website} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline">
                          Website
                        </a>
                      </div>
                    )}
                  </div>
                </div>
                <div>
                  <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">Location</h3>
                  <div className="flex items-start gap-3 text-sm">
                    <MapPin className="w-4 h-4 text-slate-400 mt-0.5" />
                    <div className="text-slate-700">
                      <div>{selectedProvider.address.street}</div>
                      <div>{selectedProvider.address.city}, {selectedProvider.address.state} {selectedProvider.address.zipCode}</div>
                    </div>
                  </div>
                </div>
              </div>

              {/* Availability */}
              <div>
                <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">Availability</h3>
                <div className="flex items-center gap-3 text-sm">
                  <Calendar className="w-4 h-4 text-slate-400" />
                  <span className="text-slate-700">Next available: {formatNextAppointment(selectedProvider.nextAvailableAppointment)}</span>
                </div>
              </div>

              {/* Insurance */}
              {insurancePlans.length > 0 && (
                <div>
                  <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">Your Insurance</h3>
                  <div className="space-y-2">
                    {insurancePlans.map(plan => {
                      const verification = insuranceVerification.get(plan.id);
                      return (
                        <div key={plan.id} className="flex items-center justify-between p-3 bg-slate-50 rounded-xl">
                          <div>
                            <p className="font-medium text-slate-900 text-sm">{plan.planName}</p>
                            <p className="text-xs text-slate-500">{plan.insurerName}</p>
                          </div>
                          {verification ? (
                            <span className={`text-xs font-medium px-2.5 py-1 rounded-full ${
                              verification.accepted ? 'bg-wellness-50 text-wellness-700' : 'bg-red-50 text-red-700'
                            }`}>
                              {verification.accepted ? 'In-Network' : 'Out-of-Network'}
                            </span>
                          ) : (
                            <span className="text-xs text-slate-400">Verifying...</span>
                          )}
                        </div>
                      );
                    })}
                  </div>
                  {/* Insurance Verification Error */}
                  {insuranceVerificationError && (
                    <div className="mt-3 p-3 bg-amber-50 border border-amber-200 rounded-xl flex items-center gap-2">
                      <AlertCircle className="w-4 h-4 text-amber-600 flex-shrink-0" />
                      <p className="text-xs text-amber-800">{insuranceVerificationError}</p>
                    </div>
                  )}
                </div>
              )}

              {/* Credentials */}
              <div className="grid grid-cols-2 gap-6">
                <div>
                  <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">Education</h3>
                  <div className="space-y-2">
                    {selectedProvider.education.map((edu, i) => (
                      <div key={i} className="text-sm">
                        <p className="font-medium text-slate-900">{edu.degree}</p>
                        <p className="text-slate-500">{edu.institution}, {edu.year}</p>
                      </div>
                    ))}
                  </div>
                </div>
                <div>
                  <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">Certifications</h3>
                  <div className="space-y-2">
                    {selectedProvider.boardCertifications.map((cert, i) => (
                      <div key={i} className="flex items-center gap-2 text-sm">
                        <CheckCircle className="w-4 h-4 text-wellness-500" />
                        <span className="text-slate-700">{cert}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              {/* Hospital Affiliations */}
              {selectedProvider.hospitalAffiliations.length > 0 && (
                <div>
                  <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">Hospital Affiliations</h3>
                  <div className="flex flex-wrap gap-2">
                    {selectedProvider.hospitalAffiliations.map((h, i) => (
                      <span key={i} className="flex items-center gap-1.5 text-xs px-3 py-1.5 bg-slate-100 text-slate-700 rounded-lg">
                        <Building className="w-3.5 h-3.5" />
                        {h}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {/* Languages */}
              {selectedProvider.languages.length > 1 && (
                <div>
                  <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">Languages</h3>
                  <div className="flex flex-wrap gap-2">
                    {selectedProvider.languages.map((lang, i) => (
                      <span key={i} className="flex items-center gap-1.5 text-xs px-3 py-1.5 bg-blue-50 text-blue-700 rounded-lg">
                        <Globe className="w-3.5 h-3.5" />
                        {lang}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* Modal Footer */}
            <div className="px-6 py-4 border-t border-slate-100 bg-slate-50 flex items-center justify-between">
              <p className="text-xs text-slate-400">Information may not be up to date</p>
              <div className="flex gap-3">
                <button onClick={() => setSelectedProvider(null)} className="px-4 py-2 text-sm font-medium text-slate-700 bg-white border border-slate-200 rounded-xl hover:bg-slate-50">
                  Close
                </button>
                <button className="px-4 py-2 text-sm font-medium text-white bg-slate-900 rounded-xl hover:bg-slate-800">
                  Schedule Appointment
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
