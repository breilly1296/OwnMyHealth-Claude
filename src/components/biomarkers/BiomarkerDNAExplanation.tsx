import React from 'react';
import { Dna, X, AlertCircle, CheckCircle, Info, ExternalLink, Shield } from 'lucide-react';
import type { Biomarker, DNAVariant } from '../../types';

/**
 * Props for the BiomarkerDNAExplanation component.
 * @property biomarker - The biomarker to explain genetic factors for
 * @property dnaVariants - User's extracted DNA variants from 23andMe/AncestryDNA
 * @property isOpen - Controls modal visibility
 * @property onClose - Callback to close the modal
 */
interface BiomarkerDNAExplanationProps {
  biomarker: Biomarker;
  dnaVariants: DNAVariant[];
  isOpen: boolean;
  onClose: () => void;
}

// Map of biomarkers to relevant SNPs and their risk genotypes
const BIOMARKER_DNA_ASSOCIATIONS: Record<string, Array<{rsid: string, riskGenotypes: string[], gene: string, effect: string}>> = {
  'Glucose (Fasting)': [
    {
      rsid: 'rs7903146',
      gene: 'TCF7L2',
      riskGenotypes: ['TT', 'CT'],
      effect: 'Associated with impaired insulin secretion and increased risk of type 2 diabetes. May contribute to elevated fasting glucose levels.'
    },
    {
      rsid: 'rs1801282',
      gene: 'PPARG',
      riskGenotypes: ['CC', 'CG'],
      effect: 'Affects insulin sensitivity and glucose metabolism. The C allele is associated with reduced insulin sensitivity.'
    }
  ],
  'Hemoglobin A1C': [
    {
      rsid: 'rs7903146',
      gene: 'TCF7L2',
      riskGenotypes: ['TT', 'CT'],
      effect: 'Associated with impaired insulin secretion and increased risk of type 2 diabetes. May contribute to elevated A1C levels over time.'
    }
  ],
  'Total Cholesterol': [
    {
      rsid: 'rs429358',
      gene: 'APOE',
      riskGenotypes: ['CC', 'CT'],
      effect: 'The APOE E4 variant (C allele) is associated with higher total cholesterol and LDL cholesterol levels.'
    },
    {
      rsid: 'rs4149056',
      gene: 'SLCO1B1',
      riskGenotypes: ['CC', 'CT'],
      effect: 'Affects statin metabolism and may influence cholesterol management. Carriers may need alternative cholesterol-lowering approaches.'
    }
  ],
  'LDL Cholesterol': [
    {
      rsid: 'rs429358',
      gene: 'APOE',
      riskGenotypes: ['CC', 'CT'],
      effect: 'The APOE E4 variant (C allele) is associated with higher LDL cholesterol levels and increased cardiovascular risk.'
    }
  ],
  'HDL Cholesterol': [
    {
      rsid: 'rs1800588',
      gene: 'LIPC',
      riskGenotypes: ['CC'],
      effect: 'Associated with lower HDL cholesterol levels. The C allele may reduce the production of hepatic lipase.'
    }
  ],
  'Triglycerides': [
    {
      rsid: 'rs662799',
      gene: 'APOA5',
      riskGenotypes: ['GG', 'AG'],
      effect: 'Associated with higher triglyceride levels. The G allele affects the regulation of triglyceride metabolism.'
    }
  ],
  'Vitamin D': [
    {
      rsid: 'rs2282679',
      gene: 'GC',
      riskGenotypes: ['CC', 'AC'],
      effect: 'Affects vitamin D binding protein function. The C allele is associated with lower vitamin D levels.'
    },
    {
      rsid: 'rs1544410',
      gene: 'VDR',
      riskGenotypes: ['AA'],
      effect: 'Affects vitamin D receptor function. May influence how your body responds to vitamin D.'
    }
  ],
  'CRP': [
    {
      rsid: 'rs1205',
      gene: 'CRP',
      riskGenotypes: ['TT', 'CT'],
      effect: 'Directly affects CRP levels. The T allele is associated with lower baseline CRP levels.'
    },
    {
      rsid: 'rs1800795',
      gene: 'IL6',
      riskGenotypes: ['GG', 'CG'],
      effect: 'Affects IL-6 production, which regulates CRP. The G allele is associated with higher CRP levels.'
    }
  ],
  'Homocysteine': [
    {
      rsid: 'rs1801133',
      gene: 'MTHFR',
      riskGenotypes: ['TT', 'CT'],
      effect: 'The T allele reduces MTHFR enzyme activity by 30-70%, potentially leading to elevated homocysteine levels, especially with low folate intake.'
    }
  ]
};

