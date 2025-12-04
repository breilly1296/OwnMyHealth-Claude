# OwnMyHealth Deployment Guide

Deploy OwnMyHealth to **Railway** with your domain **ownmyhealth.io**

---

## Prerequisites

- [x] Domain owned: ownmyhealth.io
- [ ] GitHub account (for connecting to Railway)
- [ ] Railway account (free at https://railway.app)

---

## Step 1: Push Code to GitHub

First, commit all your changes and push to GitHub:

```bash
cd C:\Users\breil\OneDrive\Desktop\OwnMyHealth

# Add all files
git add .

# Commit
git commit -m "Prepare for production deployment"

# If you haven't set up a remote yet:
git remote add origin https://github.com/YOUR_USERNAME/ownmyhealth.git

# Push to GitHub
git push -u origin master
```

---

## Step 2: Create Railway Project

1. Go to https://railway.app and sign in with GitHub
2. Click **"New Project"**
3. Select **"Deploy from GitHub repo"**
4. Choose your **ownmyhealth** repository

---

## Step 3: Set Up PostgreSQL Database

1. In your Railway project, click **"+ New"**
2. Select **"Database"** → **"Add PostgreSQL"**
3. Railway will automatically create a PostgreSQL instance
4. The `DATABASE_URL` will be automatically available to your services

---

## Step 4: Deploy Backend Service

1. Click **"+ New"** → **"GitHub Repo"**
2. Select your repository
3. Click **"Add variables"** and set:

   | Variable | Value |
   |----------|-------|
   | `NODE_ENV` | `production` |
   | `JWT_ACCESS_SECRET` | *(generate: `openssl rand -base64 32`)* |
   | `JWT_REFRESH_SECRET` | *(generate: `openssl rand -base64 32`)* |
   | `PHI_ENCRYPTION_KEY` | *(generate: `openssl rand -hex 32`)* |
   | `CORS_ORIGIN` | `https://ownmyhealth.io` |
   | `JWT_ACCESS_EXPIRES_IN` | `15m` |
   | `JWT_REFRESH_EXPIRES_IN` | `7d` |

4. Go to **Settings** → **General**:
   - Set **Root Directory** to: `backend`
   - Set **Watch Paths** to: `/backend/**`

5. Go to **Settings** → **Networking**:
   - Click **"Generate Domain"** (you'll get something like `backend-xxx.railway.app`)
   - Note this URL for the frontend config

6. Click **"Connect"** next to the PostgreSQL database to link `DATABASE_URL`

---

## Step 5: Deploy Frontend Service

1. Click **"+ New"** → **"GitHub Repo"**
2. Select the same repository
3. Click **"Add variables"** and set:

   | Variable | Value |
   |----------|-------|
   | `VITE_API_URL` | `https://YOUR-BACKEND-URL.railway.app/api/v1` |

   *(Use the backend URL from Step 4)*

4. Go to **Settings** → **General**:
   - Keep **Root Directory** empty (uses project root)
   - Ensure it detects the `package.json`

5. Go to **Settings** → **Networking**:
   - Click **"Generate Domain"**

---

## Step 6: Configure Custom Domain

### For Frontend (ownmyhealth.io):

1. In Railway, select your **frontend service**
2. Go to **Settings** → **Networking**
3. Click **"Custom Domain"**
4. Enter: `ownmyhealth.io`
5. Railway will show you DNS records to add

### For Backend (api.ownmyhealth.io):

1. Select your **backend service**
2. Go to **Settings** → **Networking**
3. Click **"Custom Domain"**
4. Enter: `api.ownmyhealth.io`
5. Railway will show you DNS records to add

### Add DNS Records at Your Domain Registrar:

Go to your domain registrar (where you bought ownmyhealth.io) and add:

| Type | Name | Value |
|------|------|-------|
| CNAME | `@` or blank | `your-frontend.railway.app` |
| CNAME | `api` | `your-backend.railway.app` |

*Note: Some registrars don't allow CNAME for root domain. Use their "ALIAS" or "ANAME" feature, or use a subdomain like `www.ownmyhealth.io`*

---

## Step 7: Update Backend CORS

After setting up the custom domain, update the backend's `CORS_ORIGIN`:

```
CORS_ORIGIN=https://ownmyhealth.io
```

---

## Step 8: Run Database Migrations

Railway will automatically run migrations on deploy (configured in `railway.toml`).

To run manually:
1. Go to your backend service
2. Open the **"Command"** tab
3. Run: `npx prisma migrate deploy`

---

## Step 9: Verify Deployment

1. Visit https://ownmyhealth.io - Frontend should load
2. Visit https://api.ownmyhealth.io/api/v1/health - Should return health check
3. Try logging in/registering

---

## Security Checklist

- [x] All secrets generated uniquely (not example values)
- [x] `PHI_ENCRYPTION_KEY` backed up securely (CRITICAL - data loss if lost!)
- [x] HTTPS enabled (Railway does this automatically)
- [x] CORS restricted to your domain only
- [x] Production environment variables set

---

## Troubleshooting

### Backend not connecting to database
- Ensure PostgreSQL is connected to the backend service
- Check `DATABASE_URL` is properly set

### Frontend can't reach backend (CORS error)
- Verify `CORS_ORIGIN` in backend matches your frontend domain exactly
- Include `https://` in the CORS_ORIGIN

### 500 errors on backend
- Check Railway logs: Click on backend service → "Logs"
- Verify all environment variables are set
- Ensure PHI_ENCRYPTION_KEY is exactly 64 hex characters

### Domain not working
- DNS propagation can take up to 48 hours
- Verify CNAME records are correct
- Try https://dnschecker.org to verify DNS

---

## Monthly Cost Estimate

| Service | Estimated Cost |
|---------|---------------|
| Frontend | ~$0-5/month |
| Backend | ~$5-10/month |
| PostgreSQL | ~$5-10/month |
| **Total** | **~$10-25/month** |

*Railway offers $5 free credit monthly, so small apps may run free!*

---

## Support

- Railway Docs: https://docs.railway.app
- Railway Discord: https://discord.gg/railway
