# OwnMyHealth Technical Debt Analysis Report
**Generated:** 2025-11-28
**Coverage:** Backend + Frontend codebase

---

## Executive Summary

Comprehensive analysis of the OwnMyHealth codebase identified **~55 issues** across 7 categories. The codebase is generally well-structured with proper HIPAA compliance foundations (encryption, audit logging), but has accumulated technical debt in code duplication, type safety, and logging practices.

### Issue Severity Breakdown
| Category | Critical | High | Medium | Low | Total |
|----------|----------|------|--------|-----|-------|
| Dead Code | 0 | 0 | 1 | 3 | 4 |
| Duplicate Code | 2 | 3 | 2 | 0 | 7 |
| Type Safety | 3 | 0 | 4 | 3 | 10 |
| Error Handling | 4 | 4 | 4 | 0 | 12 |
| Security | 1 | 5 | 4 | 5 | 15 |
| Performance | 4 | 3 | 3 | 2 | 12 |
| **Total** | **14** | **15** | **18** | **13** | **60** |

---

## 1. DEAD CODE

### Fixed (Low Risk)
| File | Line | Issue | Status |
|------|------|-------|--------|
| `src/components/dashboard/getIcon.tsx` | 10-11 | Confusing icon aliases (LucideKey as Kidney, Clover as Liver) | FIXED - Added clarifying comments |

### Needs Manual Review
| File | Line | Issue | Severity |
|------|------|-------|----------|
| `backend/src/controllers/biomarkerController.ts` | 45 | Unused `userId` parameter in toResponse | Low |
| `backend/src/services/pdfParser.ts` | 1196 | Unused `avgConfidence` variable | Low |
| `src/hooks/useApi.ts` | - | Potentially unused `useApiCall` and `usePaginatedApi` hooks | Medium |
| `src/components/auth/RoleGuard.tsx` | - | Potentially unused `RoleGuard` components | Low |

---

## 2. DUPLICATE CODE

**Estimated Reduction Potential:** ~640 lines

### Critical
| Pattern | Files | Lines Duplicated | Recommended Fix |
|---------|-------|------------------|-----------------|
| File upload handlers | `backend/src/services/api.ts` (3x) | ~180 lines | Extract `uploadFile<T>(endpoint, file, additionalData)` utility |
| Pagination logic | 5 controllers | ~100 lines | Create `PaginationService` or `applyPagination(query, params)` helper |

### High
| Pattern | Files | Lines Duplicated | Recommended Fix |
|---------|-------|------------------|-----------------|
| 401 retry pattern | `src/services/api.ts` (4x) | ~80 lines | Create `fetchWithAuth(url, options)` wrapper |
| toResponse decryption | 4 backend controllers | ~200 lines | Create `DecryptionService.toResponse<T>(entity, fields)` |
| toNumber() conversion | 5+ controllers | ~50 lines | Add `parseNumericParam(value, field)` to shared utils |

### Medium
| Pattern | Files | Lines Duplicated | Recommended Fix |
|---------|-------|------------------|-----------------|
| Error response formatting | Multiple controllers | ~30 lines | Already have `formatError`, ensure consistent usage |
| N+1 variant creation | dnaController.ts | - | Batch create with `createMany` |

---

## 3. TYPE SAFETY ISSUES

### Critical
| File | Line | Issue |
|------|------|-------|
| `backend/src/controllers/biomarkerController.ts` | 156 | `(req as any).file` - unsafe file type access |
| `backend/src/controllers/dnaController.ts` | 212 | `(req as any).file` - unsafe file type access |
| `backend/src/middleware/validation.ts` | - | Catch-all with generic `any` error type |

### Medium
| File | Line | Issue |
|------|------|-------|
| `backend/src/services/pdfParser.ts` | - | pdf-parse returns untyped `any` |
| `backend/src/middleware/validation.ts` | - | `ZodSchema<any>` loses type inference |
| `backend/src/controllers/dnaController.ts` | - | Multiple `as DnaVariant` assertions |
| `backend/src/services/auditLog.ts` | - | `details` uses loose type signature |

