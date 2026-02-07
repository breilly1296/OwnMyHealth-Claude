# OwnMyHealth Changelog

All notable changes to this project.

*Generated: 2026-02-06 | Covers: 2025-11-26 through 2026-02-06 | 296 commits*

---

## February 2026

### Changed
- **Prompt Library and CLAUDE.md** - Updated to match actual codebase state (`7579b19`)

---

## January 2026

### Added
- **Expense Tracking and Cost Optimization** - Full-stack expense tracking with projections, actuals, and AI-powered cost analysis (`baa6425`, `6aba34a`)
- **Out-of-Network Financial Fields** - Extended insurance plan schema with out-of-network cost fields (`f0b0288`)
- **Re-analyze Plan Feature** - Users can re-run SBC extraction on existing insurance plans (`0239e81`)
- **Coinsurance Support for SBC Extraction** - Extract and display coinsurance fields when copay is null (`df1747e`, `67e069c`, `6582759`)
- **Insurance Plan Deletion** - Delete functionality for insurance plans with success toast notifications (`10d4bbe`, `a3189c4`)
- **Insurance Plan Detail View** - Comprehensive detail view for insurance plans (`e3d44de`)
- **Insurance Feature with Claude Sonnet SBC Parsing** - Upload Summary of Benefits and Coverage documents, parsed by Claude AI (`019eb46`)
- **Comprehensive Insurance Coverage Fields** - Database migration adding all standard insurance coverage fields (`9e2961e`, `4badc6e`)
- **Dark Mode Default + Premium Login UI** - Dark theme by default with redesigned login page (`b949fa6`, `96c25a4`)
- **AI Health Guide** - AI-powered educational guidance for all biomarkers, shown on expand with improved UX (`d26725d`, `39f0d3b`, `6a0d135`)
- **AI Guidance on Category and Trends Pages** - Claude-powered educational content on category page biomarker expansion and trends page (`c475dca`, `25536da`)
- **Trends Page** - Biomarker trend analysis with historical charts (`c77a968`)
- **File Repository** - Repository view for all uploaded lab reports (`3c5b852`)
- **Biomarker Count Badges** - Sidebar categories show biomarker count badges (`6b50faf`)
- **Claude API for Biomarker Extraction** - Replaced PDF regex extraction with Claude API for more accurate results (`7563bc8`)
- **PDF-Parse Text Extraction** - Use pdf-parse for direct text extraction with OCR as fallback (`1312413`)
- **Full Mobile Responsiveness** - Responsive layout across all application views (`19aea90`)
- **Export All My Data** - Users can export all their health data (`bc2f6bc`)
- **Account Settings Page** - Settings page with dark mode support (`e900d9e`)
- **Comprehensive Biomarker Library** - 200+ biomarker patterns across 24 categories with measurement options (`0f7336d`, `e1fbe2d`, `faa84a7`)
- **OCR for Lab Results** - Google Document AI integration for scanned lab report extraction (`202f2dd`, `3eda225`, `eb3d829`)
- **Code Splitting** - Reduced initial bundle size 91% (895KB to 78KB) via lazy loading (`709eb69`, `1fb87e2`)
- **Row-Level Security (RLS) Policies** - Database-level access control ensuring users only access their own data (`c09d83a`)
- **Audit Logging Expansion** - Expanded audit logging coverage for HIPAA compliance (`a287270`)
- **Rate Limiting on All API Endpoints** - Applied rate limiting across all API routes (`b63fb00`)
- **Comprehensive Middleware and Service Tests** - Added test coverage for middleware and service layers (`e402fbd`)

