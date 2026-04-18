/**
 * Health Knowledge Store
 *
 * Curated clinical reference documents that get injected into the AI
 * Health Guide system prompt via the retrieval service. Content is
 * Claude-facing (not user-facing) — Claude synthesizes it into plain
 * language. Sources: AHA/ACC, ADA, KDIGO, AACE, USPSTF, ATA.
 *
 * All documents are EDUCATIONAL — never diagnostic. Thresholds come
 * from current clinical guidelines. Keep each under ~500 tokens.
 */

import type { KnowledgeDocument } from './types.js';

const LIPIDS: KnowledgeDocument = {
  id: 'health-lipids',
  domain: 'health',
  category: 'lipids',
  title: 'Lipid Panel Interpretation Guide',
  keywords: [
    'cholesterol',
    'ldl',
    'hdl',
    'triglycerides',
    'lipids',
    'lipid',
    'heart',
    'cardiovascular',
    'statin',
    'atherosclerosis',
  ],
  relevantBiomarkers: [
    'Total Cholesterol',
    'Cholesterol, Total',
    'LDL Cholesterol',
    'HDL Cholesterol',
    'Triglycerides',
    'VLDL Cholesterol',
    'Non-HDL Cholesterol',
  ],
  tokenEstimate: 420,
  source: 'system',
  content: `## Lipid panel reference (AHA/ACC)

### Thresholds
- LDL: <100 optimal; <70 for high-risk (prior CVD, diabetes, ASCVD ≥20%).
- HDL: >60 protective; <40 (men) / <50 (women) is a risk factor.
- Triglycerides: <150 normal; 150–199 borderline; 200–499 high; ≥500 very high (pancreatitis risk).
- Total cholesterol: <200 desirable; 200–239 borderline; ≥240 high.
- Non-HDL (Total − HDL): target <130 (or <100 if high-risk). Better CVD predictor than LDL alone.

### Key ratios
- Total/HDL ratio: <5 desirable, <3.5 ideal.
- Triglyceride/HDL ratio: <2 ideal — elevated suggests insulin resistance.

### Common patterns
- High LDL, normal HDL/TG: dietary or genetic hypercholesterolemia. Diet + exercise first; statin if high-risk.
- High TG + low HDL + borderline LDL: metabolic syndrome pattern. Weight loss, exercise, carb reduction.
- Low HDL isolated: exercise, moderate alcohol, omega-3s; genetic component if persistent.
- TG >500: pancreatitis risk; fibrate or omega-3 Rx territory.

### Lifestyle timelines
- Diet (Mediterranean/low-saturated-fat): 5–10% LDL reduction in 6–12 weeks.
- Aerobic exercise 150 min/wk: HDL +5–10% in 8–12 weeks.
- Weight loss 5–10%: TG −20–30%, LDL −5–8%.
- Statins: LDL −30–50% in 4–6 weeks (dose-dependent).

### Retest cadence
- Normal: annually. Abnormal or on therapy: 6–8 weeks after intervention, then every 3–6 months until stable.`,
};

