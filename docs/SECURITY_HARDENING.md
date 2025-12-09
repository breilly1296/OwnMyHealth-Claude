# OwnMyHealth Security Hardening Guide

This guide covers security hardening for the OwnMyHealth production deployment on DigitalOcean (or similar VPS).

## Table of Contents

1. [Environment Configuration](#1-environment-configuration)
2. [Firewall Setup (UFW)](#2-firewall-setup-ufw)
3. [SSH Hardening](#3-ssh-hardening)
4. [Nginx Security Headers](#4-nginx-security-headers)
5. [Fail2ban Setup](#5-fail2ban-setup)
6. [Database Security](#6-database-security)
7. [SSL/TLS Configuration](#7-ssltls-configuration)
8. [Application Security Checklist](#8-application-security-checklist)

---

## 1. Environment Configuration

### Setting NODE_ENV to Production

The backend must run with `NODE_ENV=production` to enable security features:

```bash
# SSH into the server
ssh root@165.227.76.212

# Edit the backend environment file
nano /var/www/app/backend/.env
```

**Required changes to `/var/www/app/backend/.env`:**

```env
# Change from development to production
NODE_ENV=production

# Required secrets - generate new ones!
JWT_ACCESS_SECRET=<generate with: openssl rand -base64 32>
JWT_REFRESH_SECRET=<generate with: openssl rand -base64 32>
PHI_ENCRYPTION_KEY=<generate with: openssl rand -hex 32>

# CORS - your production domain only
CORS_ORIGIN=https://ownmyhealth.io

# Demo account (set to 'true' to keep demo login working)
ALLOW_DEMO_ACCOUNT=true

# Database
DATABASE_URL=postgresql://ownmyhealth:OwnMyHealth2024@localhost:5432/ownmyhealth
```

### Generate Secure Secrets

```bash
# Generate JWT secrets (run twice, one for each)
openssl rand -base64 32

# Generate PHI encryption key
openssl rand -hex 32
```

### Restart Backend

```bash
pm2 restart ownmyhealth-backend
pm2 logs ownmyhealth-backend --lines 20
```

### Production Security Features Enabled

When `NODE_ENV=production`:
- Cookies use `secure: true` (HTTPS only)
- Cookies use `sameSite: strict`
- CORS rejects localhost origins
- JWT secrets must be set and meet minimum length
- PHI encryption key validation

---

## 2. Firewall Setup (UFW)

### Install and Enable UFW

```bash
# Install UFW if not already installed
apt update && apt install ufw -y

# Set default policies
ufw default deny incoming
ufw default allow outgoing

# Allow essential ports
ufw allow 22/tcp    # SSH
ufw allow 80/tcp    # HTTP (redirects to HTTPS)
ufw allow 443/tcp   # HTTPS

# Enable UFW
ufw enable

# Check status
ufw status verbose
```

### Expected Output

```
Status: active
Logging: on (low)
Default: deny (incoming), allow (outgoing), disabled (routed)
New profiles: skip

To                         Action      From
--                         ------      ----
22/tcp                     ALLOW IN    Anywhere
80/tcp                     ALLOW IN    Anywhere
443/tcp                    ALLOW IN    Anywhere
22/tcp (v6)                ALLOW IN    Anywhere (v6)
80/tcp (v6)                ALLOW IN    Anywhere (v6)
443/tcp (v6)               ALLOW IN    Anywhere (v6)
```

### Important Notes

- PostgreSQL port (5432) is NOT exposed - only localhost access
- Backend port (3001) is NOT exposed - only accessed via Nginx reverse proxy
- This follows the principle of least privilege

---

## 3. SSH Hardening

### Change SSH Port (Optional but Recommended)

```bash
# Edit SSH config
nano /etc/ssh/sshd_config

# Find and change:
Port 2222  # Use a non-standard port

# Update firewall
ufw allow 2222/tcp
ufw delete allow 22/tcp

# Restart SSH
systemctl restart sshd
```

### Disable Root Login (After Creating Non-Root User)

```bash
# Create a new user
adduser ownmyhealth
usermod -aG sudo ownmyhealth

# Copy SSH keys to new user
mkdir -p /home/ownmyhealth/.ssh
cp /root/.ssh/authorized_keys /home/ownmyhealth/.ssh/
chown -R ownmyhealth:ownmyhealth /home/ownmyhealth/.ssh
chmod 700 /home/ownmyhealth/.ssh
chmod 600 /home/ownmyhealth/.ssh/authorized_keys

# Test login with new user before disabling root!
# In a NEW terminal:
ssh ownmyhealth@165.227.76.212

# If successful, disable root login
nano /etc/ssh/sshd_config
# Set: PermitRootLogin no

systemctl restart sshd
```

### Disable Password Authentication

```bash
# Edit SSH config
nano /etc/ssh/sshd_config

# Ensure these settings:
PasswordAuthentication no
PubkeyAuthentication yes
ChallengeResponseAuthentication no

# Restart SSH
systemctl restart sshd
```

---

## 4. Nginx Security Headers

### Update Nginx Configuration

```bash
nano /etc/nginx/sites-available/ownmyhealth
```

**Full secure configuration:**

```nginx
# Rate limiting zone
limit_req_zone $binary_remote_addr zone=api_limit:10m rate=10r/s;

server {
    listen 80;
    server_name ownmyhealth.io www.ownmyhealth.io;
    return 301 https://$server_name$request_uri;
}

server {
    listen 443 ssl http2;
    server_name ownmyhealth.io www.ownmyhealth.io;

    # SSL Configuration (Let's Encrypt)
    ssl_certificate /etc/letsencrypt/live/ownmyhealth.io/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/ownmyhealth.io/privkey.pem;

    # SSL Security Settings
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers ECDHE-ECDSA-AES128-GCM-SHA256:ECDHE-RSA-AES128-GCM-SHA256:ECDHE-ECDSA-AES256-GCM-SHA384:ECDHE-RSA-AES256-GCM-SHA384:ECDHE-ECDSA-CHACHA20-POLY1305:ECDHE-RSA-CHACHA20-POLY1305:DHE-RSA-AES128-GCM-SHA256:DHE-RSA-AES256-GCM-SHA384;
    ssl_prefer_server_ciphers off;
    ssl_session_timeout 1d;
    ssl_session_cache shared:SSL:50m;
    ssl_session_tickets off;

    # OCSP Stapling
    ssl_stapling on;
    ssl_stapling_verify on;
    resolver 8.8.8.8 8.8.4.4 valid=300s;
    resolver_timeout 5s;

    # Security Headers
    add_header X-Frame-Options "SAMEORIGIN" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header X-XSS-Protection "1; mode=block" always;
    add_header Referrer-Policy "strict-origin-when-cross-origin" always;
    add_header Permissions-Policy "camera=(), microphone=(), geolocation=()" always;

    # HSTS (enable after confirming HTTPS works)
    add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;

    # Content Security Policy
    add_header Content-Security-Policy "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; font-src 'self'; connect-src 'self' https://ownmyhealth.io;" always;

    # Frontend static files
    root /var/www/app/dist;
    index index.html;

    # Gzip compression
    gzip on;
    gzip_types text/plain text/css application/json application/javascript text/xml application/xml;
    gzip_min_length 1000;

    # API proxy with rate limiting
    location /api/ {
        limit_req zone=api_limit burst=20 nodelay;

        proxy_pass http://127.0.0.1:3001;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;

        # Timeouts
        proxy_connect_timeout 60s;
        proxy_send_timeout 60s;
        proxy_read_timeout 60s;
    }

    # SPA routing - serve index.html for all non-API routes
    location / {
        try_files $uri $uri/ /index.html;
    }

    # Block access to hidden files
    location ~ /\. {
        deny all;
    }

    # Block access to sensitive files
    location ~* \.(env|git|gitignore|dockerignore)$ {
        deny all;
    }
}
```

### Test and Apply

```bash
# Test configuration
nginx -t

# If successful, reload
systemctl reload nginx
```

---

## 5. Fail2ban Setup

Fail2ban protects against brute force attacks.

### Install Fail2ban

```bash
apt install fail2ban -y
```

### Configure for SSH

```bash
# Create local config
cp /etc/fail2ban/jail.conf /etc/fail2ban/jail.local
nano /etc/fail2ban/jail.local
```

**Key settings:**

```ini
[DEFAULT]
bantime = 1h
findtime = 10m
maxretry = 5
banaction = ufw

[sshd]
enabled = true
port = ssh  # or your custom port like 2222
filter = sshd
logpath = /var/log/auth.log
maxretry = 3
bantime = 24h
```

### Configure for Nginx (Optional)

```bash
nano /etc/fail2ban/jail.local
```

Add:

```ini
[nginx-http-auth]
enabled = true
filter = nginx-http-auth
port = http,https
logpath = /var/log/nginx/error.log
maxretry = 5

[nginx-limit-req]
enabled = true
filter = nginx-limit-req
port = http,https
logpath = /var/log/nginx/error.log
maxretry = 10
findtime = 1m
bantime = 1h
```

### Start Fail2ban

```bash
systemctl enable fail2ban
systemctl start fail2ban
systemctl status fail2ban

# Check banned IPs
fail2ban-client status sshd
```

---

## 6. Database Security

### PostgreSQL Access Control

The database should only accept local connections.

```bash
# Check PostgreSQL config
nano /etc/postgresql/*/main/pg_hba.conf
```

**Ensure only local connections:**

```
# TYPE  DATABASE        USER            ADDRESS                 METHOD
local   all             all                                     peer
host    all             all             127.0.0.1/32            md5
host    all             all             ::1/128                 md5
# NO external host entries!
```

### Change Database Password

```bash
sudo -u postgres psql
```

```sql
ALTER USER ownmyhealth WITH PASSWORD 'NewSecurePassword123!';
\q
```

**Update backend .env with new password:**

```bash
nano /var/www/app/backend/.env
# Update DATABASE_URL with new password
pm2 restart ownmyhealth-backend
```

### Regular Backups

```bash
# Create backup script
nano /root/backup-db.sh
```

```bash
#!/bin/bash
BACKUP_DIR="/root/backups"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
mkdir -p $BACKUP_DIR

# Backup database
sudo -u postgres pg_dump ownmyhealth > "$BACKUP_DIR/ownmyhealth_$TIMESTAMP.sql"

# Keep only last 7 days
find $BACKUP_DIR -name "*.sql" -mtime +7 -delete

echo "Backup completed: ownmyhealth_$TIMESTAMP.sql"
```

```bash
chmod +x /root/backup-db.sh

# Add to crontab (daily at 2 AM)
crontab -e
# Add: 0 2 * * * /root/backup-db.sh >> /var/log/db-backup.log 2>&1
```

---

## 7. SSL/TLS Configuration

### Verify SSL Certificate

```bash
# Check certificate expiry
certbot certificates

# Test auto-renewal
certbot renew --dry-run
```

### Force HTTPS Redirect

Already handled in Nginx config (port 80 returns 301 to HTTPS).

### Test SSL Configuration

Use SSL Labs: https://www.ssllabs.com/ssltest/analyze.html?d=ownmyhealth.io

Target: A+ rating

---

## 8. Application Security Checklist

### Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `NODE_ENV` | Yes | Must be `production` |
| `JWT_ACCESS_SECRET` | Yes | Min 32 chars, generated randomly |
| `JWT_REFRESH_SECRET` | Yes | Min 32 chars, generated randomly |
| `PHI_ENCRYPTION_KEY` | Yes | 64 hex chars (256 bits) |
| `DATABASE_URL` | Yes | PostgreSQL connection string |
| `CORS_ORIGIN` | Yes | `https://ownmyhealth.io` |
| `ALLOW_DEMO_ACCOUNT` | Optional | `true` to enable demo login |

### Security Features Status

Run this after configuration to verify:

```bash
# Check backend is running in production mode
pm2 logs ownmyhealth-backend --lines 5 | grep "Environment:"

# Check firewall status
ufw status

# Check fail2ban status
fail2ban-client status

# Check SSL certificate
curl -I https://ownmyhealth.io

# Check security headers
curl -I https://ownmyhealth.io | grep -E "(X-Frame|X-Content|Strict-Transport|Content-Security)"
```

---

## Quick Setup Script

For convenience, here's a script that applies the essential security settings:

```bash
#!/bin/bash
# save as: /root/security-setup.sh

echo "=== OwnMyHealth Security Setup ==="

# 1. UFW Firewall
echo "[1/4] Configuring firewall..."
ufw default deny incoming
ufw default allow outgoing
ufw allow 22/tcp
ufw allow 80/tcp
ufw allow 443/tcp
echo "y" | ufw enable
ufw status

# 2. Fail2ban
echo "[2/4] Installing fail2ban..."
apt update && apt install fail2ban -y
systemctl enable fail2ban
systemctl start fail2ban

# 3. Automatic security updates
echo "[3/4] Enabling automatic security updates..."
apt install unattended-upgrades -y
dpkg-reconfigure -plow unattended-upgrades

# 4. Reminder for manual steps
echo ""
echo "=== MANUAL STEPS REQUIRED ==="
echo "1. Update /var/www/app/backend/.env:"
echo "   - Set NODE_ENV=production"
echo "   - Generate new JWT secrets"
echo "   - Generate new PHI_ENCRYPTION_KEY"
echo "   - Set ALLOW_DEMO_ACCOUNT=true (if needed)"
echo ""
echo "2. Update Nginx config with security headers"
echo "3. Run: pm2 restart ownmyhealth-backend"
echo "4. Run: nginx -t && systemctl reload nginx"
echo ""
echo "=== Security setup complete ==="
```

---

## Summary Commands

```bash
# SSH to server
ssh root@165.227.76.212

# Check backend status
pm2 status && pm2 logs ownmyhealth-backend --lines 10

# Restart backend after .env changes
pm2 restart ownmyhealth-backend

# Test and reload nginx
nginx -t && systemctl reload nginx

# Check firewall
ufw status verbose

# Check fail2ban
fail2ban-client status

# Check SSL certificate
certbot certificates
```

---

## Rollback

If issues occur after enabling production mode:

```bash
# Temporarily revert to development mode
nano /var/www/app/backend/.env
# Set NODE_ENV=development
pm2 restart ownmyhealth-backend
```

---

## Security Contacts

For security issues or questions:
- GitHub: https://github.com/anthropics/claude-code/issues
- SSL monitoring: Set up alerts with services like UptimeRobot
