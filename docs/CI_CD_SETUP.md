# CI/CD Setup Guide

This document explains how to set up the CI/CD pipeline for OwnMyHealth using GitHub Actions.

## Overview

The CI/CD pipeline consists of two workflows:

1. **CI Workflow** (`ci.yml`) - Runs on every push and PR
   - Lints frontend and backend code
   - Runs unit tests
   - Builds both applications
   - Runs security audit

2. **Deploy Workflow** (`deploy.yml`) - Runs on push to `main`
   - Runs CI workflow first
   - Deploys to production server via SSH
   - Restarts services

## Required GitHub Secrets

You need to configure the following secrets in your GitHub repository:

### 1. SSH_PRIVATE_KEY

The private SSH key that has access to the production server.

**To generate a new SSH key pair:**

```bash
# On your local machine
ssh-keygen -t ed25519 -C "github-actions@ownmyhealth.io" -f ~/.ssh/github_actions_deploy

# Copy the public key to the server
ssh-copy-id -i ~/.ssh/github_actions_deploy.pub root@165.227.76.212

# Test the connection
ssh -i ~/.ssh/github_actions_deploy root@165.227.76.212 "echo 'SSH works!'"
```

**Add the private key to GitHub:**

1. Go to your repository on GitHub
2. Navigate to Settings → Secrets and variables → Actions
3. Click "New repository secret"
4. Name: `SSH_PRIVATE_KEY`
5. Value: Paste the contents of `~/.ssh/github_actions_deploy` (the private key)

### 2. SERVER_IP

The IP address of the production server.

1. Go to Settings → Secrets and variables → Actions
2. Click "New repository secret"
3. Name: `SERVER_IP`
4. Value: `165.227.76.212`

### 3. SERVER_USER (Optional)

The SSH user to connect as. Defaults to `root` if not set.

1. Go to Settings → Secrets and variables → Actions
2. Click "New repository secret"
3. Name: `SERVER_USER`
4. Value: `root` (or your preferred user)

## Workflow Triggers

### CI Workflow
- Triggers on push to `main` or `develop` branches
- Triggers on pull requests to `main` or `develop` branches

### Deploy Workflow
- Triggers on push to `main` branch only
- Can be manually triggered via GitHub Actions UI (workflow_dispatch)

## Server Requirements

The production server needs:

1. **Node.js 20+** installed
2. **PM2** for process management
3. **Nginx** for serving frontend and proxying API
4. **PostgreSQL** database
5. **SSH access** for the deployment key

### Server Directory Structure

```
/var/www/app/
├── dist/           # Frontend build
├── backend/
│   ├── dist/       # Backend build
│   ├── node_modules/
│   └── package.json
├── node_modules/   # Frontend dependencies (production only)
└── package.json
```

## Manual Deployment

If you need to deploy manually:

```bash
# SSH into the server
ssh root@165.227.76.212

# Pull latest code
cd /var/www/app
git pull origin main

# Frontend
npm ci --production
npm run build

# Backend
cd backend
npm ci --production
npm run build
pm2 restart ownmyhealth-backend
```

## Troubleshooting

### Deployment fails with SSH error

1. Verify the SSH key is correctly added to GitHub secrets
2. Check that the public key is in `~/.ssh/authorized_keys` on the server
3. Ensure the key has correct permissions (600 for private key)

### Build fails

1. Check the GitHub Actions logs for specific errors
2. Ensure all dependencies are listed in package.json
3. Verify environment variables are set correctly

### Server doesn't restart

1. SSH into the server and check PM2 status: `pm2 status`
2. Check PM2 logs: `pm2 logs ownmyhealth-backend`
3. Manually restart if needed: `pm2 restart ownmyhealth-backend`

## Environment Variables

The following environment variables should be set on the production server:

```bash
# /var/www/app/.env (frontend build-time)
VITE_API_URL=https://ownmyhealth.io/api/v1

# /var/www/app/backend/.env
NODE_ENV=production
DATABASE_URL=postgresql://...
JWT_SECRET=...
JWT_REFRESH_SECRET=...
ENCRYPTION_KEY=...
SENDGRID_API_KEY=...
EMAIL_FROM=noreply@ownmyhealth.io
FRONTEND_URL=https://ownmyhealth.io
```

## Adding Health Check Endpoint

For deployment verification, add a health check endpoint to the backend:

```typescript
// In your routes
router.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});
```

## Security Considerations

1. **Never commit secrets** - All sensitive data should be in GitHub Secrets
2. **Use deploy keys** - Create a dedicated SSH key for deployments
3. **Limit server access** - The deploy key should only have necessary permissions
4. **Review before merge** - Always review PRs before merging to main
5. **Monitor deployments** - Set up alerts for failed deployments
