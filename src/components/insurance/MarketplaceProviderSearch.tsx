/**
 * MarketplaceProviderSearch Component
 *
 * Searches for healthcare providers using the Healthcare.gov Marketplace API.
 * Features:
 * - Search by zipcode and specialty
 * - Filter by provider type (individual/facility)
 * - Check network status for insurance plans
 * - View provider details including contact info
 *
 * @module components/insurance/MarketplaceProviderSearch
 */

import React, { useState } from 'react';
import {
  Search,
  MapPin,
  Phone,
  User,
  Building2,
  CheckCircle,
  XCircle,
  Loader2,
  AlertCircle,
  ChevronRight,
  Globe,
  Stethoscope,
  X,
  Users
} from 'lucide-react';
import {
  marketplaceApi,
  type MarketplaceProvider,
  type MarketplaceProviderSearchResult,
  type MarketplaceProviderSearchParams
} from '../../services/api';

interface MarketplaceProviderSearchProps {
  planId?: string; // Optional: filter by in-network for this plan
  onProviderSelect?: (provider: MarketplaceProvider) => void;
}

const SPECIALTY_OPTIONS = [
  'Family Medicine',
  'Internal Medicine',
  'Pediatrics',
  'Cardiology',
  'Dermatology',
  'Endocrinology',
  'Gastroenterology',
  'Neurology',
  'Obstetrics & Gynecology',
  'Oncology',
  'Ophthalmology',
  'Orthopedics',
  'Psychiatry',
  'Pulmonology',
  'Rheumatology',
  'Urology',
];

