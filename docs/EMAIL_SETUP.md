# Email Service Setup Guide

OwnMyHealth uses SendGrid for transactional emails including:
- Email verification
- Password reset
- Welcome emails

## Quick Setup

### 1. Create SendGrid Account

1. Go to https://sendgrid.com/
2. Sign up for a free account (100 emails/day free)
3. Complete email verification

### 2. Create API Key

1. In SendGrid dashboard, go to **Settings** → **API Keys**
2. Click **Create API Key**
3. Name it "OwnMyHealth Production"
4. Select **Restricted Access**
5. Enable **Mail Send** → **Full Access**
6. Click **Create & View**
7. Copy the API key (starts with `SG.`)

### 3. Verify Sender Identity

1. Go to **Settings** → **Sender Authentication**
2. Choose one:
   - **Single Sender Verification** (quick, for testing)
   - **Domain Authentication** (recommended for production)

#### Single Sender (Quick Start)
1. Click **Verify a Single Sender**
2. Fill in:
   - From Email: `noreply@ownmyhealth.io`
   - From Name: `OwnMyHealth`
   - Reply To: your actual email
3. Check your email and click verify

#### Domain Authentication (Recommended)
1. Click **Authenticate Your Domain**
2. Enter: `ownmyhealth.io`
3. Add the DNS records to Porkbun:
   - CNAME records for DKIM
   - TXT record for SPF
4. Click **Verify** after DNS propagates

### 4. Configure Backend

SSH to your server:

```bash
ssh root@165.227.76.212

# Edit backend .env
nano /var/www/app/backend/.env

# Add these variables:
EMAIL_ENABLED=true
SENDGRID_API_KEY=SG.your-api-key-here
FROM_EMAIL=noreply@ownmyhealth.io
FROM_NAME=OwnMyHealth
APP_URL=https://ownmyhealth.io

# Restart backend
pm2 restart ownmyhealth-backend
```

### 5. Test Email

```bash
# Test from server
curl -X POST https://ownmyhealth.io/api/v1/auth/register \
  -H "Content-Type: application/json" \
  -d '{"email":"test@example.com","password":"TestPass123!"}'

# Check SendGrid Activity Feed for sent email
```

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `EMAIL_ENABLED` | Yes | Set to `true` to enable sending |
| `SENDGRID_API_KEY` | Yes | Your SendGrid API key |
| `FROM_EMAIL` | Yes | Sender email address |
| `FROM_NAME` | No | Sender display name (default: OwnMyHealth) |
| `APP_URL` | Yes | Base URL for email links |

## Email Templates

The email service includes styled HTML templates for:

### Verification Email
- Sent after registration
- Contains verification link
- Expires in 24 hours

### Password Reset Email
- Sent when user requests password reset
- Contains reset link
- Expires in 1 hour

### Welcome Email
- Sent after email verification
- Contains getting started info
- Links to login

## Development Mode

When `EMAIL_ENABLED=false` or `NODE_ENV=development`:
- Emails are logged to console instead of sent
- Useful for local testing
- No SendGrid account needed

```
📧 EMAIL (NOT SENT - Dev Mode)
To: user@example.com
Subject: Verify your OwnMyHealth account
---
[email content]
```

## Troubleshooting

### Emails Not Sending

1. Check `EMAIL_ENABLED=true` in .env
2. Verify `SENDGRID_API_KEY` is correct
3. Check PM2 logs: `pm2 logs ownmyhealth-backend`
4. Check SendGrid Activity Feed for errors

### Emails Going to Spam

1. Set up Domain Authentication in SendGrid
2. Add SPF and DKIM records to DNS
3. Use consistent From address
4. Avoid spam trigger words

### Invalid From Address

SendGrid requires the From address to be verified:
1. Go to **Sender Authentication**
2. Verify the email address or domain

### Rate Limits

SendGrid free tier: 100 emails/day
- Monitor usage in SendGrid dashboard
- Upgrade plan if needed

## SendGrid Dashboard

Monitor email activity:
1. Go to https://app.sendgrid.com/
2. Click **Activity** → **Activity Feed**
3. View sent emails, bounces, opens, clicks

## Alternative: AWS SES

To use AWS SES instead of SendGrid:

1. Set up SES in AWS Console
2. Verify domain/email
3. Modify `emailService.ts`:
   - Replace SendGrid fetch with AWS SDK
   - Update environment variables

```typescript
// Example SES integration (not implemented)
import { SESClient, SendEmailCommand } from '@aws-sdk/client-ses';

const ses = new SESClient({ region: 'us-east-1' });
await ses.send(new SendEmailCommand({...}));
```

## Security Notes

- Never commit API keys to git
- Use environment variables
- Rotate API keys periodically
- Monitor for unusual sending patterns
- Set up SendGrid 2FA
