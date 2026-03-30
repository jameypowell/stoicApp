#!/bin/bash
# Quick fix execution - prompts for credentials if needed

API_URL="https://stoic-fit.com/api"

echo "🔧 Exercise Fix Execution"
echo "========================="
echo ""

# Check if credentials provided
if [ -z "$ADMIN_EMAIL" ] || [ -z "$ADMIN_PASSWORD" ]; then
    echo "Admin credentials required:"
    read -p "Admin Email: " ADMIN_EMAIL
    read -sp "Admin Password: " ADMIN_PASSWORD
    echo ""
fi

# Authenticate
echo "🔐 Authenticating..."
TOKEN_RESPONSE=$(curl -s -X POST "${API_URL}/auth/login" \
    -H "Content-Type: application/json" \
    -d "{\"email\":\"${ADMIN_EMAIL}\",\"password\":\"${ADMIN_PASSWORD}\"}")

TOKEN=$(echo "$TOKEN_RESPONSE" | python3 -c "import sys, json; data=json.load(sys.stdin); print(data.get('token', ''))" 2>/dev/null)

if [ -z "$TOKEN" ]; then
    echo "❌ Authentication failed"
    echo "$TOKEN_RESPONSE" | python3 -m json.tool 2>/dev/null || echo "$TOKEN_RESPONSE"
    exit 1
fi

echo "✅ Authenticated"
echo ""
echo "🚀 Running fix..."

# Execute fix
FIX_RESPONSE=$(curl -s -X POST "${API_URL}/admin/workouts/fix-exercises" \
    -H "Authorization: Bearer ${TOKEN}" \
    -H "Content-Type: application/json")

echo "$FIX_RESPONSE" | python3 -m json.tool

SUCCESS=$(echo "$FIX_RESPONSE" | python3 -c "import sys, json; data=json.load(sys.stdin); print(data.get('success', False))" 2>/dev/null)

if [ "$SUCCESS" = "True" ]; then
    echo ""
    echo "✅ Fix completed successfully!"
else
    echo ""
    echo "❌ Fix failed"
    exit 1
fi



















