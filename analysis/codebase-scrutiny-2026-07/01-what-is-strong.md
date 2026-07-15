# 01 — What Is Genuinely Strong

Ripping a codebase only has credibility if the good parts are named accurately.

---

## 1. Application-layer PHI encryption

- AES-256-GCM with per-user derived keys (master key + user salt)
- Key validation rejects known placeholders in **every** environment (not only production)
- PBKDF2 iteration hardening (current 600k, legacy 100k fallback) with explicit migration debt notes
- PHI field inventory and encrypt/decrypt helpers treated as first-class, not ad hoc

This is not “TLS and hope.” Field-level encryption is real engineering.

---

## 2. Postgres FORCE RLS + boot hard-exits

- Multi-tenant isolation at the database layer with FORCE RLS
- Production hard-exit if the DB role has `BYPASSRLS`
- Production hard-exit if RLS-enabled tables are not FORCE-protected
- Live-Postgres RLS regression path in CI (gated, intentional)

Correct failure mode for PHI multi-tenancy: **refuse to boot**, do not “log a warning and continue.”

---

## 3. Auth model (not amateur JWT-in-localStorage)

- JWT access + refresh with short access lifetime (~15 min)
- httpOnly cookies for tokens; CSRF double-submit cookie
- Account lockout after failed attempts
- DB-backed sessions
- Cross-instance revocation via `tokensValidAfter` + `revoked_access_tokens` (jti)
- Login anti-enumeration work (dummy bcrypt work, jitter) documented and tested

---

## 4. Defense-in-depth culture

Examples present in the stack:

- Helmet security headers on the API
- Rate limiting (with pluggable Redis store when configured)
- Plan gating with fail-closed behavior on DB errors for plan lookup
- AI spend guard for Claude (fail-closed 503 at budget)
- Secure PDF parsing guards (size / time / page limits / bomb resistance)
- Anthropic BAA boot gate when API key is set without `ANTHROPIC_BAA_ACTIVE`
- Audit logging with long retention design
- Deploy gated on full CI (`needs: ci`)

---

## 5. Self-awareness in source comments

Several residual issues are **documented in code** (TOCTOU races, multi-instance PKCE store, encryption iteration migration, CSP nonce TODO). That is healthier than silent bugs — even when the issues remain open.

---

## Judgment

If this were only a **security homework / vault engineering** project, it would be an impressive solo/AI-assisted result.

It is not only that. It is supposed to be a **consumer health product**. Strengths of the vault do not cancel weaknesses of the product surface. See [02-product-honesty-gap.md](./02-product-honesty-gap.md).
