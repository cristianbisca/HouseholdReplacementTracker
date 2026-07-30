#!/bin/bash
# Generate self-signed TLS certificate for Household Replacement Tracker
# Run this script ONCE to create cert.pem and key.pem in this directory.
#
# Usage:
#   ./generate-cert.sh [domain-or-ip]
#
# Example:
#   ./generate-cert.sh 192.168.1.100
#   ./generate-cert.sh myhome.duckdns.org

set -e

CERT_DIR="$(cd "$(dirname "$0")" && pwd)"
DOMAIN="${1:-localhost}"
DAYS=3650  # Cert valid for 10 years

echo "============================================"
echo " TLS Certificate Generator"
echo "============================================"
echo " Domain/SAN: ${DOMAIN}"
echo " Output dir:   ${CERT_DIR}"
echo " Validity:     ${DAYS} days"
echo "============================================"
echo ""

# Check for openssl
if ! command -v openssl &> /dev/null; then
  echo "ERROR: openssl is not installed."
  echo " Install with: apt install openssl   (Debian/Ubuntu)"
  echo "              apk add openssl        (Alpine)"
  exit 1
fi

# Generate private key + certificate
openssl req -x509 -newkey rsa:4096 \
  -keyout "${CERT_DIR}/key.pem" \
  -out "${CERT_DIR}/cert.pem" \
  -days ${DAYS} \
  -nodes \
  -subj "/CN=${DOMAIN}" \
  -addext "subjectAltName=DNS:${DOMAIN},IP:${DOMAIN},DNS:localhost,IP:127.0.0.1" \
  2>&1 | head -1

# Set restrictive permissions on private key
chmod 600 "${CERT_DIR}/key.pem"
chmod 644 "${CERT_DIR}/cert.pem"

echo ""
echo "============================================"
echo " Certificates generated successfully!"
echo "============================================"
echo " cert.pem: ${CERT_DIR}/cert.pem"
echo " key.pem:  ${CERT_DIR}/key.pem"
echo ""
echo " Next steps:"
echo "  1. Rebuild & restart the container:"
echo "     docker compose up -d --build"
echo "  2. Access via HTTPS:"
echo "     https://${DOMAIN}:3000"
echo ""
echo " NOTE: Self-signed certs will show a browser warning."
echo " Accept the warning to proceed. The connection is still encrypted."
echo " For no warnings, use a trusted cert (e.g., Let's Encrypt via acme.sh)."
echo "============================================"