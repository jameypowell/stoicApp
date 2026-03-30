#!/bin/bash
# Run gym membership updates in production by calling the admin API.
# No ECS RunTask or DB access needed — you only need an admin JWT.
#
# 1. Log in at https://app.stoic-fit.com as admin.
# 2. DevTools → Application → Local Storage → copy the "token" value.
# 3. Export it and run:
#      export ADMIN_TOKEN="eyJ..."
#      ./scripts/run_production_gym_updates_via_api.sh
#
# Override: EMAIL, AMOUNT, DISCOUNT_NAME, PRODUCTION_URL (default https://app.stoic-fit.com)
set -e

PRODUCTION_URL="${PRODUCTION_URL:-https://app.stoic-fit.com}"
EMAIL="${EMAIL:-sharla.barber@nebo.edu}"
AMOUNT="${AMOUNT:-50}"
DISCOUNT_NAME="${DISCOUNT_NAME:-Loyalty Discount (original price)}"

if [ -z "$ADMIN_TOKEN" ]; then
  echo "Error: ADMIN_TOKEN is required."
  echo "  1. Log in at $PRODUCTION_URL as admin"
  echo "  2. DevTools → Application → Local Storage → copy the 'token' value"
  echo "  3. Run: export ADMIN_TOKEN=\"<paste>\""
  echo "  4. Run this script again"
  exit 1
fi

API="${PRODUCTION_URL}/api"
echo "Production gym membership update (admin API)"
echo "  URL: $API"
echo "  Email: $EMAIL  Amount: \$$AMOUNT  Discount: $DISCOUNT_NAME"
echo ""

RESP=$(curl -s -w "\n%{http_code}" -X POST "${API}/admin/gym-memberships/set-discount-name" \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"$EMAIL\",\"discount_name\":\"$DISCOUNT_NAME\",\"monthly_amount_dollars\":$AMOUNT}")

BODY=$(echo "$RESP" | head -n -1)
CODE=$(echo "$RESP" | tail -n 1)

if [ "$CODE" = "200" ]; then
  echo "Success: $BODY"
  echo ""
  echo "Have Sharla refresh her My Account page to see the discount breakdown (\$$AMOUNT total, base \$65, discount line)."
else
  echo "Request failed (HTTP $CODE)"
  echo "$BODY"
  exit 1
fi
