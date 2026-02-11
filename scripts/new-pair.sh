#!/bin/bash
# Generate a new pairing QR code / link
# Usage: ./scripts/new-pair.sh <PIN>

set -e

PIN="${1:?Usage: $0 <PIN>}"
SERVER="http://localhost:6767"
DEVICES_FILE="$HOME/.config/claude-remote/devices.json"
OUTFILE="pair-link.txt"

# Auth requires sha256(pin + deviceToken) — grab first non-expired device token
if [ ! -f "$DEVICES_FILE" ]; then
  echo "Error: no devices file at $DEVICES_FILE"
  echo "Pair a device first via the web UI."
  exit 1
fi

DEVICE_TOKEN=$(jq -r '
  [.[] | select(.tokenExpiresAt > now | todate)] | first | .token // empty
' "$DEVICES_FILE")

if [ -z "$DEVICE_TOKEN" ]; then
  echo "Error: no valid (non-expired) device token found"
  exit 1
fi

AUTH_HASH=$(printf '%s' "${PIN}${DEVICE_TOKEN}" | sha256sum | cut -d' ' -f1)

RESPONSE=$(curl -s -X POST "$SERVER/api/new-pair-token" \
  -H "Authorization: Bearer $AUTH_HASH" \
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
