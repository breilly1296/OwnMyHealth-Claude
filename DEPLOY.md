# OwnMyHealth Production Deployment Guide

## Live Environment

| Item | Value |
|------|-------|
| **URL** | https://ownmyhealth.io |
| **Server** | DigitalOcean Droplet |
| **IP Address** | 165.227.76.212 |
| **OS** | Ubuntu 24.04 LTS |
| **Domain Registrar** | Porkbun |

### Demo Account
```
Email: demo@ownmyhealth.com
Password: Demo123!
```

---

## Infrastructure Overview

```
                    ┌─────────────────────────────────────────┐
                    │         DigitalOcean Droplet            │
                    │           165.227.76.212                │
    Internet        │  ┌─────────────────────────────────┐    │
        │           │  │           Nginx                 │    │
        │    443    │  │   - SSL termination             │    │
        ▼    ───────┼──►   - Static files (/dist)        │    │
   ownmyhealth.io   │  │   - Reverse proxy → :3001       │    │
                    │  └─────────────┬───────────────────┘    │
                    │                │                        │
                    │                ▼                        │
                    │  ┌─────────────────────────────────┐    │
                    │  │     Node.js/Express (PM2)       │    │
                    │  │         Port 3001               │    │
                    │  │     /var/www/app/backend        │    │
                    │  └─────────────┬───────────────────┘    │
                    │                │                        │
                    │                ▼                        │
                    │  ┌─────────────────────────────────┐    │
                    │  │        PostgreSQL               │    │
                    │  │     Database: ownmyhealth       │    │
                    │  │     User: ownmyhealth           │    │
                    │  └─────────────────────────────────┘    │
                    └─────────────────────────────────────────┘
```

---

## SSH Access

```bash
ssh root@165.227.76.212
```

---

## Directory Structure

```
/var/www/app/
├── .env                    # Frontend environment variables
├── dist/                   # Built frontend (served by Nginx)
├── index.html              # Entry point with crypto polyfill
├── src/                    # Frontend source
├── package.json
│
└── backend/
    ├── .env                # Backend environment variables
    ├── dist/               # Compiled TypeScript
    │   └── generated/      # Prisma client (copied here)
    ├── src/                # Backend source
    ├── prisma/
    │   └── schema.prisma   # Database schema
    └── package.json
```

---

## Environment Variables

### Frontend (`/var/www/app/.env`)

```bash
VITE_API_URL=https://ownmyhealth.io/api/v1
```

### Backend (`/var/www/app/backend/.env`)

```bash
# Database
DATABASE_URL=postgresql://ownmyhealth:OwnMyHealth2024@localhost:5432/ownmyhealth

# Security
NODE_ENV=development          # NOTE: Set to 'production' for real use
JWT_ACCESS_SECRET=<generated>
JWT_REFRESH_SECRET=<generated>
PHI_ENCRYPTION_KEY=<64-char-hex>

# Server
PORT=3001
CORS_ORIGIN=https://ownmyhealth.io

# JWT Expiration
JWT_ACCESS_EXPIRES_IN=15m
JWT_REFRESH_EXPIRES_IN=7d
```

> **Note:** `NODE_ENV=development` allows demo account login. Change to `production` and disable demo for real deployment.

---

## Key Configuration Files

### Nginx (`/etc/nginx/sites-available/ownmyhealth`)

```nginx
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
    include /etc/letsencrypt/options-ssl-nginx.conf;
    ssl_dhparam /etc/letsencrypt/ssl-dhparams.pem;

    # Frontend (static files)
    root /var/www/app/dist;
    index index.html;

    # API proxy to backend
    location /api/ {
        proxy_pass http://localhost:3001;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
    }

    # SPA fallback
    location / {
        try_files $uri $uri/ /index.html;
    }
}
```

### PM2 Process Manager

The backend runs as a PM2 process named `ownmyhealth-backend`.

```bash
# View status
pm2 status

# View logs
pm2 logs ownmyhealth-backend

# Restart
pm2 restart ownmyhealth-backend

# Stop
pm2 stop ownmyhealth-backend

# Start (if not running)
cd /var/www/app/backend
pm2 start dist/index.js --name ownmyhealth-backend
pm2 save
```

---

## Common Operations

### Rebuild Frontend

```bash
cd /var/www/app
npm run build
```

### Rebuild Backend

```bash
cd /var/www/app/backend
npm run build
# Copy Prisma client to dist
cp -r node_modules/.prisma dist/
cp -r node_modules/@prisma dist/
pm2 restart ownmyhealth-backend
```

### Restart Nginx

```bash
nginx -t                      # Test configuration
systemctl restart nginx       # Restart
systemctl status nginx        # Check status
```

### Database Operations

```bash
# Connect to PostgreSQL
sudo -u postgres psql -d ownmyhealth

# Run migrations
cd /var/www/app/backend
npx prisma migrate deploy

# Reset database (DESTRUCTIVE)
npx prisma migrate reset

# Open Prisma Studio
npx prisma studio
```

### Pull Latest Code

