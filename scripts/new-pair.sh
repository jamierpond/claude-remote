#!/bin/bash
# Generate a new pairing QR code / link
# Usage: ./scripts/new-pair.sh <PIN>

set -e

PIN="${1:?Usage: $0 <PIN>}"
SERVER="http://localhost:6767"
OUTFILE="pair-link.txt"

RESPONSE=$(curl -s -X POST "$SERVER/api/new-pair-token" \
  -H "Authorization: Bearer $PIN" \
  -H "Content-Type: application/json")

URL=$(echo "$RESPONSE" | jq -r '.pairingUrl // empty')

if [ -z "$URL" ]; then
  echo "Error: failed to get pairing URL"
  echo "Response: $RESPONSE"
  exit 1
fi

echo "$URL" > "$OUTFILE"
echo "Pairing URL saved to $OUTFILE"
echo ""
echo "$URL"
echo ""
# QR also printed to server logs by the API endpoint
echo "(QR code printed in server logs — run: make logs)"
