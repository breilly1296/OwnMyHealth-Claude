/**
 * InsurancePlanDetail Component
 *
 * Displays comprehensive coverage details for an insurance plan.
 * Shows all extracted SBC data in organized, readable sections.
 *
 * @module components/insurance/InsurancePlanDetail
 */

import React, { useState } from 'react';
import {
  ArrowLeft,
  Shield,
  DollarSign,
  Stethoscope,
  Building2,
  Activity,
  AlertTriangle,
  Heart,
  Eye,
  Smile,
  Pill,
  Ban,
  FileWarning,
  Ambulance,
  CheckCircle,
  ChevronDown,
  ChevronUp,
  Home,
  HeartPulse,
} from 'lucide-react';
import type { InsurancePlan } from '../../types';

interface InsurancePlanDetailProps {
  plan: InsurancePlan;
  onBack: () => void;
}

// Helper to format currency
const formatCurrency = (amount: number | undefined | null): string => {
  if (amount === undefined || amount === null) return '--';
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount);
};

// Helper to format percentage
const formatPercent = (value: number | undefined | null): string => {
  if (value === undefined || value === null) return '--';
  return `${value}%`;
};

// Helper to format copay (shows $0 as "No charge")
const formatCopay = (amount: number | undefined | null): string => {
  if (amount === undefined || amount === null) return '--';
  if (amount === 0) return 'No charge';
  return formatCurrency(amount);
};

// Helper to format coinsurance
const formatCoinsurance = (value: number | undefined | null): string => {
  if (value === undefined || value === null) return '--';
  if (value === 0) return 'No charge';
  return `${value}% after deductible`;
};

// Helper to format visit limit
const formatLimit = (limit: number | undefined | null, type: string = 'visits'): string => {
  if (limit === undefined || limit === null) return 'No limit';
  return `${limit} ${type}/year`;
};

// Section component with collapsible content
interface SectionProps {
  title: string;
  icon: React.ReactNode;
  children: React.ReactNode;
  defaultOpen?: boolean;
  badge?: string;
  badgeColor?: 'blue' | 'green' | 'amber' | 'red';
}