### Changed
- **Cost Display Standardization** - Replaced "$0" and "No charge" displays with "--" across insurance components (`80d68e7`, `61c7648`, `b8db4bc`)
- **Dashboard Refactor** - Split Dashboard.tsx 75% (1,136 to 284 lines) with infinite loop fix (`dc65ca4`)
- **Biomarker Reference Ranges** - Corrected reference ranges based on clinical verification, added advanced lipid markers (`d12ca2a`, `7e0bf85`)
- **Code Consolidation** - Simplified api.ts, measurementOptions.ts, InsuranceKnowledgeBase; consolidated duplicate code (`c19246c`, `197da0a`, `7d14bd7`)
- **Removed CMS Marketplace and Provider Directory** - Removed ~3,500 lines of unused feature code (`fb0590d`)
- **Removed Health Scoring and AI Recommendations** - Removed ~3,000 lines of unused feature code (`cd545f7`)
- **Removed Genetics/DNA Analysis** - Removed ~1,500 lines of unused feature code (`241cdd2`)
- **Improved Input Validation** - Better validation coverage across API boundaries (`faf7cd4`)
- **SBC Extraction Prompt** - Improved extraction prompts with detailed logging, then reverted to stable state (`1aa50a6`, `e2afff2`)

### Fixed
- **CostOptimization Crash** - Handle undefined API responses in cost optimization component (`a292287`)
- **Frontend Crash on reduce()** - Added null checks to prevent reduce() errors on undefined arrays (`3c0f3fb`)
- **Insurance Plan Encryption** - Fixed 500 error when decrypting insurance plan PHI fields (`9167a07`)
- **Auth Token Restoration** - Fixed auth token not restored after page refresh, corrected refresh-first flow (`0889ff6`, `195ccc1`, `17b8e91`)
- **Insurance Plans Disappearing** - Fixed race condition causing insurance plans to vanish after page refresh (`de689c9`)
- **SBC Extraction Display** - Transform flat API fields to UI arrays for correct rendering (`405ef6b`)
- **Schema Mismatch** - Fixed schema mismatch preventing insurance plan saves (`8df7c64`)
- **PDF.js Conflicts** - Removed frontend PDF.js to prevent conflicts with backend-only processing (`0d2cd7a`, `8f9314f`, `4654968`)
- **Dashboard Navigation** - Fixed Dashboard nav item, Account Settings button, and Lab OCR button (`1620733`, `d2e8c3a`, `402fe51`)
- **Health Score Display** - Show "--" for Health Score when no biomarkers exist (`4d9119b`)
- **Biomarker Card UX** - Prevent Show More click from collapsing biomarker card (`b377863`)
- **AI Health Guide Markdown** - Render markdown properly in AI Health Guide responses (`078898d`)
- **CORS and Cookies** - Fixed cross-domain cookie support for CSRF protection (`327b2f4`, `8db4317`, `50d7426`)
- **CSRF Token Handling** - Improved cookie matching regex, added CSRF token to API calls (`b721788`, `7ad1272`, `bb66914`)
- **Bundle Splitting** - Keep React and recharts in same bundle to fix forwardRef error (`1e1bac0`)
- **Anthropic SDK Loading** - Handle missing API key gracefully, use dynamic import to prevent startup crash (`e7ae477`, `769685c`, `94004d0`)
- **Biomarker Pagination** - Prevent biomarkers from disappearing due to pagination (`080ad8e`)
- **Lab Upload UX** - Keep modal open after extraction to show results; use extracted labDate (`45cef63`, `36b7306`)
- **OCR Extraction** - Handle Document AI multi-line table extraction, improve patterns for Quest labs (`f62796f`, `a59c547`, `e79e1e2`)
- **CSRF Exemptions** - Exempt file upload and settings routes from CSRF validation (Bearer token protected) (`750357e`, `adca319`)
- **Dark Mode Visibility** - Improved dark mode text visibility across components (`4952c95`)
- **jspdf Vulnerability** - Updated jspdf to 4.0.0 to resolve critical vulnerability (`cb662c5`)
- **Sidebar Scrolling** - Enabled sidebar scrolling for biomarker categories (`d851fd3`)
- **Google Credentials** - Support JSON credentials in GOOGLE_APPLICATION_CREDENTIALS (`2b79d46`)
- **Chart Rendering** - Added null checks to prevent chart rendering errors (`3d287e2`)
- **Database Connection** - Increased connection timeout for Cloud SQL (`cdd1d7f`)
- **Migration Indexes** - Removed CONCURRENTLY from migration indexes for compatibility (`c00f8cc`)
- **PDF Bomb Protection** - Added DoS protection with timeout and memory limits (`f6c2b92`)
- **ESLint Errors** - Resolved ESLint errors across frontend insurance components and backend controllers (`6be8a92`, `71824af`, `52cf0ba`)
- **Claude API Limits** - Reduced max_tokens to valid limit (`e029127`)

