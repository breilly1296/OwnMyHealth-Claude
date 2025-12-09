# OwnMyHealth Security Guide

## Quick Security Hardening

SSH into the server and run:

```bash
ssh root@165.227.76.212
cd /var/www/app
bash scripts/security-harden.sh
```

Or run manually:

### 1. Set Production Mode (Disables Demo Login)

```bash
# Edit backend .env
nano /var/www/app/backend/.env

# Change this line:
NODE_ENV=production

# Restart backend
pm2 restart ownmyhealth-backend
```

### 2. Enable Firewall

```bash
# Allow only SSH, HTTP, HTTPS
ufw allow 22/tcp
ufw allow 80/tcp
ufw allow 443/tcp
ufw enable
ufw status
```

### 3. Install fail2ban

```bash
apt-get update && apt-get install -y fail2ban

# Create config
cat > /etc/fail2ban/jail.local << 'EOF'
[sshd]
enabled = true
maxretry = 3
bantime = 3600
EOF

systemctl restart fail2ban
systemctl enable fail2ban
```

### 4. Change Database Password

```bash
# Generate new password
NEW_PASS=$(openssl rand -base64 24 | tr -dc 'a-zA-Z0-9' | head -c 24)
echo "New password: $NEW_PASS"

# Update PostgreSQL
sudo -u postgres psql -c "ALTER USER ownmyhealth WITH PASSWORD '$NEW_PASS';"

# Update backend .env DATABASE_URL
nano /var/www/app/backend/.env

# Restart backend
pm2 restart ownmyhealth-backend
```

### 5. Rotate JWT Secrets

```bash
# Generate new secrets
openssl rand -base64 48  # For JWT_ACCESS_SECRET
openssl rand -base64 48  # For JWT_REFRESH_SECRET

# Update in .env
nano /var/www/app/backend/.env

# Restart (this will invalidate all existing sessions)
pm2 restart ownmyhealth-backend
```

---

## Security Checklist

| Item | Command to Verify | Status |
|------|-------------------|--------|
| NODE_ENV=production | `grep NODE_ENV /var/www/app/backend/.env` | [ ] |
| Firewall enabled | `ufw status` | [ ] |
| fail2ban running | `systemctl status fail2ban` | [ ] |
| Default DB password changed | Check .env | [ ] |
| JWT secrets are unique | Check .env | [ ] |
| SSL certificate valid | `certbot certificates` | [ ] |
| Demo login blocked | Try logging in as demo | [ ] |

---

## Environment Variables Security

### Required for Production

```bash
# MUST be set
NODE_ENV=production
DATABASE_URL=postgresql://user:STRONG_PASSWORD@localhost:5432/ownmyhealth
JWT_ACCESS_SECRET=<random-64-char-string>
JWT_REFRESH_SECRET=<random-64-char-string>
PHI_ENCRYPTION_KEY=<64-hex-chars>

# MUST match your domain
CORS_ORIGIN=https://ownmyhealth.io
```

### Generate Secure Values

```bash
# JWT secrets (64 chars)
openssl rand -base64 48

# PHI encryption key (64 hex chars = 256 bits)
openssl rand -hex 32

# Database password
openssl rand -base64 24 | tr -dc 'a-zA-Z0-9' | head -c 24
```

---

## HIPAA Considerations

### Data at Rest
- [x] Database fields encrypted (AES-256-GCM)
- [x] Per-user encryption keys
- [ ] Database backups encrypted
- [ ] File storage encrypted

### Data in Transit
- [x] HTTPS enforced (TLS 1.2+)
- [x] Secure cookies (HttpOnly, Secure, SameSite)
- [x] CSRF protection

### Access Controls
- [x] Authentication required
- [x] Session management
- [x] Password hashing (bcrypt)
- [x] Account lockout

### Audit Logging
- [x] All PHI access logged
- [x] Audit logs encrypted
- [x] 7-year retention capability

### Missing for Full HIPAA Compliance
- [ ] Business Associate Agreements (BAAs)
- [ ] Formal security policies
- [ ] Regular security audits
- [ ] Incident response plan
- [ ] Employee training documentation

---

## Monitoring

### Check fail2ban Status

```bash
# View banned IPs
fail2ban-client status sshd

# Unban an IP
fail2ban-client set sshd unbanip 1.2.3.4
```

### Check for Attacks

```bash
# Failed SSH attempts
grep "Failed password" /var/log/auth.log | tail -20

# Nginx errors
tail -100 /var/log/nginx/error.log

# Backend errors
pm2 logs ownmyhealth-backend --lines 100 --err
```

### SSL Certificate Expiry

```bash
# Check when cert expires
certbot certificates

# Test auto-renewal
certbot renew --dry-run
```

---

## Incident Response

### If You Suspect a Breach

1. **Contain**: Disable the affected service
   ```bash
   pm2 stop ownmyhealth-backend
   ```

2. **Preserve**: Don't modify logs
   ```bash
   cp -r /var/log /root/incident-logs-$(date +%Y%m%d)
   ```

3. **Investigate**: Check logs
   ```bash
   grep -i "error\|fail\|invalid" /var/log/nginx/access.log
   pm2 logs ownmyhealth-backend --lines 1000
   ```

4. **Rotate**: Change all credentials
   ```bash
   # New JWT secrets
   # New database password
   # New PHI key (if data compromised)
   ```

5. **Notify**: If PHI exposed, HIPAA requires notification within 60 days

---

## Backup Security

### Encrypted Database Backup

```bash
# Backup with encryption
pg_dump -U ownmyhealth ownmyhealth | \
  gpg --symmetric --cipher-algo AES256 > backup_$(date +%Y%m%d).sql.gpg

# Restore
gpg -d backup_20240115.sql.gpg | psql -U ownmyhealth ownmyhealth
```

### Secure Backup Storage

Backups should be stored:
- Encrypted at rest
- In a different geographic location
- With access controls
- With retention policy (keep 30 days minimum)