```bash
cd /var/www/app
git pull origin claude/analyze-project-016vBAbATRFw1zFjWoPrxevp

# Rebuild frontend
npm install
npm run build

# Rebuild backend
cd backend
npm install
npm run build
cp -r node_modules/.prisma dist/
cp -r node_modules/@prisma dist/
npx prisma migrate deploy
pm2 restart ownmyhealth-backend
```

---

## SSL Certificate

SSL is managed by Let's Encrypt via Certbot. Certificates auto-renew.

```bash
# Check certificate status
certbot certificates

# Force renewal
certbot renew --force-renewal

# Test renewal (dry run)
certbot renew --dry-run
```

---

## DNS Configuration (Porkbun)

| Type | Name | Value | TTL |
|------|------|-------|-----|
| A | @ | 165.227.76.212 | 600 |
| A | www | 165.227.76.212 | 600 |

---

## Database Details

| Item | Value |
|------|-------|
| **Host** | localhost |
| **Port** | 5432 |
| **Database** | ownmyhealth |
| **Username** | ownmyhealth |
| **Password** | OwnMyHealth2024 |

```bash
# Connection string
postgresql://ownmyhealth:OwnMyHealth2024@localhost:5432/ownmyhealth
```

---

## Logs

```bash
# Backend application logs
pm2 logs ownmyhealth-backend
pm2 logs ownmyhealth-backend --lines 100

# Nginx access logs
tail -f /var/log/nginx/access.log

# Nginx error logs
tail -f /var/log/nginx/error.log

# System logs
journalctl -u nginx -f
```

---

## Troubleshooting

### Backend won't start

```bash
# Check PM2 logs
pm2 logs ownmyhealth-backend --lines 50

# Check if port 3001 is in use
lsof -i :3001

# Verify environment variables
cat /var/www/app/backend/.env

# Verify Prisma client exists
ls /var/www/app/backend/dist/generated/
```

### Frontend shows blank page

```bash
# Check if dist exists
ls /var/www/app/dist/

# Check Nginx configuration
nginx -t

# Check frontend .env
cat /var/www/app/.env
```

### API returns 502 Bad Gateway

```bash
# Backend not running - restart it
pm2 restart ownmyhealth-backend

# Check if backend is listening
curl http://localhost:3001/api/v1/health
```

### Database connection failed

```bash
# Check PostgreSQL is running
systemctl status postgresql

# Test connection
sudo -u postgres psql -d ownmyhealth -c "SELECT 1;"

# Check backend .env DATABASE_URL
cat /var/www/app/backend/.env | grep DATABASE_URL
```

### CORS errors

```bash
# Verify CORS_ORIGIN in backend .env
cat /var/www/app/backend/.env | grep CORS_ORIGIN

# Should be: CORS_ORIGIN=https://ownmyhealth.io
```

### crypto.randomUUID not defined

This was fixed by adding a polyfill in `index.html`. If it reappears:

```html
<!-- Add to index.html <head> section -->
<script>
  if (typeof crypto !== 'undefined' && !crypto.randomUUID) {
    crypto.randomUUID = function() {
      return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
        var r = Math.random() * 16 | 0, v = c == 'x' ? r : (r & 0x3 | 0x8);
        return v.toString(16);
      });
    };
  }
</script>
```

---

## Security Checklist

- [ ] Change `NODE_ENV` to `production`
- [ ] Enable firewall: `ufw allow 22,80,443 && ufw enable`
- [ ] Change database password from default
- [ ] Disable demo account login
- [ ] Set up automated backups
- [ ] Configure fail2ban
- [ ] Review and rotate JWT secrets

---

## Backup & Recovery

### Database Backup

```bash
# Create backup
pg_dump -U ownmyhealth -d ownmyhealth > backup_$(date +%Y%m%d).sql

# Restore backup
psql -U ownmyhealth -d ownmyhealth < backup_20240115.sql
```

### Full Server Snapshot

Create DigitalOcean droplet snapshots via the control panel for full server backups.

---

## Cost Estimate

| Item | Monthly Cost |
|------|-------------|
| DigitalOcean Droplet (Basic) | $6-12 |
| Domain (ownmyhealth.io) | ~$1 |
| **Total** | **~$7-13/month** |

---

## Quick Reference

```bash
# SSH in
ssh root@165.227.76.212

# Check everything is running
pm2 status && systemctl status nginx && systemctl status postgresql

# View backend logs
pm2 logs ownmyhealth-backend

# Restart backend
pm2 restart ownmyhealth-backend

# Restart nginx
systemctl restart nginx

# Rebuild and deploy frontend
cd /var/www/app && npm run build

# Rebuild and deploy backend
cd /var/www/app/backend && npm run build && pm2 restart ownmyhealth-backend
```

---

## Next Steps (TODO)

1. **Security Hardening**
   - Set `NODE_ENV=production`
   - Enable UFW firewall
   - Set up fail2ban
   - Change default database password

2. **Email Service**
   - Integrate SendGrid or AWS SES
   - Enable email verification
   - Enable password reset

3. **CI/CD Pipeline**
   - Set up GitHub Actions
   - Automated deployment on push

4. **Healthcare.gov API**
   - Insurance plan search
   - Plan comparison

5. **AWS Textract**
   - Medical document scanning
   - OCR for lab reports
