/*
  # Create user biomarkers table

  1. New Tables
    - `user_biomarkers`
      - `id` (uuid, primary key)
      - `user_id` (uuid, references auth.users)
      - `name` (text)
      - `value` (numeric)
      - `unit` (text)
      - `date` (timestamptz)
      - `category` (text)
      - `normal_range_min` (numeric)
      - `normal_range_max` (numeric)
      - `description` (text)
      - `created_at` (timestamptz)

  2. Security
    - Enable RLS on `user_biomarkers` table
    - Add policies for authenticated users to:
      - Read their own biomarkers
      - Create new biomarkers
      - Update their own biomarkers
*/

CREATE TABLE IF NOT EXISTS user_biomarkers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users NOT NULL,
  name text NOT NULL,
  value numeric NOT NULL,
  unit text NOT NULL,
  date timestamptz NOT NULL,
  category text NOT NULL,
  normal_range_min numeric NOT NULL,
  normal_range_max numeric NOT NULL,
  description text,
  created_at timestamptz DEFAULT now(),
  
  CONSTRAINT fk_user
    FOREIGN KEY(user_id)
    REFERENCES auth.users(id)
    ON DELETE CASCADE
);

ALTER TABLE user_biomarkers ENABLE ROW LEVEL SECURITY;

-- Allow users to read their own biomarkers
CREATE POLICY "Users can read own biomarkers"
  ON user_biomarkers
  FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

-- Allow users to insert their own biomarkers
CREATE POLICY "Users can create biomarkers"
  ON user_biomarkers
  FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

-- Allow users to update their own biomarkers
CREATE POLICY "Users can update own biomarkers"
  ON user_biomarkers
  FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Create indexes for better query performance
CREATE INDEX IF NOT EXISTS idx_user_biomarkers_user_id ON user_biomarkers(user_id);
CREATE INDEX IF NOT EXISTS idx_user_biomarkers_category ON user_biomarkers(category);
CREATE INDEX IF NOT EXISTS idx_user_biomarkers_date ON user_biomarkers(date);