const METABOLIC_DIABETES: KnowledgeDocument = {
  id: 'health-metabolic',
  domain: 'health',
  category: 'metabolic',
  title: 'Metabolic & Glucose Regulation Guide',
  keywords: [
    'glucose',
    'a1c',
    'hba1c',
    'diabetes',
    'prediabetes',
    'insulin',
    'metabolic',
    'blood sugar',
    'sugar',
  ],
  relevantBiomarkers: [
    'Glucose (Fasting)',
    'Fasting Glucose',
    'Glucose',
    'HbA1c',
    'Hemoglobin A1c',
    'Insulin',
    'C-Peptide',
    'Fructosamine',
  ],
  tokenEstimate: 380,
  source: 'system',
  content: `## Metabolic / glucose reference (ADA 2024 Standards of Care)

### Diagnostic thresholds
- Fasting glucose: <100 normal; 100–125 prediabetes; ≥126 (confirmed twice) diabetes.
- HbA1c: <5.7% normal; 5.7–6.4% prediabetes; ≥6.5% diabetes.
- Oral glucose tolerance test (2-hr): <140 normal; 140–199 prediabetes; ≥200 diabetes.
- Random glucose: ≥200 with symptoms = diabetes.

### Targets on therapy
- HbA1c goal: <7.0% (most adults); <6.5% if achievable without hypoglycemia; <8.0% for frail/elderly/limited life expectancy.
- Each 1% A1c reduction ≈ 35% microvascular risk reduction.

### Interpretation patterns
- Elevated fasting + normal A1c: dawn phenomenon or recent onset.
- Normal fasting + elevated A1c: postprandial spikes (test with CGM or 2-hr postprandial).
- High insulin + normal glucose: insulin resistance; earliest metabolic-syndrome signal.
- Low C-peptide + high glucose: insulin-deficient (Type 1 pattern).

### Medication effects
- Metformin: A1c −1–1.5%. Steroids, thiazides, atypical antipsychotics raise glucose.
- SGLT2 inhibitors: A1c −0.5–1%, cardiovascular + renal benefits.
- GLP-1 agonists: A1c −1–1.5%, weight loss.

### Lifestyle
- 5–7% weight loss reduces diabetes progression by ~58% in prediabetes (DPP trial).
- 150 min/wk moderate aerobic + resistance training.
- Low-carb or Mediterranean: similar A1c impact ~ −0.5%.

### Retest
- Prediabetes/normal: annually. On therapy: every 3 months until stable, then every 6 months.`,
};

const CBC_BLOOD: KnowledgeDocument = {
  id: 'health-cbc',
  domain: 'health',
  category: 'blood',
  title: 'Complete Blood Count (CBC) Guide',
  keywords: [
    'cbc',
    'wbc',
    'rbc',
    'hemoglobin',
    'hematocrit',
    'platelets',
    'mcv',
    'anemia',
    'infection',
    'blood count',
  ],
  relevantBiomarkers: [
    'White Blood Cell Count',
    'WBC',
    'Red Blood Cell Count',
    'RBC',
    'Hemoglobin',
    'Hematocrit',
    'Platelets',
    'MCV',
    'MCH',
    'MCHC',
    'RDW',
  ],
  tokenEstimate: 400,
  source: 'system',
  content: `## CBC reference

### Normal adult ranges
- WBC: 4.5–11.0 ×10³/µL (higher in children; lower on chemo).
- RBC: 4.7–6.1 (men) / 4.2–5.4 (women) ×10⁶/µL.
- Hemoglobin: 13.5–17.5 (men) / 12.0–15.5 (women) g/dL.
- Hematocrit: 41–53% (men) / 36–46% (women).
- Platelets: 150–400 ×10³/µL.
- MCV: 80–100 fL (mean cell volume — anemia classification driver).

### Anemia classification (by MCV)
- Microcytic (MCV <80): iron deficiency, thalassemia, chronic disease.
- Normocytic (MCV 80–100): acute blood loss, kidney disease (low EPO), chronic disease.
- Macrocytic (MCV >100): B12/folate deficiency, alcohol, hypothyroidism, MDS.

### WBC patterns
- Leukocytosis (>11k): infection (bacterial > viral), inflammation, stress, steroids.
- Leukopenia (<4.5k): viral infection, autoimmune, bone marrow suppression, chemo.
- Neutrophilia: bacterial infection or inflammation.
- Lymphocytosis: viral infection, CLL if persistent.
- Eosinophilia (>500): allergies, parasites, drug reaction.

### Platelet patterns
- Thrombocytopenia (<150k): ITP, sepsis, heparin, liver disease; bleeding risk <50k, critical <20k.
- Thrombocytosis (>450k): inflammation (reactive) vs myeloproliferative; clot risk if >1000k.

### Retest
- Asymptomatic abnormality: repeat in 2–4 weeks to confirm trend. Anemia + symptoms or marked platelet derangement: workup now.`,
};

