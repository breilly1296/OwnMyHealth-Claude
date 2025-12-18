---
tags: [security, devops, critical]
type: prompt
priority: 1
---

# Environment & Secrets Review

## Files to Review
- `backend/.env.example` (reference template)
- `backend/.env.production.example` (production template)
- `backend/src/config/index.ts` (configuration loading)
- `.gitignore` (ensure secrets not committed)
- `railway.toml` (deployment config)

## OwnMyHealth Environment Architecture

- **Framework**: dotenv for environment loading
- **Validation**: Production requires all critical variables
- **Security**: Fatal errors for missing/weak secrets in production

## Required Environment Variables

### Critical Security (MUST be unique per environment)

| Variable | Purpose | Requirements |
|----------|---------|--------------|
| `JWT_ACCESS_SECRET` | Sign access tokens | 32+ chars, random |
| `JWT_REFRESH_SECRET` | Sign refresh tokens | 32+ chars, random, different from access |
| `PHI_ENCRYPTION_KEY` | Encrypt PHI data | 64 hex chars (256 bits) |
| `DATABASE_URL` | PostgreSQL connection | Valid connection string |

### Configuration Variables

| Variable | Default | Purpose |
|----------|---------|---------|
| `NODE_ENV` | development | Environment mode |
| `PORT` | 3001 | Server port |
| `JWT_ACCESS_EXPIRES_IN` | 15m | Access token expiry |
| `JWT_REFRESH_EXPIRES_IN` | 7d | Refresh token expiry |
| `MAX_LOGIN_ATTEMPTS` | 5 | Lockout threshold |
| `LOCKOUT_DURATION_MINUTES` | 30 | Lockout duration |
| `BCRYPT_ROUNDS` | 12 | Password hashing cost |

### External Services

| Variable | Purpose | Required |
|----------|---------|----------|
| `CMS_API_KEY` | Healthcare.gov API | Optional |
| `SENDGRID_API_KEY` | Email service | Optional |
| `FRONTEND_URL` | Email links | For emails |

## Checklist

### 1. Secret Generation
- [ ] JWT secrets generated with `openssl rand -base64 32`
- [ ] PHI key generated with `openssl rand -hex 32`
- [ ] Secrets are unique per environment (dev/staging/prod)
- [ ] Secrets not shared between developers

### 2. Production Validation (config/index.ts)
The following checks MUST run in production:
- [ ] `JWT_ACCESS_SECRET` exists and >= 32 chars
- [ ] `JWT_REFRESH_SECRET` exists and >= 32 chars
- [ ] `PHI_ENCRYPTION_KEY` exists and is 64+ hex chars
- [ ] `DATABASE_URL` exists
- [ ] Secrets not using default/placeholder values

### 3. Placeholder Key Detection
Config should reject these in production:
- [ ] `access-secret-change-in-production`
- [ ] `refresh-secret-change-in-production`
- [ ] `0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef`
- [ ] All zeros encryption key
- [ ] All f's encryption key

### 4. .gitignore Verification
These files MUST be in .gitignore:
- [ ] `.env`
- [ ] `.env.local`
- [ ] `.env.production`
- [ ] `backend/.env`
- [ ] `*.pem` (certificates)
- [ ] `*.key` (private keys)

### 5. Example Files
`.env.example` files should:
- [ ] Document ALL variables
- [ ] Show format/requirements
- [ ] Use placeholder values only
- [ ] Include generation commands
- [ ] Have production checklist

### 6. Cookie Configuration
- [ ] `COOKIE_SECURE` = true in production
- [ ] `COOKIE_SAME_SITE` = 'strict' in production
- [ ] `COOKIE_DOMAIN` set for cross-subdomain if needed

### 7. CORS Configuration
- [ ] `CORS_ORIGIN` set to actual frontend domain in production
- [ ] NOT allowing `localhost` in production
- [ ] Warning logged if localhost in prod CORS

### 8. Demo Account Security
- [ ] `DEMO_ACCOUNT_ENABLED` NOT true in production
- [ ] If enabled, `DEMO_EMAIL` and `DEMO_PASSWORD` required
- [ ] Warning logged if demo mode in production

### 9. Rate Limiting
- [ ] `RATE_LIMIT_WINDOW_MS` reasonable (default 15min)
- [ ] `RATE_LIMIT_MAX_REQUESTS` not too high (default 100)

### 10. Database Security
- [ ] `DATABASE_URL` uses SSL in production
- [ ] Connection string not logged
- [ ] Credentials not in code

## Production Checklist (from .env.example)

```bash
# Before deploying, verify:
[ ] NODE_ENV=production
[ ] Generated JWT_ACCESS_SECRET (openssl rand -base64 32)
[ ] Generated JWT_REFRESH_SECRET (openssl rand -base64 32)
[ ] Generated PHI_ENCRYPTION_KEY (openssl rand -hex 32)
[ ] DATABASE_URL pointing to production DB with SSL
[ ] CORS_ORIGIN set to frontend domain
[ ] HTTPS/TLS configured
[ ] Secrets stored in secrets manager (not env file)
[ ] PHI_ENCRYPTION_KEY backed up securely
```

## Secret Management Recommendations

### Development
- Use `.env` file (gitignored)
- Share via secure channel (1Password, etc.)

### Production
- Use secrets manager (AWS Secrets Manager, HashiCorp Vault)
- Railway: Use encrypted environment variables
- Rotate secrets periodically

### Backup
- **CRITICAL**: Backup `PHI_ENCRYPTION_KEY`
- If lost, all encrypted PHI is unrecoverable
- Store in multiple secure locations

## Check Git History

Run this command to verify no secrets were committed:
```bash
git log --oneline -20 -- "*.env*"
```

## Red Flags
- `.env` committed to git
- Production using default secrets
- Same secrets in dev and prod
- JWT secrets < 32 characters
- PHI key not 256 bits
- CORS allowing * or localhost in prod
- Demo mode enabled in production
- Database URL without SSL in production
- Secrets logged or printed
