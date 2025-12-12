# OwnMyHealth Scalability & Performance Audit

**Part 3 of 4 - December 2024**

**Target Scale:** 1,000 users Year 1, 10,000+ users later

---

## Executive Summary

The application is reasonably architected for initial launch but has **several critical bottlenecks** that will emerge at scale. The most pressing concerns are:

1. **Audit Log Growth**: 127.75M rows in 7 years at just 1K users (no partitioning)
2. **DNA Data Volume**: 5-10 billion variant rows at 10K users
3. **Synchronous Processing**: No job queue - DNA/PDF processing blocks HTTP requests
4. **Connection Pool Limits**: Only 10 connections (insufficient for 10K users)
5. **Frontend Bundle Size**: Heavy dependencies loaded synchronously

### Risk Summary by User Count

| Scale | Risk Level | Key Bottleneck |
|-------|------------|----------------|
| 0-500 | LOW | Minor - current architecture sufficient |
| 500-1,000 | MEDIUM | Audit log queries begin slowing |
| 1,000-5,000 | HIGH | Connection pool exhaustion, DNA queries slow |
| 5,000-10,000 | CRITICAL | Database performance degradation |
| 10,000+ | SEVERE | Multiple systems failure likely |

---

## 1. Database Performance Analysis

### 1.1 Connection Pooling

**Current Configuration** (`backend/src/services/database.ts:70-75`):
```typescript
pool = new Pool({
  connectionString,
  max: 10,              // Too small for scale
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000,
});
```

**Assessment:**
- **1K users**: 10 connections may be sufficient with ~100 concurrent users
- **5K users**: Connection exhaustion likely during peak hours
- **10K users**: Critical bottleneck - requests will timeout

**Recommendations:**
- Increase to `max: 50` for initial scale
- Implement connection pooling with PgBouncer for 10K+ users
- Add connection monitoring and alerting

### 1.2 Index Coverage

**Positive Findings:**
The schema has comprehensive indexing:

| Table | Indexes | Coverage |
|-------|---------|----------|
| AuditLog | 6 indexes | GOOD - userId, action, resourceType, resourceId, createdAt (ASC/DESC) |
| Biomarker | 7 indexes | GOOD - userId+category, userId+isOutOfRange, measurementDate |
| DNAVariant | 2 indexes | ADEQUATE - dnaDataId, rsid |
| DNAData | 1 index | SUFFICIENT - userId |
| GeneticTrait | 3 indexes | GOOD - dnaDataId, category, riskLevel |

**Missing Indexes (Recommended):**
```prisma
// DNAVariant - compound index for filtered queries
@@index([dnaDataId, chromosome])

// AuditLog - compound index for user activity queries
@@index([userId, createdAt])
@@index([resourceType, resourceId])
```

### 1.3 Query Patterns

**Positive Patterns Found:**
- `createMany()` used correctly for batch inserts (`dnaController.ts:370`, `biomarkerController.ts:521`)
- Pagination implemented for DNA variants (default 50 per page)
- No N+1 query patterns detected in controllers

**Potential Issues:**
- DNA variant queries return paginated but decrypt per-record in memory
- No query result caching layer

---

## 2. Audit Log Scalability (CRITICAL)

### 2.1 Growth Projections

**Configuration** (`backend/src/services/auditLog.ts:7`):
```typescript
const RETENTION_DAYS = 2555; // ~7 years for HIPAA compliance
```

**Activity Estimates per User:**
| Activity Type | Events/Day | Annual Total |
|---------------|------------|--------------|
| Logins | 2 | 730 |
| Biomarker reads | 20 | 7,300 |
| Biomarker creates/updates | 5 | 1,825 |
| DNA variant access | 15 | 5,475 |
| Insurance access | 5 | 1,825 |
| Export operations | 1 | 365 |
| **Total per user** | **~50** | **~18,250** |

**Scaling Projections:**

| Users | Daily Rows | Annual Rows | 7-Year Total |
|-------|------------|-------------|--------------|
| 1,000 | 50,000 | 18.25M | **127.75M** |
| 5,000 | 250,000 | 91.25M | **638.75M** |
| 10,000 | 500,000 | 182.5M | **1.28B** |

### 2.2 Storage Requirements