const THYROID: KnowledgeDocument = {
  id: 'health-thyroid',
  domain: 'health',
  category: 'thyroid',
  title: 'Thyroid Function Guide',
  keywords: [
    'thyroid',
    'tsh',
    't3',
    't4',
    'hypothyroid',
    'hyperthyroid',
    'levothyroxine',
    'synthroid',
    'hashimoto',
    'graves',
  ],
  relevantBiomarkers: [
    'TSH',
    'Free T4',
    'Free T3',
    'Total T3',
    'Total T4',
    'Thyroid Peroxidase Antibodies',
    'TPO Antibodies',
    'Thyroglobulin Antibodies',
  ],
  tokenEstimate: 370,
  source: 'system',
  content: `## Thyroid reference (ATA guidelines)

### TSH (most sensitive screening test)
- Normal: 0.4–4.0 mIU/L (lab-dependent; 0.5–2.5 considered "optimal" by some; not yet consensus).
- Age-adjusted: upper limit rises with age (~4.5 at 70+).
- Trimester-specific in pregnancy: <2.5 first trimester, <3.0 after.

### Patterns
- High TSH + low Free T4: primary hypothyroidism. Start levothyroxine 1.6 µg/kg/day.
- High TSH + normal Free T4: subclinical hypothyroidism. Treat if TSH >10, symptomatic, pregnant, or TPO+.
- Low TSH + high Free T4/T3: primary hyperthyroidism. Workup for Graves/toxic nodule.
- Low TSH + normal Free T4: subclinical hyperthyroidism. Watch for progression; treat if AFib/osteoporosis risk.
- Low TSH + low Free T4: central (pituitary) hypothyroidism — uncommon but check pituitary workup.

### Antibodies
- TPO antibodies: Hashimoto's (hypothyroid pattern).
- Thyroglobulin antibodies: less specific, can coexist.
- TSI / TRAb: Graves' disease (hyperthyroid).

### Medication interactions
- Levothyroxine absorption reduced by: calcium, iron, PPIs, coffee (space 4 hr).
- Amiodarone, lithium, interferon: can induce hypo- or hyperthyroidism.
- Biotin supplements: falsely distort TSH/T4 assays (hold 48 hr before draw).

### Retest cadence
- On levothyroxine: 6–8 weeks after any dose change, then annually when stable.
- Subclinical hypothyroid observation: every 6–12 months.`,
};

const LIVER: KnowledgeDocument = {
  id: 'health-liver',
  domain: 'health',
  category: 'liver',
  title: 'Liver Function Guide',
  keywords: [
    'liver',
    'alt',
    'ast',
    'alp',
    'alkaline phosphatase',
    'bilirubin',
    'albumin',
    'hepatitis',
    'fatty liver',
    'nafld',
  ],
  relevantBiomarkers: [
    'ALT',
    'AST',
    'Alkaline Phosphatase',
    'ALP',
    'Total Bilirubin',
    'Direct Bilirubin',
    'Albumin',
    'Total Protein',
    'GGT',
  ],
  tokenEstimate: 400,
  source: 'system',
  content: `## Liver function reference (AASLD)

### Normal ranges
- ALT: 7–56 U/L. Most sensitive hepatocellular injury marker.
- AST: 10–40 U/L. Also in heart, muscle.
- Alkaline phosphatase: 44–147 U/L. Higher in children (bone), pregnancy.
- Total bilirubin: 0.1–1.2 mg/dL.
- Albumin: 3.5–5.0 g/dL.
- GGT: <50 (men) / <35 (women) U/L. Alcohol + biliary marker.

### Patterns
- ALT ≈ AST, both mildly elevated (<5× ULN): NAFLD (most common), meds, viral hepatitis.
- AST > ALT (ratio >2): alcoholic liver disease. GGT usually also elevated.
- ALT/AST markedly elevated (>10× ULN): acute viral hepatitis, drug-induced (acetaminophen), ischemic hepatitis.
- Isolated ALP elevation: bone disease (kids, Paget's, healing fx) or biliary (GGT also elevated confirms biliary).
- ALP + GGT + bilirubin elevated: cholestasis (stones, PBC, drug).
- Low albumin + high INR: advanced liver synthetic dysfunction.

### Medication hepatotoxicity (common)
- Statins: mild ALT rise in 1–3%; rarely clinically significant; continue unless >3× ULN.
- Acetaminophen: dose-dependent; >4 g/day risk with alcohol/fasting.
- Methotrexate, amiodarone, valproate, isoniazid: monitor LFTs.
- Herbal/supplements: kava, green tea extract, anabolic steroids.

### NAFLD-specific
- Affects ~25% of US adults. Diagnosis: ALT elevation + imaging showing steatosis, after ruling out alcohol/viral.
- First-line: 7–10% weight loss reverses early disease.
- FIB-4 score combines age, AST, ALT, platelets — <1.3 excludes advanced fibrosis.

### Retest
- Mildly abnormal + asymptomatic: repeat in 4–12 weeks. >3× ULN or symptomatic: workup now.`,
};