/**
 * BiomarkerDNAExplanation - A modal explaining how genetic variants affect a biomarker.
 *
 * Cross-references the user's DNA data with known SNP associations for the biomarker:
 * - TCF7L2 (rs7903146) affects glucose metabolism
 * - APOE (rs429358) affects cholesterol levels
 * - MTHFR (rs1801133) affects homocysteine metabolism
 * - VDR (rs1544410) affects vitamin D receptor function
 *
 * For each relevant genetic variant, displays:
 * - Gene name and rsid
 * - User's genotype vs. risk genotypes
 * - Effect of the variant on the biomarker
 * - Personalized recommendations based on genotype
 *
 * If the user has risk variants and the biomarker is abnormal, provides
 * tailored lifestyle and monitoring recommendations.
 *
 * @param props - The component props
 * @returns A modal with genetic analysis, or null if closed
 */
export default function BiomarkerDNAExplanation({ biomarker, dnaVariants, isOpen, onClose }: BiomarkerDNAExplanationProps) {
  if (!isOpen) return null;
  
  // Find relevant SNPs for this biomarker
  const relevantAssociations = BIOMARKER_DNA_ASSOCIATIONS[biomarker.name] || [];
  
  // Check if user has any of the relevant SNPs
  const matchedVariants = relevantAssociations.map(association => {
    const matchedVariant = dnaVariants.find(v => 
      v.rsid.toLowerCase() === association.rsid.toLowerCase()
    );
    
    const isRiskGenotype = matchedVariant && 
      association.riskGenotypes.includes(matchedVariant.genotype);
    
    return {
      ...association,
      userGenotype: matchedVariant?.genotype || 'Unknown',
      isRiskGenotype: !!isRiskGenotype,
      matchedVariant
    };
  });
  
  // Determine if any genetic factors may be contributing to the biomarker value
  const hasGeneticContribution = matchedVariants.some(v => v.isRiskGenotype);
  const isOutOfRange = biomarker.value < biomarker.normalRange.min || biomarker.value > biomarker.normalRange.max;
  
  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg w-full max-w-3xl max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-gray-200">
          <div className="flex items-center">
            <Dna className="w-6 h-6 text-purple-600 mr-3" />
            <div>
              <h2 className="text-xl font-semibold text-gray-900">Genetic Factors for {biomarker.name}</h2>
              <p className="text-sm text-gray-600">
                Current value: {biomarker.value} {biomarker.unit}
                {isOutOfRange ? (
                  <span className="ml-2 text-red-600 font-medium">
                    ({biomarker.value > biomarker.normalRange.max ? 'Above' : 'Below'} normal range)
                  </span>
                ) : (
                  <span className="ml-2 text-green-600 font-medium">
                    (Within normal range)
                  </span>
                )}
              </p>
            </div>
          </div>
          <button 
            onClick={onClose}
            className="text-gray-500 hover:text-gray-700"
          >
            <X className="w-6 h-6" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 space-y-6">
          {/* Summary */}
          <div className={`p-4 rounded-lg border ${
            hasGeneticContribution && isOutOfRange 
              ? 'bg-yellow-50 border-yellow-200' 
              : 'bg-blue-50 border-blue-200'
          }`}>
            <div className="flex items-start">
              {hasGeneticContribution && isOutOfRange ? (
                <AlertCircle className="w-5 h-5 text-yellow-600 mt-0.5 mr-3 flex-shrink-0" />
              ) : (
                <Info className="w-5 h-5 text-blue-600 mt-0.5 mr-3 flex-shrink-0" />
              )}
              <div>
                <h3 className={`text-lg font-medium ${
                  hasGeneticContribution && isOutOfRange ? 'text-yellow-800' : 'text-blue-800'
                }`}>
                  {hasGeneticContribution && isOutOfRange 
                    ? 'Genetic Factors May Be Contributing' 
                    : 'Genetic Analysis Summary'}
                </h3>
                <p className={`mt-1 ${
                  hasGeneticContribution && isOutOfRange ? 'text-yellow-700' : 'text-blue-700'
                }`}>
                  {hasGeneticContribution && isOutOfRange 
                    ? `Your genetic profile shows ${matchedVariants.filter(v => v.isRiskGenotype).length} variant(s) that may influence your ${biomarker.name.toLowerCase()} levels.` 
                    : hasGeneticContribution 
                      ? `You have genetic variants that could affect ${biomarker.name.toLowerCase()} metabolism, but your levels are currently within normal range.`
                      : `No significant genetic factors affecting your ${biomarker.name.toLowerCase()} levels were identified.`}
                </p>
              </div>
            </div>
          </div>

          {/* Genetic Variants */}
          <div>
            <h3 className="text-lg font-medium text-gray-900 mb-4">Relevant Genetic Variants</h3>
            
            {matchedVariants.length > 0 ? (
              <div className="space-y-4">
                {matchedVariants.map((variant, index) => (
                  <div key={index} className={`border rounded-lg p-4 ${
                    variant.isRiskGenotype 
                      ? 'border-yellow-200 bg-yellow-50' 
                      : 'border-gray-200 bg-gray-50'
                  }`}>
                    <div className="flex justify-between items-start">
                      <div>
                        <div className="flex items-center">
                          <h4 className="font-medium text-gray-900">{variant.gene} ({variant.rsid})</h4>
                          {variant.isRiskGenotype && (
                            <span className="ml-2 inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-yellow-100 text-yellow-800">
                              <AlertCircle className="w-3 h-3 mr-1" />
                              Risk Variant
                            </span>
                          )}
                        </div>
                        
                        <div className="mt-2 flex items-center">
                          <span className="text-sm text-gray-700 font-medium">Your genotype:</span>
                          <span className={`ml-2 px-2 py-0.5 rounded text-sm font-mono ${
                            variant.isRiskGenotype 
                              ? 'bg-yellow-100 text-yellow-800' 
                              : 'bg-green-100 text-green-800'
                          }`}>
                            {variant.userGenotype}
                          </span>
                          <span className="ml-2 text-sm text-gray-600">
                            {variant.isRiskGenotype 
                              ? '(Risk genotype)' 
                              : '(Typical genotype)'}
                          </span>
                        </div>
                        
                        <p className="mt-3 text-sm text-gray-700">{variant.effect}</p>
                      </div>
                    </div>
                    
                    {/* Recommendations */}
                    {variant.isRiskGenotype && (
                      <div className="mt-4 bg-white border border-gray-200 rounded-lg p-3">
                        <h5 className="text-sm font-medium text-gray-900 mb-2">What This Means For You</h5>
                        <p className="text-sm text-gray-700">
                          With your {variant.gene} genotype, you may:
                        </p>
                        <ul className="mt-2 space-y-1">
                          {biomarker.name === 'Glucose (Fasting)' && variant.gene === 'TCF7L2' && (
                            <>
                              <li className="text-sm text-gray-700 flex items-start">
                                <span className="w-1.5 h-1.5 bg-gray-500 rounded-full mt-2 mr-2 flex-shrink-0" />
                                Need more frequent monitoring of blood glucose levels
                              </li>
                              <li className="text-sm text-gray-700 flex items-start">
                                <span className="w-1.5 h-1.5 bg-gray-500 rounded-full mt-2 mr-2 flex-shrink-0" />
                                Benefit from a lower carbohydrate diet than the general population
                              </li>
                              <li className="text-sm text-gray-700 flex items-start">
                                <span className="w-1.5 h-1.5 bg-gray-500 rounded-full mt-2 mr-2 flex-shrink-0" />
                                Respond better to certain diabetes medications if needed
                              </li>
                            </>
                          )}
                          {biomarker.name.includes('Cholesterol') && variant.gene === 'APOE' && (
                            <>
                              <li className="text-sm text-gray-700 flex items-start">
                                <span className="w-1.5 h-1.5 bg-gray-500 rounded-full mt-2 mr-2 flex-shrink-0" />
                                Benefit from a diet lower in saturated fats than the general population
                              </li>
                              <li className="text-sm text-gray-700 flex items-start">
                                <span className="w-1.5 h-1.5 bg-gray-500 rounded-full mt-2 mr-2 flex-shrink-0" />
                                Need more aggressive cholesterol monitoring and management
                              </li>
                              <li className="text-sm text-gray-700 flex items-start">
                                <span className="w-1.5 h-1.5 bg-gray-500 rounded-full mt-2 mr-2 flex-shrink-0" />
                                Consider discussing statin therapy with your doctor at lower threshold levels
                              </li>
                            </>
                          )}
                          {biomarker.name === 'Vitamin D' && variant.gene === 'VDR' && (
                            <>
                              <li className="text-sm text-gray-700 flex items-start">
                                <span className="w-1.5 h-1.5 bg-gray-500 rounded-full mt-2 mr-2 flex-shrink-0" />
                                Need higher vitamin D supplementation than average
                              </li>
                              <li className="text-sm text-gray-700 flex items-start">
                                <span className="w-1.5 h-1.5 bg-gray-500 rounded-full mt-2 mr-2 flex-shrink-0" />
                                Benefit from more frequent vitamin D level monitoring
                              </li>
                              <li className="text-sm text-gray-700 flex items-start">
                                <span className="w-1.5 h-1.5 bg-gray-500 rounded-full mt-2 mr-2 flex-shrink-0" />
                                Consider earlier bone density screening
                              </li>
                            </>
                          )}
                          {biomarker.name === 'Homocysteine' && variant.gene === 'MTHFR' && (
                            <>
                              <li className="text-sm text-gray-700 flex items-start">
                                <span className="w-1.5 h-1.5 bg-gray-500 rounded-full mt-2 mr-2 flex-shrink-0" />
                                Benefit from methylfolate rather than folic acid supplements
                              </li>
                              <li className="text-sm text-gray-700 flex items-start">
                                <span className="w-1.5 h-1.5 bg-gray-500 rounded-full mt-2 mr-2 flex-shrink-0" />
                                Need higher B-vitamin intake than the general population
                              </li>
                              <li className="text-sm text-gray-700 flex items-start">
                                <span className="w-1.5 h-1.5 bg-gray-500 rounded-full mt-2 mr-2 flex-shrink-0" />
                                Consider more frequent homocysteine monitoring
                              </li>
                            </>
                          )}
                          {!biomarker.name.match(/Glucose|Cholesterol|Vitamin D|Homocysteine/) && (
                            <li className="text-sm text-gray-700 flex items-start">
                              <span className="w-1.5 h-1.5 bg-gray-500 rounded-full mt-2 mr-2 flex-shrink-0" />
                              Consider more frequent monitoring of this biomarker
                            </li>
                          )}
                        </ul>
                      </div>
                    )}
                    
                    {/* Insurance Coverage */}
                    {variant.isRiskGenotype && (
                      <div className="mt-3 flex justify-end">
                        <button className="flex items-center text-sm text-blue-600 hover:text-blue-800">
                          <Shield className="w-4 h-4 mr-1" />
                          Check Insurance Coverage
                        </button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-center py-8 bg-gray-50 rounded-lg border border-gray-200">
                <Dna className="w-12 h-12 mx-auto mb-4 text-gray-300" />
                <p className="text-gray-600">No known genetic variants affecting this biomarker were found in your DNA data.</p>
                <p className="text-sm text-gray-500 mt-2">This doesn't mean genetic factors aren't involved, just that we didn't detect common variants.</p>
              </div>
            )}
          </div>
          
          {/* Personalized Recommendations */}
          {hasGeneticContribution && (
            <div>
              <h3 className="text-lg font-medium text-gray-900 mb-4">Personalized Recommendations</h3>
              
              <div className="space-y-4">
                {biomarker.name === 'Glucose (Fasting)' && (
                  <>
                    <div className="bg-white border border-gray-200 rounded-lg p-4">
                      <div className="flex items-start">
                        <div className="p-2 rounded-full bg-green-100 text-green-600 mr-3">
                          <CheckCircle className="w-5 h-5" />
                        </div>
                        <div>
                          <h4 className="font-medium text-gray-900">Genetic Nutrition Plan</h4>
                          <p className="text-sm text-gray-700 mt-1">
                            Based on your TCF7L2 genotype, you may benefit from a lower carbohydrate diet than the general population. 
                            Consider a nutrition plan that emphasizes protein, healthy fats, and complex carbohydrates.
                          </p>
                          <div className="mt-3 flex justify-end">
                            <button className="px-3 py-1.5 bg-green-600 text-white rounded-md hover:bg-green-700 text-sm flex items-center">
                              <ExternalLink className="w-4 h-4 mr-1.5" />
                              Get Personalized Plan
                            </button>
                          </div>
                        </div>
                      </div>
                    </div>
                    
                    <div className="bg-white border border-gray-200 rounded-lg p-4">
                      <div className="flex items-start">
                        <div className="p-2 rounded-full bg-blue-100 text-blue-600 mr-3">
                          <Shield className="w-5 h-5" />
                        </div>
                        <div>
                          <h4 className="font-medium text-gray-900">Enhanced Monitoring</h4>
                          <p className="text-sm text-gray-700 mt-1">
                            With your genetic profile, more frequent glucose monitoring is recommended. 
                            Consider checking your fasting glucose every 3-6 months rather than annually.
                          </p>
                          <div className="mt-3 flex justify-end">
                            <button className="px-3 py-1.5 bg-blue-600 text-white rounded-md hover:bg-blue-700 text-sm flex items-center">
                              <ExternalLink className="w-4 h-4 mr-1.5" />
                              Schedule Testing
                            </button>
                          </div>
                        </div>
                      </div>
                    </div>
                  </>
                )}
                
                {biomarker.name.includes('Cholesterol') && (
                  <>
                    <div className="bg-white border border-gray-200 rounded-lg p-4">
                      <div className="flex items-start">
                        <div className="p-2 rounded-full bg-green-100 text-green-600 mr-3">
                          <CheckCircle className="w-5 h-5" />
                        </div>
                        <div>
                          <h4 className="font-medium text-gray-900">APOE-Specific Diet Plan</h4>
                          <p className="text-sm text-gray-700 mt-1">
                            Your APOE genotype suggests you may be more sensitive to dietary fats than the average person.
                            A Mediterranean diet with emphasis on plant sterols and omega-3 fatty acids may be particularly beneficial.
                          </p>
                          <div className="mt-3 flex justify-end">
                            <button className="px-3 py-1.5 bg-green-600 text-white rounded-md hover:bg-green-700 text-sm flex items-center">
                              <ExternalLink className="w-4 h-4 mr-1.5" />
                              Get Personalized Plan
                            </button>
                          </div>
                        </div>
                      </div>
                    </div>
                    
                    <div className="bg-white border border-gray-200 rounded-lg p-4">
                      <div className="flex items-start">
                        <div className="p-2 rounded-full bg-blue-100 text-blue-600 mr-3">
                          <Shield className="w-5 h-5" />
                        </div>
                        <div>
                          <h4 className="font-medium text-gray-900">Specialized Lipid Management</h4>
                          <p className="text-sm text-gray-700 mt-1">
                            With your genetic profile, you may benefit from specialized lipid management strategies.
                            Consider consulting with a lipid specialist who can tailor treatment to your genetic factors.
                          </p>
                          <div className="mt-3 flex justify-end">
                            <button className="px-3 py-1.5 bg-blue-600 text-white rounded-md hover:bg-blue-700 text-sm flex items-center">
                              <ExternalLink className="w-4 h-4 mr-1.5" />
                              Find Specialists
                            </button>
                          </div>
                        </div>
                      </div>
                    </div>
                  </>
                )}
                
                {biomarker.name === 'Vitamin D' && (
                  <div className="bg-white border border-gray-200 rounded-lg p-4">
                    <div className="flex items-start">
                      <div className="p-2 rounded-full bg-green-100 text-green-600 mr-3">
                        <CheckCircle className="w-5 h-5" />
                      </div>
                      <div>
                        <h4 className="font-medium text-gray-900">Personalized Vitamin D Protocol</h4>
                        <p className="text-sm text-gray-700 mt-1">
                          Your VDR genotype suggests you may need higher vitamin D supplementation than average.
                          Consider a personalized supplementation protocol and more frequent monitoring.
                        </p>
                        <div className="mt-3 flex justify-end">
                          <button className="px-3 py-1.5 bg-green-600 text-white rounded-md hover:bg-green-700 text-sm flex items-center">
                            <ExternalLink className="w-4 h-4 mr-1.5" />
                            Get Personalized Protocol
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                )}
                
                {biomarker.name === 'Homocysteine' && (
                  <div className="bg-white border border-gray-200 rounded-lg p-4">
                    <div className="flex items-start">
                      <div className="p-2 rounded-full bg-green-100 text-green-600 mr-3">
                        <CheckCircle className="w-5 h-5" />
                      </div>
                      <div>
                        <h4 className="font-medium text-gray-900">MTHFR-Optimized Nutrition Plan</h4>
                        <p className="text-sm text-gray-700 mt-1">
                          With your MTHFR genotype, you may benefit from methylfolate instead of folic acid,
                          along with optimized B-vitamin intake to support proper homocysteine metabolism.
                        </p>
                        <div className="mt-3 flex justify-end">
                          <button className="px-3 py-1.5 bg-green-600 text-white rounded-md hover:bg-green-700 text-sm flex items-center">
                            <ExternalLink className="w-4 h-4 mr-1.5" />
                            Get Personalized Plan
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                )}
                
                {!biomarker.name.match(/Glucose|Cholesterol|Vitamin D|Homocysteine/) && (
                  <div className="bg-white border border-gray-200 rounded-lg p-4">
                    <div className="flex items-start">
                      <div className="p-2 rounded-full bg-blue-100 text-blue-600 mr-3">
                        <Info className="w-5 h-5" />
                      </div>
                      <div>
                        <h4 className="font-medium text-gray-900">Personalized Monitoring Plan</h4>
                        <p className="text-sm text-gray-700 mt-1">
                          Based on your genetic profile, we recommend more frequent monitoring of this biomarker.
                          Consider discussing a personalized testing schedule with your healthcare provider.
                        </p>
                        <div className="mt-3 flex justify-end">
                          <button className="px-3 py-1.5 bg-blue-600 text-white rounded-md hover:bg-blue-700 text-sm flex items-center">
                            <ExternalLink className="w-4 h-4 mr-1.5" />
                            Schedule Testing
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}
          
          {/* Disclaimer */}
          <div className="bg-gray-50 border border-gray-200 rounded-lg p-4 text-sm text-gray-600">
            <p className="font-medium mb-2">Important Health Information</p>
            <p>
              Genetic information should be considered alongside other health factors and is not deterministic. 
              The associations between genetic variants and biomarkers are based on current research and may evolve as new studies emerge.
              Always consult with healthcare professionals before making medical decisions based on genetic data.
            </p>
          </div>
        </div>

        {/* Footer */}
        <div className="border-t border-gray-200 p-4 bg-gray-50">
          <div className="flex justify-end">
            <button
              onClick={onClose}
              className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 transition-colors"
            >
              Close
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}