Estimated row size: ~500 bytes (with encrypted values)

| Users | 7-Year Storage |
|-------|----------------|
| 1,000 | ~64 GB |
| 5,000 | ~320 GB |
| 10,000 | ~640 GB |

### 2.3 Query Performance Concerns

**Current Risk:** Without table partitioning, queries on 127M+ rows will degrade significantly.

- Compliance report queries (date ranges) will slow to 10+ seconds
- User-specific audit queries will remain fast (userId index exists)
- Full table scans for analytics will timeout

### 2.4 Recommendations (HIGH PRIORITY)

1. **Implement Table Partitioning by Date:**
```sql
-- Partition by month for efficient retention cleanup
CREATE TABLE audit_logs (
  -- columns
) PARTITION BY RANGE (created_at);

-- Create monthly partitions
CREATE TABLE audit_logs_2024_01 PARTITION OF audit_logs
  FOR VALUES FROM ('2024-01-01') TO ('2024-02-01');
```

2. **Archive Strategy:**
- Move logs older than 2 years to cold storage (S3/Glacier)
- Implement read-through caching for historical queries

3. **Add Composite Indexes:**
```prisma
@@index([userId, createdAt])
@@index([resourceType, action, createdAt])
```

---

## 3. DNA Data Handling

### 3.1 Data Volume Analysis

**Per-User DNA Data:**
- 23andMe raw file: ~600K-700K variants
- AncestryDNA raw file: ~500K-600K variants
- Average: ~500,000 variants per user

**Scaling Projections:**

| Users | Total Variants | Storage (encrypted) |
|-------|----------------|---------------------|
| 1,000 | 500M | ~150 GB |
| 5,000 | 2.5B | ~750 GB |
| 10,000 | 5B | ~1.5 TB |

### 3.2 Import Process Analysis

**Current Implementation** (`backend/src/services/dnaParser.ts`, `dnaController.ts:350-404`):

**Strengths:**
1. Streaming parser available (`parseDNAFileStream`) - good memory management
2. Batch inserts with 1,000 records per batch
3. Uses `createMany()` for O(1) database operations

**Critical Issue - Synchronous Processing:**
```typescript
// dnaController.ts - DNA upload is synchronous in HTTP request
for (let batchIdx = 0; batchIdx < variantBatches.length; batchIdx++) {
  const batch = variantBatches[batchIdx];
  await prisma.dNAVariant.createMany({ ... });  // Blocks request
}
```

**Impact:**
- 500K variants / 1000 per batch = 500 database operations
- At ~10ms per batch = 5+ seconds blocking the HTTP request
- With encryption overhead = 10-30 seconds total
- HTTP timeout risk at scale

### 3.3 Query Performance

**Variant Retrieval** (`dnaController.ts`):
- Paginated with default 50 records - GOOD
- Decryption happens per-record in application layer - O(n) crypto operations
- RSid search has index - GOOD

**Concern at Scale:**
- 50 variants * AES-256-GCM decryption = acceptable latency
- Full dataset queries (traits analysis) require loading all 500K variants

### 3.4 Recommendations (HIGH PRIORITY)

1. **Implement Background Job Processing:**
```typescript
// Use BullMQ + Redis for async processing
import { Queue, Worker } from 'bullmq';

const dnaQueue = new Queue('dna-processing');

// In controller - return immediately
await dnaQueue.add('process-dna', { uploadId, userId, filePath });
res.json({ uploadId, status: 'PROCESSING' });

// Worker handles heavy lifting
const worker = new Worker('dna-processing', async (job) => {
  // Parse and store variants
  // Update status when complete
});
```

2. **Consider Variant Storage Optimization:**
- Store only health-relevant SNPs (~25 currently) + user-queried variants
- Archive raw file to S3 for future reprocessing if needed

3. **Add DNA-Specific Partitioning:**
```sql
-- Partition by dnaDataId for efficient cascade deletes
```

---

## 4. File Processing Performance

### 4.1 PDF Parsing

**Current Implementation** (`backend/src/services/pdfParser.ts`):
- Uses `pdf-parse` library
- 1,806 lines of parsing logic
- Comprehensive biomarker extraction

**Issues:**
1. **Synchronous Processing**: PDF parsing blocks HTTP request
2. **No Timeout Handling**: Large/malformed PDFs can hang
3. **Memory Usage**: Entire PDF loaded into memory