const KIDNEY: KnowledgeDocument = {
  id: 'health-kidney',
  domain: 'health',
  category: 'kidney',
  title: 'Kidney Function Guide',
  keywords: [
    'kidney',
    'renal',
    'creatinine',
    'bun',
    'egfr',
    'gfr',
    'ckd',
    'hydration',
    'protein urine',
  ],
  relevantBiomarkers: [
    'Creatinine',
    'BUN',
    'eGFR',
    'GFR',
    'Blood Urea Nitrogen',
    'BUN/Creatinine Ratio',
    'Cystatin C',
    'Albumin/Creatinine Ratio',
  ],
  tokenEstimate: 400,
  source: 'system',
  content: `## Kidney function reference (KDIGO 2024)

### CKD staging (by eGFR, mL/min/1.73m²)
- G1: ≥90 with kidney damage markers (proteinuria, etc.).
- G2: 60–89 with damage markers.
- G3a: 45–59 mild-moderate CKD.
- G3b: 30–44 moderate-severe CKD.
- G4: 15–29 severe CKD.
- G5: <15 kidney failure (dialysis candidate).

Diagnose CKD only if abnormalities persist ≥3 months — a single reading can reflect acute, reversible causes.

### BUN/Creatinine ratio
- Normal: 10–20.
- >20: prerenal (dehydration, heart failure, GI bleed).
- <10: intrinsic renal disease, low protein intake, liver disease.

### Albumin/Creatinine ratio (urine)
- <30 mg/g normal.
- 30–300 mg/g moderately increased (microalbuminuria) — early CKD marker, especially in diabetes/HTN.
- >300 mg/g severely increased.

### 2021 CKD-EPI update
- Race coefficient removed. Cystatin C-based eGFR preferred for borderline cases.
- eGFR trends more informative than single values — look at 1-year trajectory.

### Medication adjustments (common at eGFR <60)
- Metformin: reduce dose at <45, stop at <30.
- NSAIDs: avoid; accelerate CKD.
- Contrast dye: IV hydration + hold nephrotoxins; cystatin C-based risk estimate better than creatinine.
- ACEi/ARB: expected 10–20% creatinine rise; tolerate unless >30% or hyperkalemia.

### Lifestyle
- Hydration: 2–3 L/day unless fluid-restricted.
- BP target: <130/80 (SPRINT trial) — slows CKD progression.
- Sodium <2.3 g/day; protein 0.8 g/kg/day if CKD G3+.

### Retest
- Stable CKD G3: every 6 months. Declining or G4+: every 3 months.`,
};

