---
tags: [security, devops]
type: prompt
priority: 3
---

# CI/CD Security Review

## Files to Review
- `.github/workflows/*.yml` (GitHub Actions)
- `railway.toml` (Railway deployment)
- `Dockerfile` or `docker-compose.yml` (if present)
- `package.json` scripts
- `DEPLOY.md` (deployment documentation)

## OwnMyHealth Deployment Architecture

- **Hosting**: Railway (or AWS ECS Fargate per CLAUDE.md)
- **Database**: PostgreSQL (Railway or AWS RDS)
- **CI/CD**: GitHub Actions (if configured)

## Checklist

### 1. GitHub Actions Secrets
If using GitHub Actions:
- [ ] Secrets stored in GitHub Secrets (not in workflow files)
- [ ] `JWT_ACCESS_SECRET` in secrets
- [ ] `JWT_REFRESH_SECRET` in secrets
- [ ] `PHI_ENCRYPTION_KEY` in secrets
- [ ] `DATABASE_URL` in secrets
- [ ] No secrets in workflow logs (`::add-mask::`)

### 2. Workflow Security
- [ ] Actions pinned to specific versions (not `@latest`)
- [ ] `pull_request` triggers don't have write permissions
- [ ] GITHUB_TOKEN has minimal permissions
- [ ] No execution of arbitrary code from PRs
- [ ] Dependency review before deployment

### 3. Railway Configuration (railway.toml)
- [ ] Environment variables set in Railway dashboard (not in toml)
- [ ] Health check endpoint configured
- [ ] Proper start command
- [ ] Build command runs `prisma generate`

### 4. Build Security
- [ ] Dependencies audited (`npm audit`)
- [ ] No high/critical vulnerabilities
- [ ] Lock file committed (`package-lock.json`)
- [ ] Build fails on vulnerability

### 5. Deployment Checklist
Before each deployment:
- [ ] All tests passing
- [ ] TypeScript compiles without errors
- [ ] No console warnings/errors
- [ ] Environment variables verified
- [ ] Database migrations run
- [ ] Health check passes

### 6. Database Migrations
- [ ] Migrations run as separate step (not on every start)
- [ ] Migration rollback plan exists
- [ ] No data loss in migrations
- [ ] Production migrations reviewed

### 7. Container Security (if using Docker)
- [ ] Base image from official source
- [ ] Non-root user in container
- [ ] No secrets in Dockerfile
- [ ] Multi-stage build (smaller image)
- [ ] No unnecessary packages

### 8. Network Security
- [ ] HTTPS enforced
- [ ] HTTP redirects to HTTPS
- [ ] HSTS header enabled
- [ ] TLS 1.2+ only
- [ ] Certificate valid and auto-renewed

### 9. Logging Security
- [ ] No secrets in logs
- [ ] No PHI in logs
- [ ] Logs retained appropriately
- [ ] Logs encrypted at rest
- [ ] Access to logs restricted

### 10. Rollback Capability
- [ ] Previous version can be deployed quickly
- [ ] Database changes are reversible
- [ ] Environment variables backed up
- [ ] Rollback tested

## Deployment Process

### Pre-Deployment
```bash
# 1. Run tests
npm test

# 2. Check for vulnerabilities
npm audit

# 3. Build
npm run build

# 4. Type check
npx tsc --noEmit
```

### Deployment
```bash
# 1. Run database migrations
npx prisma migrate deploy

# 2. Deploy application
# (Railway auto-deploys on push)

# 3. Verify health check
curl https://api.yourapp.com/api/v1/health
```

### Post-Deployment
- [ ] Verify health endpoint
- [ ] Check error logs
- [ ] Test critical paths (login, PHI access)
- [ ] Monitor for increased errors

## Security Scanning

### Dependencies
```bash
# Check for vulnerabilities
npm audit

# Check for outdated packages
npm outdated
```

### Code
- [ ] ESLint security rules enabled
- [ ] No `eval()` usage
- [ ] No `dangerouslySetInnerHTML` with user input
- [ ] TypeScript strict mode

### Secrets
- [ ] git-secrets or similar to prevent secret commits
- [ ] Pre-commit hook checks for secrets
- [ ] Automated secret scanning in CI

## Monitoring & Alerting

- [ ] Error rate monitoring
- [ ] Response time monitoring
- [ ] Failed login attempt alerts
- [ ] Audit log monitoring
- [ ] Database connection monitoring
- [ ] Disk/memory usage alerts

## Incident Response

- [ ] Incident response plan documented
- [ ] Contact list for security issues
- [ ] Steps for revoking compromised secrets
- [ ] Steps for forced user logout
- [ ] Backup restoration procedure

## Red Flags
- Secrets in workflow files
- Secrets logged during build
- No vulnerability scanning
- Manual deployments without review
- No rollback capability
- Missing health checks
- HTTP allowed in production
- Logs containing PHI
- No monitoring/alerting
