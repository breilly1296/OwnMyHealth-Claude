# OwnMyHealth HIPAA Compliance Checklist

**Last Updated:** 2026-04-16
**Project status:** Pre-beta (pre-production)
**Compliance officer:** Solo founder (TBD — formal designation)

Technical safeguards verified from code. Administrative, physical, and procedural safeguards need user confirmation via prompt `22-hipaa-checklist-doc.md`.

---

## Business Associate Agreements

| Vendor | Service used | BAA status | Date | Notes |
|---|---|---|---|---|
| Google Cloud (GCP) | Cloud Run, Cloud SQL, GCS, Document AI, Secret Manager, Cloud Logging | ✅ Signed (TBD — confirm) | TBD | Required for all GCP services handling PHI |
| Anthropic | Claude API | **⏳ TBD — CRITICAL** | — | BAA required before production launch. Defense-in-depth: `stripPHIFromText()` scrubs common patterns pre-call, but structured PHI still transits. |
| SendGrid (Twilio) | Transactional email | TBD — check if needed | — | BAA only required if emails include PHI. Current emails (verification, password reset) should NOT include PHI — verify in `emailService.ts`. |

**Blocker for production:** Anthropic BAA. Do not run production PHI through Claude API without a signed BAA.

---

## §164.308 — Administrative Safeguards

### §164.308(a)(1) Security Management Process
| Requirement | Status | Evidence / Notes |
|---|---|---|
| Risk Analysis (written) | ⏳ TBD | Formal risk assessment not yet conducted. Security audit docs in this directory are a start but not HIPAA RA. |
| Risk Management | 🟡 Partial | `prompts/24-full-security-audit.md` provides framework; findings tracked in `SECURITY_STATUS.md`. |
| Sanction Policy | N/A | Solo founder; no workforce. Revisit when hiring. |
| Info System Activity Review | 🟡 Partial | Audit logs collect events (`backend/src/services/auditLog.ts`); review cadence TBD. |

### §164.308(a)(2) Assigned Security Responsibility
| Requirement | Status | Notes |
|---|---|---|
| Security Official designated | ⏳ TBD | Formal written designation needed (even solo). |

### §164.308(a)(3) Workforce Security
N/A — solo founder. Revisit when hiring.

### §164.308(a)(4) Information Access Management
| Requirement | Status | Evidence |
|---|---|---|
| Isolating health care clearinghouse function | N/A | Not a clearinghouse. |
| Access authorization | ✅ | RBAC in `backend/src/middleware/rbac.ts` (PATIENT/PROVIDER/ADMIN). |
| Access establishment / modification | ✅ | Role changes audit-logged via `auditLog.ts`. |

### §164.308(a)(5) Security Awareness & Training
| Requirement | Status | Notes |
|---|---|---|
| Training program | ⏳ TBD | Revisit when hiring. |
| Login monitoring | ✅ | Failed/successful logins audit-logged. Account lockout after 5 failures. |
| Password management | ✅ | bcrypt cost 12, complexity requirements enforced via Zod. |

### §164.308(a)(6) Security Incident Procedures
| Requirement | Status | Notes |
|---|---|---|
| Response procedures | ⏳ TBD | No written IR playbook yet. Draft needed before beta. |
| Breach notification workflow | ⏳ TBD | Needed: detection threshold, 60-day clock, individual/media/HHS notification paths. |

### §164.308(a)(7) Contingency Plan
| Requirement | Status | Notes |
|---|---|---|
| Data backup plan | 🟡 Partial | Cloud SQL automated backups — retention/test schedule TBD. |
| Disaster recovery plan | ⏳ TBD | Written DR plan needed; RTO/RPO undefined. |
| Emergency mode operation | ⏳ TBD | Could rely on Cloud Run multi-region, but no tested failover. |
| Testing and revision | ⏳ TBD | Restore from backup has not been exercised. |

### §164.308(a)(8) Evaluation
| Requirement | Status | Notes |
|---|---|---|
| Periodic technical evaluation | 🟡 Partial | Security prompts (00–32) act as an internal eval. External audit not done. |

### §164.308(b) Business Associate Contracts
| Requirement | Status | Notes |
|---|---|---|
| Written contract with BAs | 🟡 Partial | GCP BAA (assumed signed — confirm). Anthropic BAA pending. SendGrid TBD. |

---

## §164.310 — Physical Safeguards

| Requirement | Status | Notes |
|---|---|---|
| Facility access controls | ✅ | GCP data centers (covered under GCP BAA). |
| Workstation use / security | 🟡 Partial | Developer workstation is a Windows 11 laptop on OneDrive. **Risk:** OneDrive syncs repo contents; if `.env` or service-account keys landed locally, they'd sync. Verify `.gitignore` coverage and that no plaintext PHI backups live in OneDrive-synced folders. |
| Device & media controls | ⏳ TBD | No written media disposal policy. (Relevant when retiring hardware.) |

---

## §164.312 — Technical Safeguards (the load-bearing section)

### §164.312(a) Access Control
| Requirement | Status | Evidence (code) |
|---|---|---|
| Unique user identification | ✅ | UUID per user in `User.id`. |
| Emergency access procedure | 🟡 Partial | Admin role + audit log; written emergency-access policy TBD. |
| Automatic logoff | ✅ | 15-minute JWT access token; refresh token 7 days. Configured in `backend/src/config/index.ts` (`accessExpiresIn=900`, `refreshExpiresIn=604800`). |
| Encryption and decryption | ✅ | AES-256-GCM in `backend/src/services/encryption.ts`. Per-user keys via PBKDF2-SHA512 in `userEncryption.ts`. Field inventory in `prompts/_phi-inventory.md`. |

