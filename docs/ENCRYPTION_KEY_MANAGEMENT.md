# PHI Encryption Key Management Guide

This guide explains how to manage the `PHI_ENCRYPTION_KEY` used to protect Protected Health Information (PHI) in OwnMyHealth. This key is **critical** - losing it means permanent, unrecoverable data loss.

---

## Table of Contents

1. [Understanding the PHI Encryption Key](#understanding-the-phi-encryption-key)
2. [Generating a Secure Key](#generating-a-secure-key)
3. [Secure Key Storage](#secure-key-storage)
4. [Backup Procedures](#backup-procedures)
5. [What Happens If the Key Is Lost](#what-happens-if-the-key-is-lost)
6. [Key Rotation Procedure](#key-rotation-procedure)
7. [Emergency Procedures](#emergency-procedures)
8. [Compliance Checklist](#compliance-checklist)

---

## Understanding the PHI Encryption Key

### What It Does

The `PHI_ENCRYPTION_KEY` encrypts all Protected Health Information stored in the database, including:

- Patient health records
- Medical history
- Lab results
- Medication information
- Provider notes
- Any other sensitive health data

### Key Requirements

| Requirement | Value |
|-------------|-------|
| Format | Hexadecimal characters only (0-9, a-f) |
| Minimum Length | 64 characters (256-bit encryption) |
| Algorithm | AES-256-GCM |

---

## Generating a Secure Key

### Option 1: Using OpenSSL (Recommended)

Run this command on any Linux, macOS, or Windows (with Git Bash) system:

```bash
openssl rand -hex 32
```

This outputs a 64-character hexadecimal string like:
```
a3b8c9d2e5f6a1b4c7d8e9f0a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1
```

### Option 2: Using Python

```bash
python3 -c "import secrets; print(secrets.token_hex(32))"
```

### Option 3: Online Generator (Use With Caution)

Only use trusted, offline-capable generators. **Never use online generators for production keys.**

### Verification

After generating, verify your key meets requirements:

```bash
# Check length (should output 64)
echo -n "YOUR_KEY_HERE" | wc -c

# Check format (should output nothing if valid hex)
echo "YOUR_KEY_HERE" | grep -E '[^0-9a-fA-F]'
```

---

## Secure Key Storage

### Production Requirements

**Never store the key in:**
- Source code or git repositories
- Plain text files on servers
- Email or chat messages
- Shared documents

**Always store the key in:**
- A secrets management service (see below)
- Environment variables injected at runtime
- Encrypted configuration management

### Recommended Secrets Managers

#### AWS Secrets Manager

**Setup:**
1. Go to AWS Console → Secrets Manager
2. Click "Store a new secret"
3. Select "Other type of secret"
4. Add key-value pair:
   - Key: `PHI_ENCRYPTION_KEY`
   - Value: Your generated key
5. Name it: `ownmyhealth/production/phi-key`
6. Enable automatic rotation (optional, see [Key Rotation](#key-rotation-procedure))

**Retrieve in application:**
```bash
aws secretsmanager get-secret-value --secret-id ownmyhealth/production/phi-key
```

**Cost:** ~$0.40/month per secret + $0.05 per 10,000 API calls

#### HashiCorp Vault

**Setup:**
1. Enable the KV secrets engine:
   ```bash
   vault secrets enable -path=ownmyhealth kv-v2
   ```
2. Store the key:
   ```bash
   vault kv put ownmyhealth/phi-key value=YOUR_KEY_HERE
   ```
3. Create a policy for access:
   ```hcl
   path "ownmyhealth/data/phi-key" {
     capabilities = ["read"]
   }
   ```

**Retrieve:**
```bash
vault kv get -field=value ownmyhealth/phi-key
```

#### Google Cloud Secret Manager

**Setup:**
1. Go to Google Cloud Console → Security → Secret Manager
2. Click "Create Secret"
3. Name: `phi-encryption-key`
4. Secret value: Your generated key
5. Set appropriate IAM permissions

**Retrieve:**
```bash
gcloud secrets versions access latest --secret="phi-encryption-key"
```

#### Azure Key Vault

**Setup:**
1. Create a Key Vault in Azure Portal
2. Go to Secrets → Generate/Import
3. Name: `phi-encryption-key`
4. Value: Your generated key

**Retrieve:**
```bash
az keyvault secret show --vault-name YOUR_VAULT --name phi-encryption-key
```

### Railway Deployment

If using Railway for deployment:

1. Go to your Railway project
2. Click on your backend service
3. Go to "Variables" tab
4. Add `PHI_ENCRYPTION_KEY` with your generated value
5. Railway encrypts this automatically

---

## Backup Procedures

### Primary Backup Strategy

1. **Store in secrets manager** (primary)
2. **Create offline backup** (secondary)
3. **Document access procedures** (tertiary)

### Creating an Offline Backup

**Step 1:** Generate a backup file

```bash
# Create encrypted backup
echo "YOUR_KEY_HERE" | gpg --symmetric --cipher-algo AES256 -o phi_key_backup.gpg
```

You'll be prompted to create a passphrase. Use a strong, memorable passphrase.

**Step 2:** Store the backup

- Print the encrypted file and store in a **physical safe** or **safety deposit box**
- Store on an **encrypted USB drive** in a secure location
- Never store the backup passphrase with the backup

**Step 3:** Document backup location

Create a secure document (not stored digitally with the key) noting:
- Date of backup creation
- Backup location(s)
- Who has access
- Passphrase hint (not the actual passphrase)

### Backup Access Control

| Role | Access Level |
|------|--------------|
| CTO / Security Lead | Full access to key and backups |
| DevOps Lead | Access to secrets manager only |
| On-call Engineer | Emergency access procedure only |
| Developers | No direct access |

### Backup Verification

**Monthly:** Verify backup accessibility
1. Retrieve backup from storage location
2. Decrypt and verify key matches production
3. Document verification in security log

```bash
# Decrypt backup to verify
gpg --decrypt phi_key_backup.gpg
```

---

## What Happens If the Key Is Lost

### Immediate Impact

If the `PHI_ENCRYPTION_KEY` is lost and no backup exists:

| Data Type | Impact |
|-----------|--------|
| Encrypted PHI | **Permanently unrecoverable** |
| User accounts | Remain functional |
| Non-PHI data | Unaffected |

### There Is No Recovery

**AES-256 encryption cannot be broken.** Without the key:
- No amount of computing power can decrypt the data
- There is no "master key" or backdoor
- Anthropic/OwnMyHealth cannot recover the data
- Law enforcement cannot recover the data

### Prevention Is the Only Solution

This is why you must:
1. Use a secrets manager with redundancy
2. Maintain verified offline backups
3. Test backup restoration quarterly
4. Document access procedures

---

## Key Rotation Procedure

> **Note:** Key rotation is currently a manual process that requires a maintenance window. A future update will add automated rotation support.

### When to Rotate

- **Scheduled:** Annually or per your security policy
- **Unscheduled:** After any suspected compromise (see [Emergency Procedures](#emergency-procedures))

### Pre-Rotation Checklist

- [ ] Schedule maintenance window (expect 1-4 hours depending on data volume)
- [ ] Notify affected users of downtime
- [ ] Ensure current key backup is verified
- [ ] Generate new key using [secure method](#generating-a-secure-key)
- [ ] Backup new key using [backup procedures](#backup-procedures)
- [ ] Have rollback plan ready

### Rotation Steps

**Step 1:** Put application in maintenance mode
```bash
# Set environment variable
MAINTENANCE_MODE=true
```

**Step 2:** Export current encrypted data
```bash
# This command will be provided in a future update
# For now, contact engineering team
```

**Step 3:** Update the encryption key
```bash
# Update in secrets manager
aws secretsmanager update-secret --secret-id ownmyhealth/production/phi-key \
  --secret-string "NEW_KEY_HERE"
```

**Step 4:** Re-encrypt all PHI data
```bash
# Migration script (to be provided)
npm run migrate:reencrypt
```

**Step 5:** Verify data integrity
```bash
npm run verify:phi-integrity
```

**Step 6:** Remove maintenance mode and monitor

### Post-Rotation

- [ ] Verify application functions normally
- [ ] Check logs for decryption errors
- [ ] Update backup with new key
- [ ] Securely destroy old key backups after 30-day verification period
- [ ] Document rotation in security log

---

## Emergency Procedures

### If Key Compromise Is Suspected

**Signs of potential compromise:**
- Unauthorized access to secrets manager detected
- Backup storage was accessed by unknown party
- Employee with key access terminated unexpectedly
- Security breach detected in infrastructure

### Immediate Response (Within 1 Hour)

1. **Assess the situation**
   - What evidence suggests compromise?
   - When might the breach have occurred?
   - What data might be affected?

2. **Notify security team**
   - Contact: [Security Team Contact - Add your contact]
   - Include: Time of discovery, evidence, affected systems

3. **Do NOT immediately rotate the key**
   - This could alert attackers
   - First, assess the scope of the breach

### Short-Term Response (1-24 Hours)

1. **Revoke suspicious access**
   - Rotate secrets manager credentials
   - Review access logs

2. **Preserve evidence**
   - Export relevant logs
   - Document timeline

3. **Prepare for key rotation**
   - Schedule emergency maintenance window
   - Follow [Key Rotation Procedure](#key-rotation-procedure)

### Key Rotation After Compromise

If confirmed compromise:

1. **Rotate immediately** following the rotation procedure
2. **Assume all encrypted data was accessible** from breach date
3. **Notify affected parties** per HIPAA Breach Notification Rule:
   - Individuals: Within 60 days
   - HHS: Within 60 days (if 500+ affected) or annual report
   - Media: If 500+ affected in a state

### Incident Documentation

Create an incident report including:
- Date/time of discovery
- Date/time of suspected breach
- Evidence collected
- Actions taken
- Data potentially affected
- Notifications sent
- Remediation steps

---

## Compliance Checklist

### Initial Setup

- [ ] Generated key using cryptographically secure method
- [ ] Key meets 256-bit (64 hex character) requirement
- [ ] Key stored in approved secrets manager
- [ ] Offline backup created and secured
- [ ] Access limited to authorized personnel only
- [ ] Access logging enabled

### Monthly

- [ ] Verify backup accessibility
- [ ] Review access logs for anomalies
- [ ] Confirm secrets manager health

### Quarterly

- [ ] Test backup restoration procedure
- [ ] Review and update access list
- [ ] Verify key meets current security standards

### Annually

- [ ] Consider key rotation
- [ ] Full security audit of key management
- [ ] Update this documentation as needed
- [ ] Train new staff on procedures

---

## Quick Reference

### Generate New Key
```bash
openssl rand -hex 32
```

### Verify Key Format
```bash
echo -n "KEY" | wc -c  # Should be 64
```

### Emergency Contacts

| Role | Contact |
|------|---------|
| Security Lead | [Add contact] |
| DevOps On-Call | [Add contact] |
| Legal/Compliance | [Add contact] |

---

## Document History

| Date | Version | Author | Changes |
|------|---------|--------|---------|
| 2024-XX-XX | 1.0 | Initial | Created document |

---

**Remember:** The encryption key protects patient health information. Handle it with the same care you would handle the data itself.
