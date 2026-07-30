#!/bin/bash
# =============================================================
# Issue trusted Let's Encrypt certificate using DNS-01 challenge
# via acme.sh (no port 80/443 needed)
# =============================================================
#
# Usage: ./setup-letsencrypt.sh [your-domain]
# Example: ./setup-letsencrypt.sh myapp.example.com
#
# Since ports 80/443 may be occupied (e.g., by Home Assistant),
# this uses DNS-01 challenge where you manually add a TXT record.
# =============================================================

set -e

DOMAIN="${1:-}"
CERT_DIR="$(cd "$(dirname "$0")" && pwd)"

if [ -z "$DOMAIN" ]; then
  echo "Usage: $0 <domain>"
  echo "Example: $0 myapp.example.com"
  exit 1
fi

echo ""
echo "========================================================"
echo "  Let's Encrypt Setup for ${DOMAIN}"
echo "  (DNS-01 Challenge - Manual TXT Record)"
echo "========================================================"
echo ""
echo " IMPORTANT: You will need to manually add a DNS TXT record"
echo " every ~60 days when the certificate needs renewal."
echo ""

# ----------------------------------------------------------
# STEP 1: Install acme.sh
# ----------------------------------------------------------
if ! command -v acme.sh &> /dev/null; then
  echo "[STEP 1] Installing acme.sh..."
  curl -s https://get.acme.sh | sh
fi

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
echo "  a) Log into your DNS provider control panel"
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
echo " # 2. After adding TXT record in DNS panel:"
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
echo " docker compose up -d --build"
echo ""
echo " # 6. Access securely:"
echo " https://${DOMAIN}:3000"
echo ""
echo "========================================================"