### Low
| File | Line | Issue |
|------|------|-------|
| Various controllers | - | `|| null` coercion patterns |
| `backend/src/services/encryption.ts` | - | Metadata objects untyped |
| Multiple files | - | Prisma includes return `any` at runtime |

---

## 4. ERROR HANDLING ISSUES

### Critical
| File | Line | Issue | Impact |
|------|------|-------|--------|
| `src/components/dashboard/ProviderDirectoryPanel.tsx` | - | Geolocation promise without catch | Unhandled rejection on permission deny |
| `src/components/dashboard/ProviderDirectoryPanel.tsx` | - | Provider search errors silently swallowed | User sees no feedback on API failure |
| `src/components/dashboard/InsurancePanel.tsx` | - | Insurance verification errors ignored | Silent failure on verification |
| `backend/src/services/encryption.ts` | - | Uses fallback temp salt in demo mode | PHI could be unrecoverable |

### High
| File | Line | Issue | Impact |
|------|------|-------|--------|
| `src/services/api.ts` | - | Token refresh catch without error details | Auth failures may be unclear |
| `backend/src/index.ts` | - | Database init allows startup without DB | App may run in broken state |
| `backend/src/services/auditLog.ts` | - | Fallback to temp salt for audit logs | Audit integrity compromised |
| `backend/src/controllers/biomarkerController.ts` | - | Bulk creation partial failures not reported | User doesn't know which items failed |

### Medium
| File | Line | Issue | Impact |
|------|------|-------|--------|
| `backend/src/middleware/optionalAuth.ts` | - | Generic catch for JWT verification | Masks specific JWT errors |
| `backend/src/middleware/validation.ts` | - | Catch-all for validation | Different errors treated same |
| `backend/src/services/pdfParser.ts` | - | No retry on PDF parse failure | Transient failures not handled |
| Various | - | Console.log instead of proper logger | Not production-ready |

---

## 5. SECURITY ISSUES

### Critical
| File | Line | Issue | CVSS | Remediation |
|------|------|-------|------|-------------|
| `backend/src/routes/auth.ts` | - | Demo account can escalate to admin | 8.0 | Restrict demo account role to 'demo', block role changes |

### High
| File | Line | Issue | CVSS | Remediation |
|------|------|-------|------|-------------|
| `backend/src/services/pdfParser.ts` | 360, 580 | ReDoS in insurance amount regex | 7.5 | Add timeout, simplify regex patterns |
| `backend/src/services/documentParser.ts` | - | ReDoS in document parsing | 7.5 | Add timeout wrapper |
| `backend/src/app.ts` | - | No CSRF protection configured | 7.0 | Add csurf middleware for state-changing routes |
| `backend/src/routes/auth.ts` | - | Demo accounts bypass MFA | 6.5 | Enforce MFA for demo accounts or clearly document limitation |
| `backend/src/controllers/authController.ts` | - | Timing attack on user enumeration | 5.3 | Constant-time response for login attempts |

### Medium
| File | Line | Issue | Remediation |
|------|------|-------|-------------|
| `backend/src/config/index.ts` | - | Default JWT secrets in config | Fail startup if secrets not set in production |
| `backend/src/app.ts` | - | CORS allows localhost in production | Restrict origins based on NODE_ENV |
| `backend/src/services/encryption.ts` | - | PHI encryption fallback to demo salt | Remove fallback, fail fast if no proper salt |
| `src/services/api.ts` | - | Token stored in localStorage | Consider httpOnly cookies |

### Low
| File | Line | Issue | Remediation |
|------|------|-------|-------------|
| `backend/src/services/pdfParser.ts` | Multiple | Console.log statements (21 instances) | Replace with proper logger |
| `backend/src/services/dnaParser.ts` | 86 | Debug logging function | Conditional based on DEBUG flag |
| `backend/src/controllers/dnaController.ts` | 328-387 | Console.log for processing status | Use logger service |
| Frontend components | Various | Error details exposed to console | Filter sensitive data |
| `backend/src/services/auditLog.ts` | - | Fallback salt reduces audit integrity | Remove fallback |