const ELECTROLYTES: KnowledgeDocument = {
  id: 'health-electrolytes',
  domain: 'health',
  category: 'electrolytes',
  title: 'Electrolyte Panel Guide',
  keywords: [
    'sodium',
    'potassium',
    'chloride',
    'calcium',
    'magnesium',
    'electrolyte',
    'electrolytes',
    'dehydration',
  ],
  relevantBiomarkers: [
    'Sodium',
    'Potassium',
    'Chloride',
    'Bicarbonate',
    'CO2',
    'Calcium',
    'Total Calcium',
    'Ionized Calcium',
    'Magnesium',
    'Phosphorus',
  ],
  tokenEstimate: 370,
  source: 'system',
  content: `## Electrolyte reference

### Normal ranges
- Sodium: 135–145 mEq/L.
- Potassium: 3.5–5.0 mEq/L.
- Chloride: 98–107 mEq/L.
- CO2/bicarbonate: 22–29 mEq/L.
- Calcium (total): 8.5–10.5 mg/dL. Correct for albumin (+0.8 mg/dL per 1.0 g/dL albumin below 4).
- Magnesium: 1.7–2.2 mg/dL.
- Phosphorus: 2.5–4.5 mg/dL.

### Critical values (prompt same-day care)
- Sodium <125 or >155.
- Potassium <3.0 or >6.0.
- Calcium (corrected) <7.5 or >12.

### Sodium patterns
- Hyponatremia: SIADH (check urine osm), diuretics, heart failure, excessive water intake. Correct slowly (<8 mEq/L/24h) to avoid osmotic demyelination.
- Hypernatremia: dehydration (most common), diabetes insipidus, diuretics.

### Potassium patterns
- Hypokalemia: diuretics, GI losses, insulin, alkalosis. Replace K + check Mg (low Mg blocks K correction).
- Hyperkalemia: CKD, ACEi/ARB, spironolactone, acidosis, rhabdomyolysis. ECG changes at >6.5 — urgent.

### Calcium patterns
- Hypercalcemia: primary hyperparathyroidism, malignancy, vitamin D toxicity, thiazides.
- Hypocalcemia: vitamin D deficiency, CKD, hypoparathyroidism, alkalosis (ionized drops).

### Medication effects
- Loop diuretics: low K, low Na, low Mg.
- Thiazides: low K, low Na, high Ca.
- ACEi/ARB/spironolactone: high K.
- PPIs (long-term): low Mg.

### Retest
- Dehydration-related: after rehydration (24–48 hr). On diuretics: at baseline, 1–2 weeks after start, then every 6–12 months.`,
};

const VITAMINS: KnowledgeDocument = {
  id: 'health-vitamins',
  domain: 'health',
  category: 'vitamins',
  title: 'Vitamin & Iron Studies Guide',
  keywords: [
    'vitamin',
    'vitamin d',
    'b12',
    'folate',
    'iron',
    'ferritin',
    'deficiency',
    'supplement',
  ],
  relevantBiomarkers: [
    'Vitamin D',
    '25-Hydroxyvitamin D',
    'Vitamin B12',
    'Folate',
    'Iron',
    'Ferritin',
    'TIBC',
    'Transferrin Saturation',
  ],
  tokenEstimate: 380,
  source: 'system',
  content: `## Vitamin & iron reference

### Vitamin D (25-OH)
- <20 ng/mL deficiency; 20–29 insufficiency; 30–80 sufficient; >100 monitor for toxicity.
- Repletion: 50,000 IU weekly × 8 weeks, then 1,000–2,000 IU/day maintenance.
- Symptoms of deficiency: fatigue, bone pain, muscle weakness, depression.
- Malabsorption (celiac, bariatric surgery) + dark skin + limited sun = high deficiency risk.

### Vitamin B12
- Normal: 200–900 pg/mL. Borderline 200–400 may still be deficient — check methylmalonic acid.
- Deficiency causes: vegan diet, metformin, PPIs (>2 years), pernicious anemia, ileal resection.
- Symptoms: macrocytic anemia, peripheral neuropathy, cognitive decline — neuro changes can be irreversible.
- Repletion: 1000 µg IM weekly × 4 weeks, then monthly. Or high-dose oral 1000–2000 µg/day.

### Folate
- Normal: 2.7–17.0 ng/mL.
- Deficiency: poor diet, alcohol use, malabsorption, pregnancy (increased need).
- Always confirm B12 is sufficient before repleting folate — folate masks B12 anemia but not neuropathy.

### Iron studies interpretation
- Ferritin <30 ng/mL: iron deficiency (highly specific, even without anemia).
- Ferritin >300 (men) / >200 (women): iron overload, inflammation (acute-phase reactant — caution).
- Transferrin saturation <20%: iron-deficient erythropoiesis.
- TSAT >45%: hemochromatosis screen.

### Repletion
- Oral iron: 65 mg elemental every other day (better absorption than daily).
- IV iron: for malabsorption, severe deficiency, intolerance.
- Retake labs 8–12 weeks after starting therapy.

### Common medication effects
- Metformin: B12 absorption (check annually after 2+ years).
- PPIs: B12 + iron absorption; magnesium.
- Anticonvulsants (phenytoin, phenobarbital): vitamin D metabolism.`,
};

