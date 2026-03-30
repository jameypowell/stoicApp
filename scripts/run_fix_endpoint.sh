#!/bin/bash

# Script to call the fix exercises endpoint
# Usage: ./scripts/run_fix_endpoint.sh <ADMIN_TOKEN>

if [ -z "$1" ]; then
    echo "Usage: ./scripts/run_fix_endpoint.sh <ADMIN_TOKEN>"
    echo ""
    echo "To get a token, log in as admin and get the token from localStorage or API response"
    exit 1
fi

TOKEN=$1
API_URL="${API_URL:-https://stoic-fit.com/api}"

echo "🔧 Calling fix exercises endpoint..."
echo ""

response=$(curl -s -X POST "${API_URL}/admin/workouts/fix-exercises" \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Content-Type: application/json")

echo "$response" | python3 -m json.tool 2>/dev/null || echo "$response"



















