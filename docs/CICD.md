# CI/CD Pipeline Documentation

## Overview

OwnMyHealth uses GitHub Actions for continuous integration and deployment:

- **CI** (`ci.yml`): Runs on every push and PR - lints, tests, and builds
- **Deploy** (`deploy.yml`): Deploys to production on push to main/master

## Pipeline Flow

```
┌─────────────────────────────────────────────────────────────────┐
│                        Push/PR to main                          │
└─────────────────────────────────────────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────┐
│                          CI Pipeline                             │
│  ┌───────────────┐  ┌───────────────┐  ┌───────────────────┐    │
│  │ Lint Frontend │  │ Lint Backend  │  │ Test Frontend     │    │
│  └───────────────┘  └───────────────┘  └───────────────────┘    │
│                                                                  │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │ Test Backend (with PostgreSQL service container)          │  │
│  └───────────────────────────────────────────────────────────┘  │
│                                                                  │
│  ┌───────────────┐  ┌───────────────┐                           │
│  │ Build Frontend│  │ Build Backend │  (after tests pass)       │
│  └───────────────┘  └───────────────┘                           │
└─────────────────────────────────────────────────────────────────┘
                                │
                                ▼ (only on push to main)
┌─────────────────────────────────────────────────────────────────┐
│                       Deploy Pipeline                            │
│  1. SSH to server                                                │
│  2. Pull latest code                                             │
│  3. Install dependencies                                         │
│  4. Build frontend & backend                                     │
│  5. Run database migrations                                      │
│  6. Restart PM2                                                  │
│  7. Health check                                                 │
└─────────────────────────────────────────────────────────────────┘
```

## Setup Instructions

### Step 1: Generate SSH Key

On your local machine:

```bash
# Generate a new SSH key for deployments
ssh-keygen -t ed25519 -C "github-actions-deploy" -f ~/.ssh/github_deploy_key

# Display the public key
cat ~/.ssh/github_deploy_key.pub

# Display the private key (you'll need this for GitHub)
cat ~/.ssh/github_deploy_key
```

### Step 2: Add Public Key to Server

SSH to your server and add the public key:

```bash
ssh root@165.227.76.212

# Add the public key to authorized_keys
echo "YOUR_PUBLIC_KEY_HERE" >> ~/.ssh/authorized_keys

# Verify
cat ~/.ssh/authorized_keys
```

### Step 3: Add Private Key to GitHub Secrets

1. Go to your GitHub repository
2. Navigate to **Settings** → **Secrets and variables** → **Actions**
3. Click **New repository secret**
4. Name: `SSH_PRIVATE_KEY`
5. Value: Paste the entire private key (including `-----BEGIN` and `-----END` lines)
6. Click **Add secret**

### Step 4: Test the Pipeline

1. Make a small change to any file
2. Commit and push to main:
   ```bash
   git add .
   git commit -m "test: verify CI/CD pipeline"
   git push origin main
   ```
3. Go to **Actions** tab in GitHub to watch the pipeline run

## GitHub Secrets Required

| Secret | Description | How to Generate |
|--------|-------------|-----------------|
| `SSH_PRIVATE_KEY` | Private key for SSH deployment | `ssh-keygen -t ed25519` |

## Manual Deployment

You can trigger a deployment manually:

1. Go to **Actions** tab in GitHub
2. Select **Deploy to Production** workflow
3. Click **Run workflow** → **Run workflow**

## Monitoring

### View Pipeline Status

- Go to repository → **Actions** tab
- Green checkmark = success
- Red X = failure (click to see logs)

### View Deployment Logs

On the server:

```bash
# PM2 logs
pm2 logs ownmyhealth-backend

# Nginx logs
tail -f /var/log/nginx/access.log
tail -f /var/log/nginx/error.log
```

## Troubleshooting

### Pipeline fails at "Setup SSH"

**Symptom:** `Permission denied (publickey)`

**Fix:**
1. Verify `SSH_PRIVATE_KEY` secret is set correctly in GitHub
2. Verify public key is in server's `~/.ssh/authorized_keys`
3. Test manually: `ssh -i ~/.ssh/github_deploy_key root@165.227.76.212`

### Pipeline fails at "Deploy to server"

**Symptom:** Commands fail during deployment

**Fix:**
1. SSH to server and run commands manually
2. Check for disk space: `df -h`
3. Check PM2 status: `pm2 status`
4. Check logs: `pm2 logs ownmyhealth-backend`

### Health check fails

**Symptom:** `curl` returns non-200 status

**Fix:**
1. Check if backend is running: `pm2 status`
2. Check backend logs: `pm2 logs ownmyhealth-backend`
3. Test locally on server: `curl http://localhost:3001/api/v1/health`

### Tests fail

**Symptom:** Test job fails

**Fix:**
1. Run tests locally: `npm test` and `cd backend && npm test`
2. Check if database migrations are current
3. Review test output in GitHub Actions logs

## Adding New Secrets

If you need to add more secrets (e.g., for email service):

1. Add to GitHub: **Settings** → **Secrets** → **New repository secret**
2. Reference in workflow:
   ```yaml
   env:
     SENDGRID_API_KEY: ${{ secrets.SENDGRID_API_KEY }}
   ```
3. Pass to server in deploy script if needed

## Workflow Files

```
.github/workflows/
├── ci.yml      # Continuous Integration (lint, test, build)
└── deploy.yml  # Deployment to production
```

## Best Practices

1. **Never push directly to main** - Use pull requests for code review
2. **Wait for CI to pass** before merging PRs
3. **Monitor deployments** - Watch the Actions tab after merging
4. **Keep secrets secure** - Never commit secrets to the repository
5. **Test locally first** - Run tests before pushing