const INFLAMMATION: KnowledgeDocument = {
  id: 'health-inflammation',
  domain: 'health',
  category: 'inflammation',
  title: 'Inflammation Markers Guide',
  keywords: [
    'inflammation',
    'crp',
    'esr',
    'sed rate',
    'homocysteine',
    'c-reactive protein',
    'inflammatory',
  ],
  relevantBiomarkers: [
    'CRP',
    'C-Reactive Protein',
    'hs-CRP',
    'ESR',
    'Sedimentation Rate',
    'Homocysteine',
    'Fibrinogen',
  ],
  tokenEstimate: 320,
  source: 'system',
  content: `## Inflammation markers reference

### hs-CRP (cardiovascular risk — AHA)
- <1.0 mg/L: low CVD risk.
- 1.0–3.0: average risk.
- >3.0: high CVD risk (independent of LDL).
- >10: acute infection/inflammation — retest in 2 weeks after resolution.

### Standard CRP (acute inflammation)
- <10 mg/L: no significant inflammation.
- 10–40: mild-moderate (viral, mild tissue injury).
- >40: bacterial infection, flare of inflammatory disease.
- >200: severe bacterial infection, major trauma.

### ESR (erythrocyte sedimentation rate)
- Age-adjusted upper limit: age/2 (men); (age+10)/2 (women).
- Slower to rise and fall than CRP — better for chronic conditions (RA, PMR, temporal arteritis).
- Persistent elevation: chronic inflammation, malignancy, autoimmune disease.

### Homocysteine
- Normal: 4–15 µmol/L.
- Elevated: B12/folate deficiency, genetic (MTHFR), CKD, hypothyroidism.
- Independent CVD risk factor — B12/folate repletion lowers it, but CV outcome benefit is mixed.

### Patterns
- CRP high + ESR normal: acute process (infection, acute injury).
- CRP normal + ESR high: chronic inflammation or paraprotein (age-related).
- Both high + anemia of chronic disease picture: active autoimmune/malignancy workup.

### Retest
- Acute infection: 2–4 weeks after resolution to confirm return to baseline.
- CVD risk screening with hs-CRP: every 2 years if borderline; after lifestyle intervention 3 months.
- Autoimmune monitoring: every 3 months when active, every 6–12 months when stable.`,
};

