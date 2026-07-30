#!/bin/bash
# =============================================================
# Let's Encrypt Certificate Setup - Household Replacement Tracker
# DNS-01 challenge via acme.sh (no port 80/443 needed)
# =============================================================
# Your domain: cristianbisca.ddns.net
# Provider: ddns.net (manual DNS TXT record required)
# Ports 80/443 are used by Home Assistant, so HTTP challenge won't work.
# =============================================================

set -e

DOMAIN="${1:-cristianbisca.ddns.net}"
CERT_DIR="$(cd "$(dirname "$0")" && pwd)"

echo ""
echo "========================================================"
echo "  Let's Encrypt Setup for ${DOMAIN}"
echo "  (DNS-01 Challenge - Manual TXT Record)"
echo "========================================================"
echo ""
echo " IMPORTANT: ddns.net does not have a native acme.sh API."
echo " You will need to manually add a DNS TXT record every ~60 days"
echo " when the certificate needs renewal."
echo ""
echo " For fully automatic renewal, consider switching your DDNS"
echo " to DuckDNS (free) or Cloudflare which have native acme.sh support."
echo ""

# ----------------------------------------------------------
# STEP 1: Install acme.sh
# ----------------------------------------------------------
if ! command -v acme.sh &> /dev/null; then
  echo "[STEP 1] Installing acme.sh..."
  curl -s https://get.acme.sh | sh
fi

# Source acme.sh
source "$HOME/.acme.sh/acme.sh.env" 2>/dev/null || true
echo "       acme.sh is ready."

# ----------------------------------------------------------
# STEP 2: Issue certificate (manual DNS)
# ----------------------------------------------------------
echo ""
echo "[STEP 2] Requesting certificate for ${DOMAIN}..."
echo ""
echo " Run this command:"
echo ""
echo "   acme.sh --issue --dns -d ${DOMAIN} --days 90"
echo ""
echo " It will output instructions like:"
echo ""
echo "   [INFO] Adding txt value: 'xxxxxx' for domain: '_acme-challenge.${DOMAIN}'"
echo ""
echo " Then:"
echo "  a) Log into your ddns.net control panel"
echo "  b) Add a DNS TXT record:"
echo "     Name: _acme-challenge"
echo "     Value: <the value acme.sh shows you>"
echo "     TTL: Automatic or 300"
echo "  c) Wait ~5 minutes for DNS propagation"
echo "  d) Run: acme.sh --renew -d ${DOMAIN} --force"
echo ""

# ----------------------------------------------------------
# STEP 3: Install certificates to project directory
# ----------------------------------------------------------
echo "[STEP 3] After the certificate is issued, install it:"
echo ""
echo "   acme.sh --installcert -d ${DOMAIN}"
echo "     --key-file ${CERT_DIR}/key.pem"
echo "     --fullchain-file ${CERT_DIR}/cert.pem"
echo "     --reloadcmd 'docker compose -f /path/to/HouseholdReplacementTracker/docker-compose.yml restart'"
echo ""

# ----------------------------------------------------------
# STEP 4: Enable auto-renewal cron
# ----------------------------------------------------------
echo "[STEP 4] Enable automatic renewal checks:"
echo ""
echo "   acme.sh --installcron"
echo ""
echo " (acme.sh will check twice daily. With manual DNS, you'll get"
echo "  a reminder when the TXT record needs to be updated.)"
echo ""

# ----------------------------------------------------------
# STEP 5: Restart container & verify
# ----------------------------------------------------------
echo "[STEP 5] Rebuild and restart:"
echo ""
echo "   cd /path/to/HouseholdReplacementTracker"
echo "   docker compose up -d --build"
echo ""
echo " Then verify HTTPS works:"
echo "   openssl s_client -connect ${DOMAIN}:3000 -servername ${DOMAIN}"
echo ""

# ----------------------------------------------------------
# SUMMARY
# ----------------------------------------------------------
echo "========================================================"
echo "  QUICK REFERENCE - Copy & Paste Commands"
echo "========================================================"
echo ""
echo " # 1. Issue cert (shows TXT record to add)"
echo " acme.sh --issue --dns -d ${DOMAIN} --days 90"
echo ""
echo " # 2. After adding TXT record in ddns.net panel:"
echo " acme.sh --renew -d ${DOMAIN} --force"
echo ""
echo " # 3. Install certs to project:"
echo " acme.sh --installcert -d ${DOMAIN}"
echo "   --key-file ${CERT_DIR}/key.pem"
echo "   --fullchain-file ${CERT_DIR}/cert.pem"
echo ""
echo " # 4. Enable auto-renewal cron:"
echo " acme.sh --installcron"
echo ""
echo " # 5. Restart the app:"
echo " docker compose -f /path/to/HouseholdReplacementTracker/docker-compose.yml up -d --build"
echo ""
echo " # 6. Access securely:"
echo " https://${DOMAIN}:3000"
echo ""
echo "========================================================"