### Security
- **SQL Injection in RLS Context** - Fixed SQL injection vulnerability in Row-Level Security context setting (`a133256`)
- **Log Format-String Injection** - Prevented format-string injection in logging (`58af475`)
- **CMS API Key Exposure** - Prevented API key exposure in logs and error messages (`eeab80c`)
- **IP Spoofing in Audit Logs** - Prevented IP spoofing via X-Forwarded-For header (`025bd57`)
- **Database Error Leakage** - Prevented internal database error messages from reaching users (`f9975c3`)
- **Sensitive Tokens in URL** - Clear sensitive tokens from URL after reading (`6f590a1`)
- **Provider Notes Encryption** - Encrypt provider notes before database storage (`269ea61`)
- **SSRF and Path Traversal** - Prevented SSRF and path traversal in CMS Marketplace API (`1b8e08c`)
- **Sensitive Data in Error Logs** - Removed sensitive request body from error logs (`2012fa7`)
- **Service Account Key Leak** - Removed accidentally committed service account key and added to .gitignore (`528d5f9`, `17de968`)

### Removed
- **Dead Code Cleanup** - Removed dead DNA and healthAnalysis hooks, unused types, leftover DNA code (`412a8e3`, `654ce11`)
- **Unused Imports** - Cleaned up unused imports across multiple files (`6cdf698`, `4e6adc1`, `2b613d8`)

---

## December 2025

### Added
- **CMS Marketplace API Integration** - Health insurance plan search via Healthcare.gov Marketplace API with FIPS auto-lookup (`24caad6`, `a395dd0`, `1c1ff95`)
- **Find Providers Tab** - Marketplace provider search UI (`3bbb5c0`)
- **Health Endpoint** - Added /health endpoint for Docker health checks (`50e7085`)
- **Initial Prisma Migration** - Database migration baseline (`0e88e3d`)
- **Email Verification and Password Reset** - Frontend pages and SendGrid email service integration (`621601f`, `c1a5ca0`)
- **GitHub Actions CI/CD Pipeline** - Automated CI/CD with lint, build, and test steps (`3b13911`)
- **ALLOW_DEMO_ACCOUNT Config** - Security hardening guide and demo account configuration (`95bd5a8`)
- **Scheduled Audit Log Cleanup** - Daily cleanup with 7-year retention policy (`872539e`)
- **Comprehensive Documentation** - Documentation and code comments across codebase (`355c9c0`)
- **Security Audit Reports** - Four-part comprehensive security, architecture, scalability, and production readiness audit (`ada33ea`, `7ac1374`, `1bac4e2`, `a1ad111`)
- **Security Review Prompts** - Prompts tailored to the codebase for ongoing security reviews (`05b62df`)

### Changed
- **Deployment: DigitalOcean to AWS ECS** - Migrated deployment infrastructure from DigitalOcean to AWS ECS (`5dfd6d0`)
- **Deployment: AWS ECS to Cloud Run** - Migrated from AWS ECS to GCP Cloud Run with Cloud Build (`44511b4`)
- **Frontend Deployment** - Added frontend deployment to Cloud Storage (`f124bc1`)
- **Prisma Migrations on Startup** - Run Prisma migrations automatically on container startup (`4a27c2f`)
- **Code Cleanup and Refactoring** - Extract health analysis utilities, comprehensive technical debt fixes (`4c02d27`, `f6c9308`, `a61c49e`)
- **Vite Config** - Added base: './' for relative asset paths (`c1b2fc4`)
- **Renamed .env to .env.example** - Stopped tracking .env, updated .gitignore (`8cbf298`, `a32ae60`)
- **Moved Generated Files** - Moved generated/ out of src/ to backend root (`224061c`)
- **Refactored Transactions** - Wrapped goal creation and DNA upload in transactions for data integrity (`6bd161a`, `9997c96`)