const HORMONES: KnowledgeDocument = {
  id: 'health-hormones',
  domain: 'health',
  category: 'hormones',
  title: 'Hormone Panel Guide',
  keywords: [
    'testosterone',
    'estradiol',
    'estrogen',
    'progesterone',
    'cortisol',
    'dhea',
    'hormone',
    'hormones',
    'endocrine',
  ],
  relevantBiomarkers: [
    'Testosterone (Total)',
    'Testosterone',
    'Free Testosterone',
    'Estradiol',
    'Progesterone',
    'Cortisol',
    'DHEA',
    'DHEA-S',
    'SHBG',
    'FSH',
    'LH',
  ],
  tokenEstimate: 400,
  source: 'system',
  content: `## Hormones reference (Endocrine Society)

### Testosterone (men)
- Total: 300–1000 ng/dL (lab + age dependent; younger men trend higher).
- Free: 5–21 ng/dL.
- Diurnal: peaks 8 AM; draw before 10 AM and at least two occasions before diagnosing hypogonadism.
- Low T symptoms: low libido, fatigue, mood, decreased morning erections, loss of muscle mass.
- Before testosterone Rx: rule out pituitary cause (LH, FSH, prolactin), check PSA + hematocrit.

### Estradiol (women, pre-menopause)
- Varies by cycle phase: follicular 20–150, ovulation peak 200–400, luteal 50–300 pg/mL.
- Postmenopause: <30 pg/mL.
- Elevated in premenopausal women on COC, pregnancy, certain ovarian tumors.

### Cortisol
- Morning (8 AM): 5–25 µg/dL. Evening: <10.
- Diurnal rhythm blunted in Cushing's, depression, shift work.
- Screening tests: 24-hr urine free cortisol, late-night salivary cortisol, 1 mg dexamethasone suppression.
- Low morning + low ACTH: adrenal insufficiency — medical urgency.

### DHEA-S
- Age-adjusted. Peaks 20s, declines ~2% per year.
- Low in adrenal insufficiency, chronic illness, aging.
- High in PCOS, adrenal tumor.

### FSH / LH / SHBG
- FSH >25 in postmenopausal women.
- LH/FSH ratio >2 suggestive of PCOS.
- SHBG binds testosterone and estradiol. High SHBG reduces bioavailable T.

### Medication effects
- Opioids, glucocorticoids, ketoconazole: suppress testosterone.
- Exogenous steroids: suppress endogenous cortisol (do not stop abruptly).
- OCPs increase SHBG — total T looks high, free T may be low.

### Retest
- Start/adjust T therapy: 3–6 months, then annually with PSA + hematocrit.
- Menstrual tracking for hormone disorders: cycle day 3 AM draw (pre-menopause).`,
};

const CARDIAC: KnowledgeDocument = {
  id: 'health-cardiac',
  domain: 'health',
  category: 'cardiac',
  title: 'Cardiac Biomarkers Guide',
  keywords: [
    'cardiac',
    'heart',
    'troponin',
    'bnp',
    'nt-probnp',
    'ck-mb',
    'heart failure',
    'mi',
    'heart attack',
  ],
  relevantBiomarkers: [
    'BNP',
    'NT-proBNP',
    'Troponin I',
    'Troponin T',
    'High-Sensitivity Troponin',
    'CK-MB',
    'CK',
    'Myoglobin',
  ],
  tokenEstimate: 340,
  source: 'system',
  content: `## Cardiac biomarkers reference

### Troponin (MI marker)
- High-sensitivity troponin I or T: <14 ng/L typical upper reference.
- Kinetic change (rise AND fall) over serial draws is more specific than a single elevated value.
- Non-MI causes: sepsis, myocarditis, pulmonary embolism, heart failure, CKD, vigorous exercise.
- Any elevation warrants clinical workup — context matters more than absolute number.

### BNP / NT-proBNP (heart failure markers)
- BNP <100 pg/mL: heart failure unlikely.
- BNP 100–400: intermediate — use clinical judgement.
- BNP >400: heart failure likely.
- NT-proBNP thresholds roughly 4× higher than BNP.
- Age-adjusted: older adults naturally higher. Obesity: falsely low. CKD: falsely high.
- Serial BNP tracks heart failure severity and treatment response.

### CK-MB / Myoglobin
- Mostly replaced by troponin for MI diagnosis.
- CK-MB can distinguish skeletal vs cardiac muscle injury when troponin is ambiguous.
- Elevated CK (total) without CK-MB: rhabdomyolysis, statin myopathy — check renal function.

### Patterns
- Troponin ↑ + dynamic change + symptoms: acute coronary syndrome workup (ECG, echo, cath).
- Troponin ↑ (static) + CKD + no symptoms: chronic troponin leak — track trend.
- BNP ↑ + low ejection fraction: HFrEF. BNP ↑ + preserved EF: HFpEF.

### Important caveats
- Biotin supplements falsely suppress some troponin assays — hold 48 hr before draw.
- Cardiac biomarker trends usually more useful than isolated values.`,
};