**File Size Concerns:**
| PDF Size | Estimated Parse Time | Memory Usage |
|----------|---------------------|--------------|
| 1 MB | 1-2 seconds | ~10 MB |
| 5 MB | 5-10 seconds | ~50 MB |
| 10 MB | 10-20 seconds | ~100 MB |

### 4.2 DNA File Parsing

**Current Implementation** (`backend/src/services/dnaParser.ts`):

**Strengths:**
- Streaming interface available (`parseDNAFileStream`)
- Batch processing of 10,000 lines
- Progress callback support

**Weaknesses:**
- Buffer-based parser (`parseDNAFile`) used by controller, not stream version
- Full file converted to string before processing

### 4.3 Recommendations

1. **Move File Processing to Background Jobs:**
```typescript
// Immediate response with processing ID
res.json({ uploadId, status: 'QUEUED' });

// Process async with status updates
await fileQueue.add('parse-pdf', { uploadId, filePath });
```

2. **Add Timeout Protection:**
```typescript
const PARSE_TIMEOUT_MS = 30000;
const parseWithTimeout = Promise.race([
  parsePDF(buffer),
  new Promise((_, reject) =>
    setTimeout(() => reject(new Error('Parse timeout')), PARSE_TIMEOUT_MS)
  )
]);
```

3. **Implement File Size Limits:**
```typescript
// Already have multer, ensure limits are enforced
const upload = multer({ limits: { fileSize: 10 * 1024 * 1024 } }); // 10MB
```

---

## 5. Encryption Overhead

### 5.1 Current Implementation

**Algorithm**: AES-256-GCM with per-user key derivation

**Key Derivation** (`backend/src/services/userEncryption.ts`):
- PBKDF2-SHA512 with 100,000 iterations
- Per-user salt stored in database

**Per-Operation Cost:**
| Operation | Time (est.) |
|-----------|-------------|
| Key derivation | 50-100ms (cached after first use) |
| Encrypt (1KB) | 0.1-0.2ms |
| Decrypt (1KB) | 0.1-0.2ms |

### 5.2 Scaling Impact

**DNA Variants (500K records):**
- Encryption on import: 500K * 0.15ms = ~75 seconds
- Decryption for full read: 500K * 0.15ms = ~75 seconds (but paginated, so acceptable)

**Audit Logs:**
- Encryption of previous/new values adds ~0.3ms per log entry
- At 50 logs/day/user = negligible impact

### 5.3 Recommendations

1. **Cache Derived Keys:**
```typescript
// Appears to be implemented - verify key caching in userEncryption.ts
const keyCache = new Map<string, Buffer>();
```

2. **Batch Encryption:**
```typescript
// For DNA import - encrypt in parallel
const encryptedVariants = await Promise.all(
  batch.map(v => encryptionService.encrypt(v.genotype, userSalt))
);
```

3. **Consider Hardware Acceleration:**
- Node.js crypto uses OpenSSL which supports AES-NI
- Ensure production servers have AES-NI enabled

---

## 6. API Response Patterns

### 6.1 Caching Analysis

**Current State:** No caching layer implemented

**Files Searched:** Only `authService.ts` mentions "cache" (session context)

**Missing Caching Opportunities:**
| Data Type | Cache Strategy | TTL |
|-----------|---------------|-----|
| User profile | Redis/memory | 5 min |
| Insurance plan list | Redis | 1 hour |
| DNA traits summary | Redis | Until data changes |
| Biomarker history | None (PHI) | N/A |

### 6.2 Recommendations

1. **Add Redis for Session/Cache Layer:**
```typescript
// Session store
import RedisStore from 'connect-redis';
app.use(session({
  store: new RedisStore({ client: redisClient }),
  // ...
}));
```

2. **Implement ETag Caching:**
```typescript
// For rarely-changing data
res.setHeader('ETag', generateETag(data));
if (req.headers['if-none-match'] === etag) {
  return res.status(304).end();
}
```

---

## 7. Frontend Performance

### 7.1 Bundle Analysis

