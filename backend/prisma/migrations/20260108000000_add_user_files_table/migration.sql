-- CreateTable: user_files
CREATE TABLE "user_files" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "filename" VARCHAR(255) NOT NULL,
    "original_filename" VARCHAR(255) NOT NULL,
    "file_type" VARCHAR(50) NOT NULL,
    "file_size" INTEGER NOT NULL,
    "storage_key" VARCHAR(500) NOT NULL,
    "lab_name" VARCHAR(255),
    "lab_date" DATE,
    "biomarkers_extracted" INTEGER NOT NULL DEFAULT 0,
    "extraction_confidence" DECIMAL(3,2),
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "user_files_pkey" PRIMARY KEY ("id")
);

-- CreateIndex: user_files indexes
CREATE INDEX "user_files_user_id_idx" ON "user_files"("user_id");
CREATE INDEX "user_files_lab_date_idx" ON "user_files"("lab_date");

-- AddForeignKey: user_files -> users
ALTER TABLE "user_files" ADD CONSTRAINT "user_files_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AlterTable: biomarkers - add user_file_id column
ALTER TABLE "biomarkers" ADD COLUMN "user_file_id" UUID;

-- CreateIndex: biomarkers user_file_id index
CREATE INDEX "biomarkers_user_file_id_idx" ON "biomarkers"("user_file_id");

-- AddForeignKey: biomarkers -> user_files
ALTER TABLE "biomarkers" ADD CONSTRAINT "biomarkers_user_file_id_fkey" FOREIGN KEY ("user_file_id") REFERENCES "user_files"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Enable RLS on user_files table
ALTER TABLE "user_files" ENABLE ROW LEVEL SECURITY;

-- Create RLS policies for user_files
CREATE POLICY "user_files_select_policy" ON "user_files"
    FOR SELECT
    USING (
        user_id::text = current_setting('app.current_user_id', true)
        OR current_setting('app.is_admin', true) = 'true'
    );

CREATE POLICY "user_files_insert_policy" ON "user_files"
    FOR INSERT
    WITH CHECK (
        user_id::text = current_setting('app.current_user_id', true)
        OR current_setting('app.is_admin', true) = 'true'
    );

CREATE POLICY "user_files_update_policy" ON "user_files"
    FOR UPDATE
    USING (
        user_id::text = current_setting('app.current_user_id', true)
        OR current_setting('app.is_admin', true) = 'true'
    );

CREATE POLICY "user_files_delete_policy" ON "user_files"
    FOR DELETE
    USING (
        user_id::text = current_setting('app.current_user_id', true)
        OR current_setting('app.is_admin', true) = 'true'
    );