const BONE_HEALTH: KnowledgeDocument = {
  id: 'health-bone',
  domain: 'health',
  category: 'bone',
  title: 'Bone Health & Metabolism Guide',
  keywords: [
    'bone',
    'osteoporosis',
    'dexa',
    'calcium',
    'vitamin d',
    'pth',
    'phosphorus',
    'alkaline phosphatase',
    'bone density',
  ],
  relevantBiomarkers: [
    'Calcium',
    'Total Calcium',
    'Ionized Calcium',
    'Vitamin D',
    '25-Hydroxyvitamin D',
    'PTH',
    'Parathyroid Hormone',
    'Phosphorus',
    'Alkaline Phosphatase',
    'ALP',
  ],
  tokenEstimate: 380,
  source: 'system',
  content: `## Bone health reference (NOF/AACE)

### Key biomarkers
- Calcium (corrected for albumin): 8.5–10.5 mg/dL.
- 25-OH Vitamin D: >30 ng/mL sufficient.
- PTH: 15–65 pg/mL.
- Phosphorus: 2.5–4.5 mg/dL. Inverse relationship with calcium.
- ALP: bone-specific form rises with osteoblast activity — high in growth, healing fractures, Paget's, osteomalacia.

### DEXA T-score interpretation
- T-score ≥ −1.0: normal.
- T-score −1.0 to −2.5: osteopenia.
- T-score ≤ −2.5: osteoporosis.
- Z-score (age-matched) used for premenopausal women and men <50.

### FRAX tool
- Calculates 10-year fracture risk using T-score + age + risk factors.
- Treatment threshold: 10-year major osteoporotic fracture risk ≥20% or hip fracture ≥3%.

### Common patterns
- Low Ca + high PTH + low Vit D: secondary hyperparathyroidism from vitamin D deficiency.
- High Ca + high PTH: primary hyperparathyroidism. Confirm with 24-hr urine calcium; parathyroid adenoma likely.
- High Ca + low PTH: malignancy (PTH-related peptide) or granulomatous disease.
- High ALP (isolated) + normal LFTs: bone turnover (Paget's, healing fx, metastases).

### Risk factors for osteoporosis
- Female, postmenopausal, Asian/White ethnicity, low BMI, family history.
- Glucocorticoids >5 mg prednisone daily × 3+ months (huge risk — early DEXA).
- PPIs long-term, aromatase inhibitors, SSRIs, gonadotropin-releasing hormone agonists.
- Smoking, >3 alcoholic drinks/day, vitamin D deficiency.

### Interventions
- Calcium 1000–1200 mg/day (diet preferred over supplements — CVD risk with supplements).
- Vitamin D 800–2000 IU/day.
- Weight-bearing exercise + resistance training.
- Bisphosphonates / denosumab when T-score ≤ −2.5 or fragility fracture.

### Retest
- DEXA: every 2 years if on therapy; every 2–5 years if monitoring.
- Calcium/Vit D/PTH: annually; every 3–6 months when starting therapy.`,
};

export const HEALTH_KNOWLEDGE: KnowledgeDocument[] = [
  LIPIDS,
  METABOLIC_DIABETES,
  CBC_BLOOD,
  THYROID,
  LIVER,
  KIDNEY,
  ELECTROLYTES,
  VITAMINS,
  INFLAMMATION,
  HORMONES,
  CARDIAC,
  BONE_HEALTH,
];