**Heavy Dependencies** (`package.json`):
| Package | Estimated Size | Purpose |
|---------|---------------|---------|
| tesseract.js | ~12 MB | OCR (insurance cards) |
| pdfjs-dist | ~2 MB | PDF rendering |
| chart.js + recharts | ~1.5 MB | Dual charting libraries |
| jspdf + jspdf-autotable | ~1 MB | PDF generation |
| html2canvas | ~500 KB | Screenshot capture |

**Total Estimated Bundle:** ~17 MB unminified, ~5-6 MB minified+gzipped

### 7.2 Code Splitting Analysis

**Current State** (`src/App.tsx`):
```typescript
// All imports are static - NO code splitting
import { Dashboard } from './components/dashboard';
import { LoginPage, RegisterPage, ... } from './components/auth';
```

**Component Count:** 49 .tsx files loaded synchronously

**Issues:**
- Unauthenticated users load entire dashboard code
- Heavy OCR/PDF libraries loaded even if not used

### 7.3 Recommendations (HIGH PRIORITY)

1. **Implement Route-Based Code Splitting:**
```typescript
// App.tsx - Lazy load major components
const Dashboard = lazy(() => import('./components/dashboard'));
const DNAUploadModal = lazy(() => import('./components/dna/DNAUploadModal'));
const InsuranceHub = lazy(() => import('./components/insurance/InsuranceHub'));

// Wrap in Suspense
<Suspense fallback={<LoadingSpinner />}>
  <Dashboard />
</Suspense>
```

2. **Configure Vite for Optimal Chunking:**
```typescript
// vite.config.ts
export default defineConfig({
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          'vendor-charts': ['chart.js', 'recharts', 'react-chartjs-2'],
          'vendor-pdf': ['pdfjs-dist', 'jspdf', 'jspdf-autotable'],
          'vendor-ocr': ['tesseract.js'],
        },
      },
    },
  },
});
```

3. **Lazy Load Heavy Features:**
```typescript
// Only load tesseract when OCR is needed
const loadOCR = async () => {
  const { createWorker } = await import('tesseract.js');
  return createWorker();
};
```

4. **Remove Duplicate Charting:**
- Choose either chart.js OR recharts (currently both installed)

---

## 8. Horizontal Scaling Readiness

### 8.1 Current State Assessment

| Component | Multi-Instance Ready | Issues |
|-----------|---------------------|--------|
| Express Server | PARTIAL | Session handling needs Redis |
| Database | YES | PostgreSQL supports replication |
| File Storage | NO | Local filesystem |
| Background Jobs | NO | No job queue |
| Caching | NO | No shared cache |

### 8.2 Session Management

**Current State:** JWT-based authentication
- Access tokens stored in httpOnly cookies - GOOD
- Refresh tokens stored in database - GOOD for multi-instance

**Issue:** Session invalidation requires database lookup on every request

### 8.3 File Storage

**Current State:** Files processed in memory, not persisted after parsing

**For Scale:**
- Consider S3/GCS for raw file archival
- Implement presigned URLs for direct uploads

### 8.4 Recommendations for Horizontal Scale

1. **Add Redis for:**
   - Session store
   - Rate limiting (currently in-memory)
   - Caching
   - Job queue (BullMQ)

2. **Database Scaling:**
   - Read replicas for query distribution
   - Consider Citus/TimescaleDB for audit log partitioning

3. **Load Balancer Configuration:**
```nginx
upstream ownmyhealth {
  least_conn;  # Best for varied request duration
  server backend1:3001;
  server backend2:3001;
  keepalive 32;
}
```

---

## 9. Background Job Requirements

### 9.1 Operations Requiring Background Processing

| Operation | Current Duration | Impact |
|-----------|-----------------|--------|
| DNA file upload | 10-30 seconds | Blocks HTTP |
| PDF parsing | 5-20 seconds | Blocks HTTP |
| Audit log cleanup | Minutes | Should be scheduled |
| Report generation | Varies | Blocks HTTP |
| Email sending | 1-3 seconds | Blocks HTTP |

### 9.2 Recommended Architecture

```
┌─────────────────┐     ┌─────────────────┐
│   Express API   │────▶│     Redis       │
└─────────────────┘     │  (Job Queue)    │
                        └────────┬────────┘
                                 │
        ┌────────────────────────┼────────────────────────┐
        ▼                        ▼                        ▼
┌───────────────┐      ┌───────────────┐      ┌───────────────┐
│  DNA Worker   │      │  PDF Worker   │      │ Email Worker  │
└───────────────┘      └───────────────┘      └───────────────┘
```