export default function MarketplaceProviderSearch({
  planId,
  onProviderSelect
}: MarketplaceProviderSearchProps) {
  const [zipcode, setZipcode] = useState('');
  const [specialty, setSpecialty] = useState('');
  const [providerType, setProviderType] = useState<'individual' | 'facility' | ''>('');
  const [radius, setRadius] = useState(25);
  const [isSearching, setIsSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [results, setResults] = useState<MarketplaceProviderSearchResult | null>(null);
  const [selectedProvider, setSelectedProvider] = useState<MarketplaceProvider | null>(null);
  const [networkStatus, setNetworkStatus] = useState<{ inNetwork: boolean; networkTier?: string } | null>(null);
  const [checkingNetwork, setCheckingNetwork] = useState(false);

  const handleSearch = async () => {
    if (!zipcode || !/^\d{5}$/.test(zipcode)) {
      setSearchError('Please enter a valid 5-digit zipcode');
      return;
    }

    setIsSearching(true);
    setSearchError(null);
    setResults(null);

    try {
      const params: MarketplaceProviderSearchParams = {
        zipcode,
        radius,
        limit: 20,
      };

      if (specialty) params.specialty = specialty;
      if (providerType) params.type = providerType;
      if (planId) params.planId = planId;

      const data = await marketplaceApi.searchProviders(params);
      setResults(data);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to search providers';
      setSearchError(message);
    } finally {
      setIsSearching(false);
    }
  };

  const handleProviderClick = async (provider: MarketplaceProvider) => {
    setSelectedProvider(provider);
    setNetworkStatus(null);

    // Check network status if we have a plan ID
    if (planId) {
      setCheckingNetwork(true);
      try {
        const status = await marketplaceApi.checkProviderNetwork(provider.npi, planId);
        setNetworkStatus(status);
      } catch {
        // Network check failed - not critical
        setNetworkStatus(null);
      } finally {
        setCheckingNetwork(false);
      }
    }

    if (onProviderSelect) {
      onProviderSelect(provider);
    }
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleSearch();
    }
  };

  return (
    <div className="space-y-6">
      {/* Search Form */}
      <div className="bg-white rounded-2xl border border-slate-200/60 p-6">
        <div className="flex items-center gap-3 mb-5">
          <div className="w-10 h-10 rounded-xl bg-blue-100 flex items-center justify-center">
            <Search className="w-5 h-5 text-blue-600" />
          </div>
          <div>
            <h3 className="font-semibold text-slate-900">Find Healthcare Providers</h3>
            <p className="text-sm text-slate-500">Search the Healthcare.gov provider network</p>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {/* Zipcode */}
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-2">
              Zipcode *
            </label>
            <div className="relative">
              <MapPin className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
              <input
                type="text"
                value={zipcode}
                onChange={(e) => setZipcode(e.target.value.replace(/\D/g, '').slice(0, 5))}
                onKeyPress={handleKeyPress}
                placeholder="12345"
                className="w-full pl-10 pr-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-300"
              />
            </div>
          </div>

          {/* Specialty */}
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-2">
              Specialty
            </label>
            <select
              value={specialty}
              onChange={(e) => setSpecialty(e.target.value)}
              className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-300"
            >
              <option value="">All specialties</option>
              {SPECIALTY_OPTIONS.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          </div>

          {/* Provider Type */}
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-2">
              Provider Type
            </label>
            <select
              value={providerType}
              onChange={(e) => setProviderType(e.target.value as 'individual' | 'facility' | '')}
              className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-300"
            >
              <option value="">All types</option>
              <option value="individual">Individual Provider</option>
              <option value="facility">Facility</option>
            </select>
          </div>

          {/* Radius */}
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-2">
              Distance
            </label>
            <select
              value={radius}
              onChange={(e) => setRadius(parseInt(e.target.value))}
              className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-300"
            >
              <option value={10}>10 miles</option>
              <option value={25}>25 miles</option>
              <option value={50}>50 miles</option>
              <option value={100}>100 miles</option>
            </select>
          </div>
        </div>

        <div className="mt-5 pt-5 border-t border-slate-100 flex items-center justify-between">
          {planId && (
            <div className="flex items-center gap-2 text-sm text-slate-500">
              <CheckCircle className="w-4 h-4 text-green-500" />
              <span>Filtering by your insurance plan network</span>
            </div>
          )}
          {!planId && <div />}

          <button
            onClick={handleSearch}
            disabled={isSearching || !zipcode}
            className="flex items-center gap-2 px-5 py-2.5 bg-slate-900 text-white text-sm font-medium rounded-xl hover:bg-slate-800 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {isSearching ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Search className="w-4 h-4" />
            )}
            Search Providers
          </button>
        </div>
      </div>

      {/* Error Message */}
      {searchError && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-4 flex items-center gap-3">
          <AlertCircle className="w-5 h-5 text-red-500 flex-shrink-0" />
          <p className="text-red-700 text-sm">{searchError}</p>
          <button
            onClick={() => setSearchError(null)}
            className="ml-auto text-red-500 hover:text-red-700"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Results */}
      {results && (
        <div>
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-semibold text-slate-900">
              {results.total} provider{results.total !== 1 ? 's' : ''} found
            </h3>
            <span className="text-sm text-slate-500">
              Showing {results.providers.length} of {results.total}
            </span>
          </div>

          {results.providers.length === 0 ? (
            <div className="bg-slate-50 rounded-2xl p-12 text-center">
              <Users className="w-12 h-12 text-slate-300 mx-auto mb-4" />
              <p className="text-slate-600 font-medium">No providers found</p>
              <p className="text-sm text-slate-400 mt-1">Try expanding your search radius or changing filters</p>
            </div>
          ) : (
            <div className="space-y-3">
              {results.providers.map((provider) => (
                <div
                  key={provider.npi}
                  onClick={() => handleProviderClick(provider)}
                  className="bg-white rounded-xl border border-slate-200/60 p-5 hover:border-blue-200 hover:shadow-sm transition-all cursor-pointer group"
                >
                  <div className="flex items-start gap-4">
                    <div className="w-12 h-12 rounded-xl bg-slate-100 flex items-center justify-center flex-shrink-0">
                      {provider.facilityType ? (
                        <Building2 className="w-6 h-6 text-slate-400" />
                      ) : (
                        <User className="w-6 h-6 text-slate-400" />
                      )}
                    </div>

                    <div className="flex-1 min-w-0">
                      <div className="flex items-start justify-between gap-4">
                        <div>
                          <h4 className="font-semibold text-slate-900">{provider.name.full}</h4>
                          {provider.specialty && provider.specialty.length > 0 && (
                            <p className="text-sm text-slate-500">{provider.specialty.join(', ')}</p>
                          )}
                        </div>
                        {provider.acceptingNewPatients !== undefined && (
                          <span className={`flex-shrink-0 text-xs font-medium px-2.5 py-1 rounded-full ${
                            provider.acceptingNewPatients
                              ? 'bg-green-50 text-green-700'
                              : 'bg-amber-50 text-amber-700'
                          }`}>
                            {provider.acceptingNewPatients ? 'Accepting Patients' : 'Not Accepting'}
                          </span>
                        )}
                      </div>

                      <div className="flex flex-wrap items-center gap-4 mt-3 text-sm text-slate-600">
                        <div className="flex items-center gap-1.5">
                          <MapPin className="w-4 h-4 text-slate-400" />
                          <span>{provider.address.city}, {provider.address.state}</span>
                        </div>
                        {provider.phone && (
                          <div className="flex items-center gap-1.5">
                            <Phone className="w-4 h-4 text-slate-400" />
                            <span>{provider.phone}</span>
                          </div>
                        )}
                        {provider.distance && (
                          <div className="flex items-center gap-1.5">
                            <MapPin className="w-4 h-4 text-slate-400" />
                            <span>{provider.distance.toFixed(1)} miles</span>
                          </div>
                        )}
                      </div>

                      {provider.languages && provider.languages.length > 1 && (
                        <div className="flex items-center gap-2 mt-3">
                          <Globe className="w-4 h-4 text-slate-400" />
                          <div className="flex gap-1.5">
                            {provider.languages.slice(0, 3).map((lang, i) => (
                              <span key={i} className="text-xs px-2 py-0.5 bg-slate-100 text-slate-600 rounded">
                                {lang}
                              </span>
                            ))}
                            {provider.languages.length > 3 && (
                              <span className="text-xs text-slate-400">+{provider.languages.length - 3}</span>
                            )}
                          </div>
                        </div>
                      )}
                    </div>

                    <ChevronRight className="w-5 h-5 text-slate-300 group-hover:text-blue-500 transition-colors flex-shrink-0" />
                  </div>
                </div>
              ))}
            </div>
          )}

          {results.hasMore && (
            <div className="mt-4 text-center">
              <button
                onClick={() => {
                  // Load more functionality
                }}
                className="text-sm text-blue-600 hover:text-blue-700 font-medium"
              >
                Load more providers
              </button>
            </div>
          )}
        </div>
      )}

      {/* Empty State - No Search Yet */}
      {!results && !isSearching && !searchError && (
        <div className="bg-slate-50 rounded-2xl p-12 text-center">
          <div className="w-16 h-16 bg-slate-100 rounded-2xl flex items-center justify-center mx-auto mb-4">
            <Stethoscope className="w-8 h-8 text-slate-400" />
          </div>
          <h3 className="text-lg font-semibold text-slate-900 mb-2">Search Healthcare.gov Providers</h3>
          <p className="text-slate-500 text-sm max-w-md mx-auto">
            Enter your zipcode to find healthcare providers in the Healthcare.gov marketplace network.
          </p>
        </div>
      )}

      {/* Provider Detail Modal */}
      {selectedProvider && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl w-full max-w-lg max-h-[90vh] overflow-hidden shadow-2xl animate-fade-in">
            {/* Modal Header */}
            <div className="px-6 py-5 border-b border-slate-100 flex items-start justify-between">
              <div className="flex items-center gap-4">
                <div className="w-14 h-14 rounded-xl bg-slate-100 flex items-center justify-center">
                  {selectedProvider.facilityType ? (
                    <Building2 className="w-7 h-7 text-slate-400" />
                  ) : (
                    <User className="w-7 h-7 text-slate-400" />
                  )}
                </div>
                <div>
                  <h2 className="text-lg font-bold text-slate-900">{selectedProvider.name.full}</h2>
                  {selectedProvider.specialty && (
                    <p className="text-sm text-slate-500">{selectedProvider.specialty.join(', ')}</p>
                  )}
                </div>
              </div>
              <button
                onClick={() => setSelectedProvider(null)}
                className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-xl"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Modal Content */}
            <div className="p-6 space-y-5 overflow-y-auto max-h-[60vh]">
              {/* Network Status */}
              {planId && (
                <div className="p-4 rounded-xl bg-slate-50">
                  <h4 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">Network Status</h4>
                  {checkingNetwork ? (
                    <div className="flex items-center gap-2 text-slate-500">
                      <Loader2 className="w-4 h-4 animate-spin" />
                      <span className="text-sm">Checking network status...</span>
                    </div>
                  ) : networkStatus ? (
                    <div className="flex items-center gap-2">
                      {networkStatus.inNetwork ? (
                        <>
                          <CheckCircle className="w-5 h-5 text-green-500" />
                          <span className="text-green-700 font-medium">In-Network</span>
                          {networkStatus.networkTier && (
                            <span className="text-sm text-slate-500">({networkStatus.networkTier})</span>
                          )}
                        </>
                      ) : (
                        <>
                          <XCircle className="w-5 h-5 text-red-500" />
                          <span className="text-red-700 font-medium">Out-of-Network</span>
                        </>
                      )}
                    </div>
                  ) : (
                    <p className="text-sm text-slate-500">Network status unavailable</p>
                  )}
                </div>
              )}

              {/* NPI */}
              <div>
                <h4 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">NPI Number</h4>
                <p className="text-slate-900 font-mono">{selectedProvider.npi}</p>
              </div>

              {/* Address */}
              <div>
                <h4 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">Address</h4>
                <div className="flex items-start gap-3">
                  <MapPin className="w-4 h-4 text-slate-400 mt-0.5" />
                  <div className="text-slate-700">
                    <p>{selectedProvider.address.street}</p>
                    <p>{selectedProvider.address.city}, {selectedProvider.address.state} {selectedProvider.address.zip}</p>
                  </div>
                </div>
              </div>

              {/* Phone */}
              {selectedProvider.phone && (
                <div>
                  <h4 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">Phone</h4>
                  <div className="flex items-center gap-3">
                    <Phone className="w-4 h-4 text-slate-400" />
                    <a href={`tel:${selectedProvider.phone}`} className="text-blue-600 hover:underline">
                      {selectedProvider.phone}
                    </a>
                  </div>
                </div>
              )}

              {/* Accepting Patients */}
              {selectedProvider.acceptingNewPatients !== undefined && (
                <div>
                  <h4 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">Availability</h4>
                  <div className="flex items-center gap-2">
                    {selectedProvider.acceptingNewPatients ? (
                      <>
                        <CheckCircle className="w-4 h-4 text-green-500" />
                        <span className="text-green-700">Accepting new patients</span>
                      </>
                    ) : (
                      <>
                        <XCircle className="w-4 h-4 text-amber-500" />
                        <span className="text-amber-700">Not accepting new patients</span>
                      </>
                    )}
                  </div>
                </div>
              )}

              {/* Gender */}
              {selectedProvider.gender && (
                <div>
                  <h4 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">Gender</h4>
                  <p className="text-slate-700 capitalize">{selectedProvider.gender}</p>
                </div>
              )}

              {/* Languages */}
              {selectedProvider.languages && selectedProvider.languages.length > 0 && (
                <div>
                  <h4 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">Languages</h4>
                  <div className="flex flex-wrap gap-2">
                    {selectedProvider.languages.map((lang, i) => (
                      <span key={i} className="text-xs px-3 py-1.5 bg-blue-50 text-blue-700 rounded-lg">
                        {lang}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {/* Facility Type */}
              {selectedProvider.facilityType && (
                <div>
                  <h4 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">Facility Type</h4>
                  <p className="text-slate-700">{selectedProvider.facilityType}</p>
                </div>
              )}
            </div>

            {/* Modal Footer */}
            <div className="px-6 py-4 border-t border-slate-100 bg-slate-50 flex items-center justify-end gap-3">
              <button
                onClick={() => setSelectedProvider(null)}
                className="px-4 py-2 text-sm font-medium text-slate-700 bg-white border border-slate-200 rounded-xl hover:bg-slate-50"
              >
                Close
              </button>
              {selectedProvider.phone && (
                <a
                  href={`tel:${selectedProvider.phone}`}
                  className="px-4 py-2 text-sm font-medium text-white bg-slate-900 rounded-xl hover:bg-slate-800 inline-flex items-center gap-2"
                >
                  <Phone className="w-4 h-4" />
                  Call Provider
                </a>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
