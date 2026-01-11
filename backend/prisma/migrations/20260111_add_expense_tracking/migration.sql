-- Create expense tracking tables for cost optimization feature

-- Projected/planned expenses (what user expects to spend)
CREATE TABLE expense_projections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  plan_id UUID NOT NULL REFERENCES insurance_plans(id) ON DELETE CASCADE,
  service_type TEXT NOT NULL,
  estimated_cost DECIMAL(10,2) NOT NULL,
  frequency_per_year INTEGER NOT NULL DEFAULT 1,
  is_in_network BOOLEAN NOT NULL DEFAULT true,
  notes TEXT,
  projection_date DATE NOT NULL DEFAULT CURRENT_DATE,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- Actual expenses (claims, EOBs, real spending)
CREATE TABLE expense_actuals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  plan_id UUID NOT NULL REFERENCES insurance_plans(id) ON DELETE CASCADE,
  projection_id UUID REFERENCES expense_projections(id) ON DELETE SET NULL,
  service_type TEXT NOT NULL,
  provider_name TEXT,
  date_of_service DATE,
  billed_amount DECIMAL(10,2),
  insurance_paid DECIMAL(10,2),
  patient_paid DECIMAL(10,2),
  applied_to_deductible DECIMAL(10,2),
  applied_to_oop DECIMAL(10,2),
  claim_status TEXT DEFAULT 'processed',
  is_in_network BOOLEAN DEFAULT true,
  notes TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- AI cost analyses (Claude's recommendations)
CREATE TABLE cost_analyses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  plan_id UUID NOT NULL REFERENCES insurance_plans(id) ON DELETE CASCADE,
  analysis_date TIMESTAMP NOT NULL DEFAULT NOW(),
  claude_response TEXT NOT NULL,
  total_projected_oop DECIMAL(10,2),
  deductible_met_month INTEGER,
  projected_expenses_snapshot JSONB,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- Add indexes for common queries
CREATE INDEX idx_expense_projections_user_plan ON expense_projections(user_id, plan_id);
CREATE INDEX idx_expense_projections_created ON expense_projections(created_at DESC);
CREATE INDEX idx_expense_actuals_user_plan ON expense_actuals(user_id, plan_id);
CREATE INDEX idx_expense_actuals_date ON expense_actuals(date_of_service DESC);
CREATE INDEX idx_cost_analyses_user_plan ON cost_analyses(user_id, plan_id);
CREATE INDEX idx_cost_analyses_date ON cost_analyses(analysis_date DESC);

-- Row-Level Security policies
ALTER TABLE expense_projections ENABLE ROW LEVEL SECURITY;
ALTER TABLE expense_actuals ENABLE ROW LEVEL SECURITY;
ALTER TABLE cost_analyses ENABLE ROW LEVEL SECURITY;

-- expense_projections RLS policies
CREATE POLICY expense_projections_user_policy ON expense_projections
  FOR ALL
  USING (
    CASE
      WHEN current_setting('app.is_admin', true)::boolean = true THEN true
      ELSE user_id::text = current_setting('app.current_user_id', true)
    END
  )
  WITH CHECK (
    CASE
      WHEN current_setting('app.is_admin', true)::boolean = true THEN true
      ELSE user_id::text = current_setting('app.current_user_id', true)
    END
  );

-- expense_actuals RLS policies
CREATE POLICY expense_actuals_user_policy ON expense_actuals
  FOR ALL
  USING (
    CASE
      WHEN current_setting('app.is_admin', true)::boolean = true THEN true
      ELSE user_id::text = current_setting('app.current_user_id', true)
    END
  )
  WITH CHECK (
    CASE
      WHEN current_setting('app.is_admin', true)::boolean = true THEN true
      ELSE user_id::text = current_setting('app.current_user_id', true)
    END
  );

-- cost_analyses RLS policies
CREATE POLICY cost_analyses_user_policy ON cost_analyses
  FOR ALL
  USING (
    CASE
      WHEN current_setting('app.is_admin', true)::boolean = true THEN true
      ELSE user_id::text = current_setting('app.current_user_id', true)
    END
  )
  WITH CHECK (
    CASE
      WHEN current_setting('app.is_admin', true)::boolean = true THEN true
      ELSE user_id::text = current_setting('app.current_user_id', true)
    END
  );

-- Add comments for documentation
COMMENT ON TABLE expense_projections IS 'Projected medical expenses for cost optimization planning';
COMMENT ON TABLE expense_actuals IS 'Actual medical expenses from EOBs and claims';
COMMENT ON TABLE cost_analyses IS 'AI-generated cost optimization analyses';
COMMENT ON COLUMN expense_projections.service_type IS 'Encrypted - Type of medical service';
COMMENT ON COLUMN expense_projections.estimated_cost IS 'Encrypted - Estimated cost per occurrence';
COMMENT ON COLUMN expense_projections.notes IS 'Encrypted - User notes about the expense';
COMMENT ON COLUMN expense_actuals.service_type IS 'Encrypted - Type of medical service from claim';
COMMENT ON COLUMN expense_actuals.provider_name IS 'Encrypted - Healthcare provider name';
COMMENT ON COLUMN expense_actuals.billed_amount IS 'Encrypted - Total amount billed by provider';
COMMENT ON COLUMN expense_actuals.insurance_paid IS 'Encrypted - Amount insurance paid';
COMMENT ON COLUMN expense_actuals.patient_paid IS 'Encrypted - Amount patient paid out of pocket';
COMMENT ON COLUMN expense_actuals.applied_to_deductible IS 'Encrypted - Amount applied to deductible';
COMMENT ON COLUMN expense_actuals.applied_to_oop IS 'Encrypted - Amount applied to out-of-pocket maximum';
COMMENT ON COLUMN expense_actuals.notes IS 'Encrypted - User notes about the claim';
COMMENT ON COLUMN cost_analyses.claude_response IS 'Encrypted - Full AI-generated analysis in markdown';
COMMENT ON COLUMN cost_analyses.total_projected_oop IS 'Encrypted - Total projected out-of-pocket cost';
COMMENT ON COLUMN cost_analyses.projected_expenses_snapshot IS 'Encrypted - JSON snapshot of expenses analyzed';