**Implementation:**
```bash
npm install bullmq ioredis
```

```typescript
// queues/index.ts
import { Queue } from 'bullmq';

export const dnaQueue = new Queue('dna-processing');
export const pdfQueue = new Queue('pdf-processing');
export const emailQueue = new Queue('email');

// workers/dna.worker.ts
import { Worker } from 'bullmq';

const worker = new Worker('dna-processing', async (job) => {
  const { uploadId, filePath } = job.data;

  // Update status to PROCESSING
  await updateUploadStatus(uploadId, 'PROCESSING');

  // Parse file
  const result = await parseDNAFile(filePath);

  // Store variants in batches
  for (const batch of result.variants) {
    await storeBatch(batch);
    await job.updateProgress(/* percentage */);
  }

  // Update status to COMPLETED
  await updateUploadStatus(uploadId, 'COMPLETED');
});
```

---

## 10. Priority Recommendations

### Immediate (Before 500 Users)

| Priority | Issue | Effort | Impact |
|----------|-------|--------|--------|
| P0 | Implement background job queue | Medium | HIGH |
| P0 | Add frontend code splitting | Low | HIGH |
| P1 | Increase connection pool | Trivial | MEDIUM |
| P1 | Add Redis for sessions/cache | Medium | MEDIUM |

### Short-Term (Before 1,000 Users)

| Priority | Issue | Effort | Impact |
|----------|-------|--------|--------|
| P1 | Plan audit log partitioning | High | HIGH |
| P1 | Remove duplicate chart library | Low | LOW |
| P2 | Add file size limits/timeouts | Low | MEDIUM |
| P2 | Implement ETag caching | Medium | LOW |

### Medium-Term (Before 5,000 Users)

| Priority | Issue | Effort | Impact |
|----------|-------|--------|--------|
| P1 | Implement audit log partitioning | High | CRITICAL |
| P1 | Database read replicas | High | HIGH |
| P2 | Consider DNA variant storage optimization | High | MEDIUM |
| P2 | S3 integration for file storage | Medium | MEDIUM |

### Long-Term (Before 10,000 Users)

| Priority | Issue | Effort | Impact |
|----------|-------|--------|--------|
| P1 | Evaluate TimescaleDB for audit logs | High | CRITICAL |
| P1 | Full horizontal scaling implementation | High | HIGH |
| P2 | Archive strategy for old audit logs | Medium | MEDIUM |

---

## 11. Monitoring Recommendations

### Key Metrics to Track

```typescript
// Recommended Prometheus metrics
const metrics = {
  // Database
  'db_pool_connections_active': Gauge,
  'db_pool_connections_waiting': Gauge,
  'db_query_duration_seconds': Histogram,

  // API
  'http_request_duration_seconds': Histogram,
  'http_requests_total': Counter,

  // Background Jobs
  'job_queue_depth': Gauge,
  'job_processing_duration_seconds': Histogram,
  'job_failures_total': Counter,

  // Business Metrics
  'dna_uploads_total': Counter,
  'pdf_parses_total': Counter,
  'audit_logs_created_total': Counter,
};
```

### Alerting Thresholds

| Metric | Warning | Critical |
|--------|---------|----------|
| DB connection pool utilization | > 70% | > 90% |
| API response time (p95) | > 1s | > 5s |
| Job queue depth | > 100 | > 500 |
| Audit log table size | > 50M rows | > 100M rows |

---

## Summary

The OwnMyHealth application has a solid foundation but requires architectural changes to scale beyond 1,000 users. The most critical issues are:

1. **Synchronous file processing** - Will cause timeouts and poor UX
2. **Audit log growth** - Will degrade database performance without partitioning
3. **Frontend bundle size** - Will cause slow initial loads
4. **No caching layer** - Will create unnecessary database load

Addressing the P0 items before launch will provide headroom for the first 500-1,000 users. The audit log partitioning should be planned immediately as it requires database schema changes that are harder to implement with existing data.

---

*Report generated as part of comprehensive application audit*
*Part 3 of 4 - Scalability & Performance*