function Section({ title, icon, children, defaultOpen = true, badge, badgeColor = 'blue' }: SectionProps) {
  const [isOpen, setIsOpen] = useState(defaultOpen);

  const badgeColors = {
    blue: 'bg-blue-50 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
    green: 'bg-green-50 text-green-700 dark:bg-green-900/30 dark:text-green-400',
    amber: 'bg-amber-50 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400',
    red: 'bg-red-50 text-red-700 dark:bg-red-900/30 dark:text-red-400',
  };

  return (
    <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200/60 dark:border-slate-700 overflow-hidden">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="w-full flex items-center justify-between p-4 hover:bg-slate-50 dark:hover:bg-slate-700/50 transition-colors"
      >
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-slate-100 dark:bg-slate-700 flex items-center justify-center text-slate-600 dark:text-slate-300">
            {icon}
          </div>
          <h3 className="font-semibold text-slate-900 dark:text-white">{title}</h3>
          {badge && (
            <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${badgeColors[badgeColor]}`}>
              {badge}
            </span>
          )}
        </div>
        {isOpen ? (
          <ChevronUp className="w-5 h-5 text-slate-400" />
        ) : (
          <ChevronDown className="w-5 h-5 text-slate-400" />
        )}
      </button>
      {isOpen && (
        <div className="px-4 pb-4 border-t border-slate-100 dark:border-slate-700 pt-4">
          {children}
        </div>
      )}
    </div>
  );
}

// Coverage row component
interface CoverageRowProps {
  label: string;
  value: string;
  sublabel?: string;
  highlight?: boolean;
}

function CoverageRow({ label, value, sublabel, highlight = false }: CoverageRowProps) {
  return (
    <div className={`flex justify-between items-start py-2 ${highlight ? 'bg-blue-50/50 dark:bg-blue-900/10 -mx-2 px-2 rounded-lg' : ''}`}>
      <div>
        <p className="text-sm text-slate-600 dark:text-slate-300">{label}</p>
        {sublabel && <p className="text-xs text-slate-400 dark:text-slate-500">{sublabel}</p>}
      </div>
      <p className={`text-sm font-medium ${value === '--' ? 'text-slate-400 dark:text-slate-500' : 'text-slate-900 dark:text-white'}`}>
        {value}
      </p>
    </div>
  );
}

// Two-column grid for individual/family values
interface CostGridProps {
  label: string;
  individual: number | undefined | null;
  family: number | undefined | null;
  metIndividual?: number | null;
  metFamily?: number | null;
  showProgress?: boolean;
}

function CostGrid({ label, individual, family, metIndividual, metFamily, showProgress = false }: CostGridProps) {
  const indivPercent = individual && metIndividual !== undefined && metIndividual !== null
    ? Math.min(100, (metIndividual / individual) * 100)
    : 0;
  const famPercent = family && metFamily !== undefined && metFamily !== null
    ? Math.min(100, (metFamily / family) * 100)
    : 0;

  return (
    <div className="py-3 border-b border-slate-100 dark:border-slate-700 last:border-0">
      <p className="text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">{label}</p>
      <div className="grid grid-cols-2 gap-4">
        <div>
          <p className="text-xs text-slate-400 dark:text-slate-500 mb-1">Individual</p>
          <p className="text-lg font-semibold text-slate-900 dark:text-white">{formatCurrency(individual)}</p>
          {showProgress && individual && (
            <div className="mt-2">
              <div className="flex justify-between text-xs text-slate-500 mb-1">
                <span>Met: {formatCurrency(metIndividual || 0)}</span>
                <span>{Math.round(indivPercent)}%</span>
              </div>
              <div className="h-1.5 bg-slate-100 dark:bg-slate-700 rounded-full overflow-hidden">
                <div
                  className="h-full bg-blue-500 rounded-full transition-all"
                  style={{ width: `${indivPercent}%` }}
                />
              </div>
            </div>
          )}
        </div>
        <div>
          <p className="text-xs text-slate-400 dark:text-slate-500 mb-1">Family</p>
          <p className="text-lg font-semibold text-slate-900 dark:text-white">{formatCurrency(family)}</p>
          {showProgress && family && (
            <div className="mt-2">
              <div className="flex justify-between text-xs text-slate-500 mb-1">
                <span>Met: {formatCurrency(metFamily || 0)}</span>
                <span>{Math.round(famPercent)}%</span>
              </div>
              <div className="h-1.5 bg-slate-100 dark:bg-slate-700 rounded-full overflow-hidden">
                <div
                  className="h-full bg-emerald-500 rounded-full transition-all"
                  style={{ width: `${famPercent}%` }}
                />
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default function InsurancePlanDetail({ plan, onBack }: InsurancePlanDetailProps) {
  // Check which sections have data
  const hasVision = plan.visionExamCopay !== undefined || plan.visionLensesAllowance !== undefined;
  const hasDental = plan.dentalPreventiveCoinsurance !== undefined || plan.dentalAnnualMax !== undefined;
  const hasPreventive = plan.preventiveServicesList && plan.preventiveServicesList.length > 0;
  const hasExclusions = plan.exclusionsList && plan.exclusionsList.length > 0;
  const hasPriorAuth = plan.priorAuthRequirements && plan.priorAuthRequirements.length > 0;

  return (
    <div className="animate-fade-in max-w-4xl mx-auto">
      {/* Header */}
      <div className="mb-6">
        <button
          onClick={onBack}
          className="flex items-center gap-2 text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200 transition-colors mb-4"
        >
          <ArrowLeft className="w-4 h-4" />
          <span className="text-sm">Back to Plans</span>
        </button>

        <div className="flex items-start justify-between">
          <div className="flex items-start gap-4">
            <div className="w-14 h-14 bg-gradient-to-br from-blue-500 to-indigo-600 rounded-xl flex items-center justify-center flex-shrink-0">
              <Shield className="w-7 h-7 text-white" />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-slate-900 dark:text-white">{plan.planName}</h1>
              <p className="text-slate-500 dark:text-slate-400 mt-1">{plan.insurerName}</p>
              <div className="flex items-center gap-3 mt-2">
                <span className="text-xs font-medium px-2.5 py-1 bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400 rounded-lg">
                  {plan.planType}
                </span>
                {plan.planIdNumber && (
                  <span className="text-xs text-slate-400 dark:text-slate-500">
                    Plan ID: {plan.planIdNumber}
                  </span>
                )}
                <span className="text-xs text-slate-400 dark:text-slate-500">
                  Effective {new Date(plan.effectiveDate).toLocaleDateString()}
                </span>
              </div>
            </div>
          </div>
          {plan.sbcExtractionConfidence && (
            <div className="text-right">
              <p className="text-xs text-slate-400 dark:text-slate-500">Extraction confidence</p>
              <p className="text-lg font-semibold text-slate-900 dark:text-white">
                {Math.round(plan.sbcExtractionConfidence * 100)}%
              </p>
            </div>
          )}
        </div>
      </div>

      {/* Coverage Sections */}
      <div className="space-y-4">
        {/* Cost Sharing Section */}
        <Section title="Cost Sharing" icon={<DollarSign className="w-4 h-4" />}>
          <CostGrid
            label="Deductible"
            individual={plan.deductibleIndividual}
            family={plan.deductibleFamily}
            metIndividual={plan.deductibleMetIndividual}
            metFamily={plan.deductibleMetFamily}
            showProgress
          />
          <CostGrid
            label="Out-of-Pocket Maximum"
            individual={plan.oopMaxIndividual}
            family={plan.oopMaxFamily}
            metIndividual={plan.oopMetIndividual}
            metFamily={plan.oopMetFamily}
            showProgress
          />
          <div className="pt-3">
            <CoverageRow label="Coinsurance (after deductible)" value={formatPercent(plan.coinsuranceRate)} />
            {plan.premiumMonthly && (
              <CoverageRow label="Monthly Premium" value={formatCurrency(plan.premiumMonthly)} highlight />
            )}
          </div>
        </Section>

        {/* Office Visits Section */}
        <Section title="Office Visits" icon={<Stethoscope className="w-4 h-4" />}>
          <div className="divide-y divide-slate-100 dark:divide-slate-700">
            <CoverageRow label="Primary Care Visit" value={formatCopay(plan.copayPrimaryCare)} />
            <CoverageRow label="Specialist Visit" value={formatCopay(plan.copaySpecialist)} />
            <CoverageRow label="Telehealth/Virtual Visit" value={formatCopay(plan.copayTelehealth)} />
            <CoverageRow label="Lab Work" value={formatCopay(plan.copayLabWork)} />
            <CoverageRow label="X-ray" value={formatCopay(plan.copayXray)} />
            <CoverageRow label="Advanced Imaging (MRI/CT)" value={formatCopay(plan.copayAdvancedImaging)} />
          </div>
        </Section>

        {/* Hospital/Inpatient Section */}
        <Section title="Hospital & Inpatient" icon={<Building2 className="w-4 h-4" />}>
          <div className="divide-y divide-slate-100 dark:divide-slate-700">
            <CoverageRow
              label="Hospital Stay"
              value={plan.inpatientHospitalCopay ? formatCopay(plan.inpatientHospitalCopay) : formatCoinsurance(plan.inpatientHospitalCoinsurance)}
              sublabel="Facility fee"
            />
            <CoverageRow
              label="Mental Health Inpatient"
              value={plan.inpatientMentalHealthCopay ? formatCopay(plan.inpatientMentalHealthCopay) : formatCoinsurance(plan.inpatientMentalCoinsurance)}
            />
            <CoverageRow
              label="Maternity Care"
              value={plan.maternityCopay ? formatCopay(plan.maternityCopay) : formatCoinsurance(plan.maternityCoinsurance)}
            />
            <CoverageRow
              label="Skilled Nursing Facility"
              value={plan.skilledNursingCopay ? formatCopay(plan.skilledNursingCopay) : formatCoinsurance(plan.skilledNursingCoinsurance)}
              sublabel={plan.skilledNursingDaysLimit ? `Limit: ${plan.skilledNursingDaysLimit} days/year` : undefined}
            />
            <CoverageRow
              label="Outpatient Surgery"
              value={plan.outpatientSurgeryCopay ? formatCopay(plan.outpatientSurgeryCopay) : formatCoinsurance(plan.outpatientSurgeryCoinsurance)}
              sublabel="Facility fee"
            />
            <CoverageRow
              label="Mental Health Outpatient"
              value={plan.outpatientMentalHealthCopay ? formatCopay(plan.outpatientMentalHealthCopay) : formatCoinsurance(plan.outpatientMentalCoinsurance)}
            />
          </div>
        </Section>

        {/* Therapy Section */}
        <Section title="Therapy & Rehabilitation" icon={<Activity className="w-4 h-4" />}>
          <div className="divide-y divide-slate-100 dark:divide-slate-700">
            <CoverageRow
              label="Physical Therapy"
              value={formatCopay(plan.physicalTherapyCopay)}
              sublabel={formatLimit(plan.physicalTherapyVisitsLimit)}
            />
            <CoverageRow
              label="Occupational Therapy"
              value={formatCopay(plan.occupationalTherapyCopay)}
              sublabel={formatLimit(plan.occupationalTherapyVisitsLimit)}
            />
            <CoverageRow
              label="Speech Therapy"
              value={formatCopay(plan.speechTherapyCopay)}
              sublabel={formatLimit(plan.speechTherapyVisitsLimit)}
            />
            <CoverageRow
              label="Chiropractic Care"
              value={formatCopay(plan.chiropracticCopay)}
              sublabel={formatLimit(plan.chiropracticVisitsLimit)}
            />
            <CoverageRow
              label="Acupuncture"
              value={formatCopay(plan.acupunctureCopay)}
              sublabel={formatLimit(plan.acupunctureVisitsLimit)}
            />
            <CoverageRow
              label="Cardiac Rehabilitation"
              value={formatCopay(plan.cardiacRehabCopay)}
              sublabel={formatLimit(plan.cardiacRehabVisitsLimit)}
            />
            <CoverageRow
              label="Pulmonary Rehabilitation"
              value={formatCopay(plan.pulmonaryRehabCopay)}
              sublabel={formatLimit(plan.pulmonaryRehabVisitsLimit)}
            />
          </div>
        </Section>

        {/* Emergency Section */}
        <Section title="Emergency & Urgent Care" icon={<Ambulance className="w-4 h-4" />}>
          <div className="divide-y divide-slate-100 dark:divide-slate-700">
            <CoverageRow
              label="Emergency Room"
              value={formatCopay(plan.copayEmergency)}
              sublabel="Waived if admitted"
            />
            <CoverageRow label="Urgent Care" value={formatCopay(plan.copayUrgentCare)} />
            <CoverageRow
              label="Ground Ambulance"
              value={plan.ambulanceGroundCopay ? formatCopay(plan.ambulanceGroundCopay) : formatCoinsurance(plan.ambulanceGroundCoinsurance)}
            />
            <CoverageRow
              label="Air Ambulance"
              value={plan.ambulanceAirCopay ? formatCopay(plan.ambulanceAirCopay) : formatCoinsurance(plan.ambulanceAirCoinsurance)}
            />
          </div>
        </Section>

        {/* Preventive Care Section */}
        {hasPreventive && (
          <Section
            title="Preventive Care"
            icon={<Heart className="w-4 h-4" />}
            badge="Covered 100%"
            badgeColor="green"
          >
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
              {plan.preventiveServicesList?.map((service, index) => (
                <div key={index} className="flex items-start gap-2 py-1.5">
                  <CheckCircle className="w-4 h-4 text-green-500 mt-0.5 flex-shrink-0" />
                  <span className="text-sm text-slate-600 dark:text-slate-300">{service}</span>
                </div>
              ))}
            </div>
          </Section>
        )}

        {/* Vision Section */}
        {hasVision && (
          <Section title="Vision" icon={<Eye className="w-4 h-4" />}>
            <div className="divide-y divide-slate-100 dark:divide-slate-700">
              <CoverageRow
                label="Eye Exam"
                value={formatCopay(plan.visionExamCopay)}
                sublabel={plan.visionExamFrequency || 'Once per year'}
              />
              <CoverageRow label="Lenses Allowance" value={formatCurrency(plan.visionLensesAllowance)} />
              <CoverageRow label="Frames Allowance" value={formatCurrency(plan.visionFramesAllowance)} />
              <CoverageRow label="Contacts Allowance" value={formatCurrency(plan.visionContactsAllowance)} />
            </div>
          </Section>
        )}

        {/* Dental Section */}
        {hasDental && (
          <Section title="Dental" icon={<Smile className="w-4 h-4" />}>
            <div className="divide-y divide-slate-100 dark:divide-slate-700">
              <CoverageRow
                label="Preventive (cleanings, exams)"
                value={plan.dentalPreventiveCoinsurance === 0 ? 'No charge' : `${plan.dentalPreventiveCoinsurance}% coinsurance`}
              />
              <CoverageRow
                label="Basic (fillings, extractions)"
                value={formatPercent(plan.dentalBasicCoinsurance)}
                sublabel="Coinsurance"
              />
              <CoverageRow
                label="Major (crowns, bridges)"
                value={formatPercent(plan.dentalMajorCoinsurance)}
                sublabel="Coinsurance"
              />
              <CoverageRow label="Annual Maximum" value={formatCurrency(plan.dentalAnnualMax)} />
              <CoverageRow label="Deductible" value={formatCurrency(plan.dentalDeductible)} />
              {plan.dentalOrthodontiaCoinsurance && (
                <>
                  <CoverageRow
                    label="Orthodontia"
                    value={formatPercent(plan.dentalOrthodontiaCoinsurance)}
                    sublabel="Coinsurance"
                  />
                  <CoverageRow label="Orthodontia Lifetime Max" value={formatCurrency(plan.dentalOrthodontiaLifetimeMax)} />
                </>
              )}
            </div>
          </Section>
        )}

        {/* Prescription Drugs Section */}
        <Section title="Prescription Drugs" icon={<Pill className="w-4 h-4" />}>
          <div className="mb-4">
            <p className="text-xs text-slate-400 dark:text-slate-500 uppercase tracking-wider mb-3">Copays by Tier</p>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <div className="bg-slate-50 dark:bg-slate-900/50 rounded-lg p-3 text-center">
                <p className="text-xs text-slate-500 dark:text-slate-400 mb-1">Tier 1</p>
                <p className="text-lg font-semibold text-slate-900 dark:text-white">{formatCopay(plan.rxTier1Copay)}</p>
                <p className="text-xs text-slate-400">Generic</p>
              </div>
              <div className="bg-slate-50 dark:bg-slate-900/50 rounded-lg p-3 text-center">
                <p className="text-xs text-slate-500 dark:text-slate-400 mb-1">Tier 2</p>
                <p className="text-lg font-semibold text-slate-900 dark:text-white">{formatCopay(plan.rxTier2Copay)}</p>
                <p className="text-xs text-slate-400">Preferred</p>
              </div>
              <div className="bg-slate-50 dark:bg-slate-900/50 rounded-lg p-3 text-center">
                <p className="text-xs text-slate-500 dark:text-slate-400 mb-1">Tier 3</p>
                <p className="text-lg font-semibold text-slate-900 dark:text-white">{formatCopay(plan.rxTier3Copay)}</p>
                <p className="text-xs text-slate-400">Non-preferred</p>
              </div>
              <div className="bg-slate-50 dark:bg-slate-900/50 rounded-lg p-3 text-center">
                <p className="text-xs text-slate-500 dark:text-slate-400 mb-1">Tier 4</p>
                <p className="text-lg font-semibold text-slate-900 dark:text-white">{formatCopay(plan.rxTier4Copay)}</p>
                <p className="text-xs text-slate-400">Specialty</p>
              </div>
            </div>
          </div>
          <div className="divide-y divide-slate-100 dark:divide-slate-700">
            <CoverageRow
              label="Retail Supply"
              value={plan.rxRetailDaysSupply ? `${plan.rxRetailDaysSupply} days` : '--'}
            />
            <CoverageRow
              label="Mail Order Supply"
              value={plan.rxMailOrderDaysSupply ? `${plan.rxMailOrderDaysSupply} days` : '--'}
            />
            {(plan.rxDeductibleIndividual || plan.rxDeductibleFamily) && (
              <div className="py-2">
                <p className="text-sm text-slate-600 dark:text-slate-300 mb-2">Separate Rx Deductible</p>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <p className="text-xs text-slate-400">Individual</p>
                    <p className="text-sm font-medium text-slate-900 dark:text-white">{formatCurrency(plan.rxDeductibleIndividual)}</p>
                  </div>
                  <div>
                    <p className="text-xs text-slate-400">Family</p>
                    <p className="text-sm font-medium text-slate-900 dark:text-white">{formatCurrency(plan.rxDeductibleFamily)}</p>
                  </div>
                </div>
              </div>
            )}
          </div>
        </Section>

        {/* Other Services Section */}
        <Section title="Other Services" icon={<Home className="w-4 h-4" />} defaultOpen={false}>
          <div className="divide-y divide-slate-100 dark:divide-slate-700">
            <CoverageRow
              label="Durable Medical Equipment"
              value={plan.dmeCopay ? formatCopay(plan.dmeCopay) : formatCoinsurance(plan.dmeCoinsurance)}
            />
            <CoverageRow
              label="Home Health Care"
              value={plan.homeHealthVisitCopay ? formatCopay(plan.homeHealthVisitCopay) : formatCoinsurance(plan.homeHealthVisitCoinsurance)}
              sublabel={plan.homeHealthVisitLimit ? `Limit: ${plan.homeHealthVisitLimit} visits/year` : undefined}
            />
            <CoverageRow
              label="Hospice (Inpatient)"
              value={plan.hospiceInpatientCopay ? formatCopay(plan.hospiceInpatientCopay) : formatCoinsurance(plan.hospiceInpatientCoinsurance)}
            />
            <CoverageRow
              label="Hospice (Respite Care)"
              value={plan.hospiceRespiteCopay ? formatCopay(plan.hospiceRespiteCopay) : formatCoinsurance(plan.hospiceRespiteCoinsurance)}
              sublabel={plan.hospiceRespiteDayLimit ? `Limit: ${plan.hospiceRespiteDayLimit} days` : undefined}
            />
          </div>
        </Section>

        {/* Exclusions Section */}
        {hasExclusions && (
          <Section
            title="Exclusions"
            icon={<Ban className="w-4 h-4" />}
            badge="Not Covered"
            badgeColor="red"
            defaultOpen={false}
          >
            <div className="space-y-2">
              {plan.exclusionsList?.map((exclusion, index) => (
                <div key={index} className="flex items-start gap-2 py-1.5">
                  <AlertTriangle className="w-4 h-4 text-red-500 mt-0.5 flex-shrink-0" />
                  <span className="text-sm text-slate-600 dark:text-slate-300">{exclusion}</span>
                </div>
              ))}
            </div>
          </Section>
        )}

        {/* Prior Authorization Section */}
        {hasPriorAuth && (
          <Section
            title="Prior Authorization Required"
            icon={<FileWarning className="w-4 h-4" />}
            badge={`${plan.priorAuthRequirements?.length} services`}
            badgeColor="amber"
            defaultOpen={false}
          >
            <p className="text-sm text-slate-500 dark:text-slate-400 mb-3">
              These services require pre-approval from your insurance before receiving care.
            </p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
              {plan.priorAuthRequirements?.map((service, index) => (
                <div key={index} className="flex items-start gap-2 py-1.5">
                  <FileWarning className="w-4 h-4 text-amber-500 mt-0.5 flex-shrink-0" />
                  <span className="text-sm text-slate-600 dark:text-slate-300">{service}</span>
                </div>
              ))}
            </div>
          </Section>
        )}

        {/* Service Limits Section */}
        {plan.servicesWithLimits && plan.servicesWithLimits.length > 0 && (
          <Section
            title="Service Limits"
            icon={<HeartPulse className="w-4 h-4" />}
            defaultOpen={false}
          >
            <div className="divide-y divide-slate-100 dark:divide-slate-700">
              {plan.servicesWithLimits.map((limit, index) => (
                <CoverageRow
                  key={index}
                  label={limit.service}
                  value={`${limit.limit} ${limit.limitType}`}
                  sublabel={limit.period}
                />
              ))}
            </div>
          </Section>
        )}
      </div>
    </div>
  );
}