---

## 6. PERFORMANCE ISSUES

### Critical (N+1 Query Patterns)
| File | Line | Issue | Estimated Impact |
|------|------|-------|------------------|
| `backend/src/controllers/biomarkerController.ts` | 180-200 | Bulk biomarker creation uses individual creates in loop | O(n) DB calls |
| `backend/src/controllers/dnaController.ts` | 367-382 | Variant creation in batches of 1000 still loops | O(n/1000) transactions |
| `backend/src/controllers/dnaController.ts` | 387 | Trait creation loops | O(traits) DB calls |
| `backend/src/controllers/insuranceController.ts` | - | Plans loaded without pagination | Memory spike on large datasets |

### High
| File | Line | Issue | Recommended Fix |
|------|------|-------|-----------------|
| `backend/src/controllers/insuranceController.ts` | - | Unpaginated insurance plans fetch | Add limit/offset |
| `backend/src/controllers/biomarkerController.ts` | - | Unlimited biomarker history loads | Add date range filter |
| `src/components/dashboard/Dashboard.tsx` | - | All biomarkers loaded on mount | Implement virtual scrolling |

### Medium
| File | Line | Issue | Recommended Fix |
|------|------|-------|-----------------|
| `src/utils/ai.ts` | - | O(n^4) correlation matrix calculation | Cache correlations, limit biomarker count |
| `src/utils/ai.ts` | - | Linear regression recalculated for each render | Memoize with useMemo |
| `backend/src/services/pdfParser.ts` | - | Large PDFs fully loaded into memory | Stream processing |

### Low
| File | Line | Issue |
|------|------|-------|
| `src/components/dashboard/*` | - | Multiple useState causing re-renders | Consider useReducer |
| `backend/src/routes/*` | - | No response caching headers | Add Cache-Control for static data |

---

## 7. WHAT WAS FIXED

| File | Change | Risk Level |
|------|--------|------------|
| `src/components/dashboard/getIcon.tsx:10-12` | Added clarifying comments for icon aliases | Low |

---

## 8. REMEDIATION PRIORITY

### Immediate (Sprint 1)
1. **Fix ReDoS vulnerabilities** - Add timeout wrappers to regex-heavy parsing
2. **Add CSRF protection** - Install and configure csurf middleware
3. **Fix N+1 queries** - Use Prisma `createMany` for bulk operations
4. **Remove demo escalation risk** - Lock demo account to demo role

### Short-term (Sprint 2-3)
1. **Replace console.log** - Implement proper logging service (Winston/Pino)
2. **Extract duplicate code** - Create shared utilities for pagination, file upload, decryption
3. **Fix unhandled promises** - Add proper error handling to geolocation and API calls
4. **Add pagination** - Insurance plans, biomarker history

### Medium-term (Sprint 4-6)
1. **Type safety improvements** - Create proper types for file uploads, PDF parsing
2. **Performance optimization** - Virtual scrolling, correlation caching
3. **Error handling audit** - Standardize error responses across all controllers

---

## 9. METRICS

- **Lines of duplicate code identified:** ~640
- **Console.log statements to replace:** 21
- **Type safety issues:** 10
- **Unhandled promise locations:** 4
- **Security vulnerabilities:** 15 (1 critical, 5 high)
- **N+1 query patterns:** 4

---

## 10. NOTES

1. **HIPAA Compliance Foundation:** The codebase has proper foundations with AES-256-GCM encryption and audit logging. The identified issues are mostly about hardening existing implementations.

2. **Demo Mode Concerns:** Several security relaxations exist for demo mode. These should be clearly documented and potentially removed in production builds.

3. **Test Coverage:** Backend tests are solid (308 passing, encryption at 94.89%). Frontend tests added during this session (114 passing) with key components at 90-100% coverage.

4. **Console Logging:** The 21 console.log statements in backend services are currently serving as debugging aids during PDF/DNA parsing. A proper logging infrastructure should be implemented before production.