### §164.312(b) Audit Controls
| Requirement | Status | Evidence |
|---|---|---|
| Hardware, software, procedural mechanisms that record and examine activity | ✅ | `backend/src/services/auditLog.ts` writes to Postgres `audit_logs` table. 7-year retention scheduler. PHI values encrypted with system salt (survives user deletion). |

### §164.312(c) Integrity
| Requirement | Status | Evidence |
|---|---|---|
| Mechanism to authenticate ePHI | ✅ | AES-GCM provides authenticated encryption — any tampering produces decryption failure (not silent corruption). |
| Mechanism to corroborate ePHI has not been altered | 🟡 Partial | No application-level checksums beyond AES-GCM auth tag. Consider explicit checksums on file uploads (currently rely on GCS md5). |

### §164.312(d) Person or Entity Authentication
| Requirement | Status | Evidence |
|---|---|---|
| Authentication | ✅ | JWT (HttpOnly cookie) + bcrypt password + CSRF double-submit + email verification required + account lockout (5 attempts / 30 min). |

### §164.312(e) Transmission Security
| Requirement | Status | Evidence |
|---|---|---|
| Integrity controls | ✅ | TLS 1.3 on Cloud Run + GCS + Cloud SQL. |
| Encryption (during transmission) | ✅ | Same — all traffic over HTTPS. |

---

## Breach Notification Readiness (§164.400–§164.414)

| Requirement | Status | Notes |
|---|---|---|
| Detection procedures | 🟡 Partial | Audit log + Cloud Logging alerts (TBD) can surface anomalies. No formal detection playbook. |
| Individual notification process | ⏳ TBD | 60-day requirement once breach discovered. Template needed. |
| HHS notification process | ⏳ TBD | `https://ocrportal.hhs.gov/ocr/breach/` for breaches affecting >500 individuals (immediately), annual for <500. |
| Media notification (>500 in a state) | ⏳ TBD | Procedure and template needed. |
| Business associate notification | 🟡 Partial | Implicit via BAA terms; explicit written procedure TBD. |

---

## Required Documentation (§164.316)

| Document | Status |
|---|---|
| Written security policies & procedures | ⏳ TBD — Draft needed before beta |
| Risk Assessment (documented) | ⏳ TBD |
| Breach Notification Plan | ⏳ TBD |
| Privacy Policy (public) | ⏳ TBD |
| Terms of Service (public) | ⏳ TBD |
| BAAs (with vendors) | 🟡 Partial — GCP ✅ (confirm), Anthropic ⏳ |
| User consent (data use, AI processing) | ⏳ TBD |
| Data retention & destruction policy | 🟡 Partial — audit logs 7y documented; others TBD |
| Workforce training records | N/A (solo) |
| Incident response log | ⏳ TBD |

---

## PHI Inventory Summary

See `prompts/_phi-inventory.md` for the authoritative list. Summary of coverage:

| Category | Models | All fields encrypted? |
|---|---|---|
| Identity/profile | User | ✅ |
| Health data | Biomarker, BiomarkerHistory, HealthNeed, HealthGoal, GoalProgressHistory | ✅ |
| Insurance | InsurancePlan | ✅ |
| Expenses | ExpenseProjection, ExpenseActual, CostAnalysis | ✅ |
| Provider collaboration | ProviderPatient | ✅ |
| Audit | AuditLog | ✅ (system salt) |
| Deprecated | DNAVariant, GeneticTrait | ✅ (schema retained pending removal decision) |

---

## Compliance Roadmap

### Phase 1 — Foundation (current)
- [x] Technical controls implemented (AES-256-GCM, RLS, audit log, JWT, CSRF).
- [x] Per-user key management.
- [x] Rate limiting + cost control.
- [x] PHI redaction before external AI calls.
- [x] GCP BAA (assumed signed — confirm).
- [ ] **Anthropic BAA** ← blocker for production.

### Phase 2 — Documentation (before beta)
- [ ] Written Risk Assessment.
- [ ] Security Policies document.
- [ ] Breach Notification Plan.
- [ ] Privacy Policy (public).
- [ ] Terms of Service (public).
- [ ] DR plan with tested restore.

### Phase 3 — External validation (scaling)
- [ ] Penetration test by qualified third party.
- [ ] HIPAA gap assessment by HIPAA-specialized attorney/consultant.
- [ ] SOC 2 Type I (if pursuing enterprise customers).
- [ ] Ongoing quarterly risk review.

---

## How this document stays current

1. Re-run `prompts/22-hipaa-checklist-doc.md` quarterly.
2. After any schema change touching PHI — update `prompts/_phi-inventory.md` (authoritative source), this file auto-references.
3. Before every production deploy — run `prompts/24-full-security-audit.md`, update `SECURITY_STATUS.md`.

---

## Sections to fill via prompt 22

Open `prompts/22-hipaa-checklist-doc.md` §Questions to Ask:
- BAA dates signed (§Business Associate Agreements Q1–Q3)
- Designated compliance officer (§Administrative Q1)
- Physical safeguard posture (§Physical Q1–Q3)
- Compliance roadmap dates (§Compliance Roadmap Q1–Q3)