### Fixed
- **CMS Plan Search** - Fixed POST body format, NaN values for financial fields, and frontend/backend interface mismatch (`a14a15d`, `c41b09d`, `3cfec91`, `f84450b`)
- **TypeScript Compilation** - Fixes for Prisma 7 and duplicate exports (`007582d`)
- **CI Pipeline Fixes** - Fixed Prisma path, ESLint dependencies, package-lock.json issues, CI triggers (`5f12c19`, `527a1c8`, `7f356d9`, `316f1f7`, `9e72e40`, `2cf0ee2`, `a976437`)
- **Encryption Compatibility** - Added authTagLength to createDecipheriv calls for Node.js compatibility (`b9dc4e4`)
- **Dependency Vulnerabilities** - Resolved 5 npm audit vulnerabilities (jws, hono, valibot) and frontend dependency issues (`4cdb9d0`, `e27fc27`)
- **Email Verification** - Use GET method for verify-email API call (`9db6ab7`)
- **Docker Build** - Fixed Dockerfile to copy generated Prisma client from correct path, added dummy DATABASE_URL (`0f1b10a`, `8cf0496`)
- **YAML Syntax** - Corrected YAML syntax in ci.yml (`9d0d812`)

### Security
- **Hardcoded Credentials Removed** - Removed hardcoded database credentials fallback (`edf2c3a`)
- **Demo Credentials Removed** - Removed hardcoded demo credentials, added production validation (`9c0476a`)
- **Demo Account Hardening** - Hardened demo account security (`33b2c88`)
- **Password Policy** - Increased password minimum length from 8 to 12 characters (`0a2cf9e`)
- **DNA Buffer Cleanup** - Clear DNA buffer from memory after parsing (`082e2c9`)

### Infrastructure
- **Cloud Run Deployment** - Full CI/CD pipeline via GitHub Actions to GCP Cloud Run (`44511b4`, `b75803e`, `35a6cbb`)
- **Cloud Build Integration** - Replaced Docker direct builds with Cloud Build (`b75803e`)
- **GCP Auth Debugging** - Diagnosed and resolved GCP authentication issues for CI/CD (`5e302d2`, `8053a2e`, `a8502b8`)
- **Package Lock Files** - Added and refreshed package-lock.json files for reproducible builds (`fae86d2`, `acfc49f`, `110008d`)

### Removed
- **DigitalOcean Workflows** - Removed old DigitalOcean deployment workflows (`1b5c2a6`)
- **Unused Bolt Configuration** - Removed unused Bolt configuration (`43f8802`)
- **Unused Supabase Folder** - Removed supabase folder (project uses Prisma) (`4d70e27`)

---

## November 2025

### Added
- **Initial Production-Ready Release** - First complete release of the OwnMyHealth platform (`0c6c022`)
- **Pre-Cleanup Backup** - Baseline snapshot before major cleanup (`1e4a167`)

### Performance
- **N+1 Query Fixes** - Fixed N+1 queries in processDNAFile and bulkCreateHealthNeeds (`afea1c5`)
- **Algorithm Optimization** - Optimized compareBenefits from O(n^2) to O(n) (`665ecb8`)
- **Pagination** - Added pagination to getGeneticTraits endpoint (`ef352e2`)

---

## Summary Statistics

| Metric | Value |
|--------|-------|
| Total Commits | 296 |
| Date Range | Nov 26, 2025 - Feb 6, 2026 |
| Security Fixes | 15+ |
| Features Added | 30+ |
| Bug Fixes | 50+ |
| Refactors | 10+ |
| Deployment Migrations | 3 (DigitalOcean -> AWS ECS -> GCP Cloud Run) |
| Lines Removed (Refactors) | ~8,000+ |
| Bundle Size Reduction | 91% (895KB -> 78KB) |
| Biomarkers Supported | 200+ across 24 categories |

---

*Changelog format based on [Keep a Changelog](https://keepachangelog.com/)*
