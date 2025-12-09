#!/bin/bash
# OwnMyHealth Security Hardening Script
# Run this on the production server: ssh root@165.227.76.212
# Usage: bash security-harden.sh

set -e

echo "============================================"
echo "OwnMyHealth Security Hardening Script"
echo "============================================"
echo ""

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Function to prompt for confirmation
confirm() {
    read -p "$1 [y/N] " response
    case "$response" in
        [yY][eE][sS]|[yY])
            return 0
            ;;
        *)
            return 1
            ;;
    esac
}

# Check if running as root
if [ "$EUID" -ne 0 ]; then
    echo -e "${RED}Error: Please run as root${NC}"
    exit 1
fi

echo "This script will:"
echo "  1. Set NODE_ENV to production (disables demo login)"
echo "  2. Enable UFW firewall (SSH, HTTP, HTTPS only)"
echo "  3. Install and configure fail2ban"
echo "  4. Generate new database password"
echo "  5. Generate new JWT secrets"
echo ""

if ! confirm "Do you want to proceed?"; then
    echo "Aborted."
    exit 0
fi

echo ""
echo "============================================"
echo "Step 1: Update NODE_ENV to production"
echo "============================================"

BACKEND_ENV="/var/www/app/backend/.env"

if [ -f "$BACKEND_ENV" ]; then
    # Backup current .env
    cp "$BACKEND_ENV" "$BACKEND_ENV.backup.$(date +%Y%m%d_%H%M%S)"
    echo -e "${GREEN}Backed up current .env file${NC}"

    # Update NODE_ENV
    if grep -q "^NODE_ENV=" "$BACKEND_ENV"; then
        sed -i 's/^NODE_ENV=.*/NODE_ENV=production/' "$BACKEND_ENV"
        echo -e "${GREEN}Updated NODE_ENV to production${NC}"
    else
        echo "NODE_ENV=production" >> "$BACKEND_ENV"
        echo -e "${GREEN}Added NODE_ENV=production${NC}"
    fi
else
    echo -e "${RED}Backend .env file not found at $BACKEND_ENV${NC}"
    exit 1
fi

echo ""
echo "============================================"
echo "Step 2: Configure UFW Firewall"
echo "============================================"

# Install UFW if not present
if ! command -v ufw &> /dev/null; then
    apt-get update
    apt-get install -y ufw
fi

# Reset UFW to defaults
ufw --force reset

# Set default policies
ufw default deny incoming
ufw default allow outgoing

# Allow SSH (important - do this first!)
ufw allow 22/tcp comment 'SSH'

# Allow HTTP and HTTPS
ufw allow 80/tcp comment 'HTTP'
ufw allow 443/tcp comment 'HTTPS'

# Enable UFW
echo "y" | ufw enable

echo -e "${GREEN}UFW firewall enabled with rules:${NC}"
ufw status verbose

echo ""
echo "============================================"
echo "Step 3: Install and Configure fail2ban"
echo "============================================"

# Install fail2ban
apt-get update
apt-get install -y fail2ban

# Create jail.local configuration
cat > /etc/fail2ban/jail.local << 'EOF'
[DEFAULT]
# Ban hosts for 1 hour
bantime = 3600
# Find time window: 10 minutes
findtime = 600
# Number of failures before ban
maxretry = 5
# Ignore localhost
ignoreip = 127.0.0.1/8

[sshd]
enabled = true
port = ssh
filter = sshd
logpath = /var/log/auth.log
maxretry = 3
bantime = 3600

[nginx-http-auth]
enabled = true
filter = nginx-http-auth
port = http,https
logpath = /var/log/nginx/error.log
maxretry = 5

[nginx-botsearch]
enabled = true
filter = nginx-botsearch
port = http,https
logpath = /var/log/nginx/access.log
maxretry = 2
EOF

# Restart fail2ban
systemctl restart fail2ban
systemctl enable fail2ban

echo -e "${GREEN}fail2ban installed and configured${NC}"
fail2ban-client status

echo ""
echo "============================================"
echo "Step 4: Generate New Database Password"
echo "============================================"

if confirm "Generate new PostgreSQL password? (Recommended)"; then
    NEW_DB_PASS=$(openssl rand -base64 24 | tr -dc 'a-zA-Z0-9' | head -c 24)

    echo "New database password: $NEW_DB_PASS"
    echo ""
    echo "Updating PostgreSQL password..."

    # Update PostgreSQL password
    sudo -u postgres psql -c "ALTER USER ownmyhealth WITH PASSWORD '$NEW_DB_PASS';"

    # Update backend .env
    OLD_DB_URL=$(grep "^DATABASE_URL=" "$BACKEND_ENV" | head -1)
    NEW_DB_URL="DATABASE_URL=postgresql://ownmyhealth:${NEW_DB_PASS}@localhost:5432/ownmyhealth"

    sed -i "s|^DATABASE_URL=.*|$NEW_DB_URL|" "$BACKEND_ENV"

    echo -e "${GREEN}Database password updated${NC}"
    echo -e "${YELLOW}IMPORTANT: Save this password securely: $NEW_DB_PASS${NC}"
else
    echo "Skipping database password change"
fi

echo ""
echo "============================================"
echo "Step 5: Generate New JWT Secrets"
echo "============================================"

if confirm "Generate new JWT secrets? (Recommended)"; then
    NEW_JWT_ACCESS=$(openssl rand -base64 48)
    NEW_JWT_REFRESH=$(openssl rand -base64 48)
    NEW_PHI_KEY=$(openssl rand -hex 32)

    # Update JWT secrets in .env
    sed -i "s|^JWT_ACCESS_SECRET=.*|JWT_ACCESS_SECRET=$NEW_JWT_ACCESS|" "$BACKEND_ENV"
    sed -i "s|^JWT_REFRESH_SECRET=.*|JWT_REFRESH_SECRET=$NEW_JWT_REFRESH|" "$BACKEND_ENV"

    # Only update PHI key if user confirms (this will make existing encrypted data unreadable!)
    echo ""
    echo -e "${RED}WARNING: Changing PHI_ENCRYPTION_KEY will make existing encrypted data UNREADABLE!${NC}"
    if confirm "Change PHI_ENCRYPTION_KEY? (Only if this is a fresh install)"; then
        sed -i "s|^PHI_ENCRYPTION_KEY=.*|PHI_ENCRYPTION_KEY=$NEW_PHI_KEY|" "$BACKEND_ENV"
        echo -e "${YELLOW}PHI key updated. Old encrypted data is now unreadable.${NC}"
    else
        echo "PHI_ENCRYPTION_KEY unchanged (existing data preserved)"
    fi

    echo -e "${GREEN}JWT secrets updated${NC}"
else
    echo "Skipping JWT secret regeneration"
fi

echo ""
echo "============================================"
echo "Step 6: Restart Services"
echo "============================================"

# Restart PM2
cd /var/www/app/backend
pm2 restart ownmyhealth-backend

echo -e "${GREEN}Backend restarted${NC}"

echo ""
echo "============================================"
echo "Security Hardening Complete!"
echo "============================================"
echo ""
echo "Summary of changes:"
echo "  - NODE_ENV set to production (demo login disabled)"
echo "  - UFW firewall enabled (ports 22, 80, 443)"
echo "  - fail2ban installed and configured"
echo "  - Credentials updated (if selected)"
echo "  - Backend service restarted"
echo ""
echo "Next steps:"
echo "  1. Test the site: https://ownmyhealth.io"
echo "  2. Verify demo login is blocked"
echo "  3. Store new credentials securely"
echo "  4. Set up automated backups"
echo ""
echo -e "${GREEN}Done!${NC}"
