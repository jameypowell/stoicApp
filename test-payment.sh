#!/bin/bash

# Test script for Stripe payment flow
# This script tests the complete payment flow from registration to payment confirmation

BASE_URL="http://localhost:3000"
EMAIL="test@example.com"
PASSWORD="test123"

echo "🧪 Testing Stoic Shop Payment Flow"
echo "=================================="
echo ""

# Colors for output
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Step 1: Register a user
echo -e "${YELLOW}Step 1: Registering user...${NC}"
REGISTER_RESPONSE=$(curl -s -X POST "$BASE_URL/api/auth/register" \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"$EMAIL\",\"password\":\"$PASSWORD\"}")

if echo "$REGISTER_RESPONSE" | grep -q "token"; then
  echo -e "${GREEN}✓ Registration successful${NC}"
  TOKEN=$(echo "$REGISTER_RESPONSE" | grep -o '"token":"[^"]*' | cut -d'"' -f4)
else
  echo -e "${YELLOW}⚠ User may already exist, trying login...${NC}"
  LOGIN_RESPONSE=$(curl -s -X POST "$BASE_URL/api/auth/login" \
    -H "Content-Type: application/json" \
    -d "{\"email\":\"$EMAIL\",\"password\":\"$PASSWORD\"}")
  
  if echo "$LOGIN_RESPONSE" | grep -q "token"; then
    echo -e "${GREEN}✓ Login successful${NC}"
    TOKEN=$(echo "$LOGIN_RESPONSE" | grep -o '"token":"[^"]*' | cut -d'"' -f4)
  else
    echo -e "${RED}✗ Registration/Login failed${NC}"
    echo "$LOGIN_RESPONSE"
    exit 1
  fi
fi

echo "Token: ${TOKEN:0:20}..."
echo ""

# Step 2: Create payment intent
echo -e "${YELLOW}Step 2: Creating payment intent...${NC}"
read -p "Select tier (daily/weekly/monthly) [daily]: " TIER
TIER=${TIER:-daily}

PAYMENT_INTENT_RESPONSE=$(curl -s -X POST "$BASE_URL/api/payments/create-intent" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"tier\":\"$TIER\"}")

if echo "$PAYMENT_INTENT_RESPONSE" | grep -q "clientSecret"; then
  echo -e "${GREEN}✓ Payment intent created${NC}"
  CLIENT_SECRET=$(echo "$PAYMENT_INTENT_RESPONSE" | grep -o '"clientSecret":"[^"]*' | cut -d'"' -f4)
  PAYMENT_INTENT_ID=$(echo "$PAYMENT_INTENT_RESPONSE" | grep -o '"paymentIntentId":"[^"]*' | cut -d'"' -f4)
  AMOUNT=$(echo "$PAYMENT_INTENT_RESPONSE" | grep -o '"amount":[0-9]*' | cut -d':' -f2)
  
  echo "Client Secret: ${CLIENT_SECRET:0:30}..."
  echo "Amount: \$$(echo "scale=2; $AMOUNT/100" | bc)"
  echo ""
else
  echo -e "${RED}✗ Failed to create payment intent${NC}"
  echo "$PAYMENT_INTENT_RESPONSE"
  exit 1
fi

# Step 3: Explain how to complete payment
echo -e "${YELLOW}Step 3: Complete payment with Stripe CLI${NC}"
echo ""
echo "To test the payment, you have two options:"
echo ""
echo "Option A: Use Stripe CLI to simulate payment"
echo "  stripe payment_intents confirm $CLIENT_SECRET"
echo ""
echo "Option B: Manually confirm payment via API"
echo "  curl -X POST $BASE_URL/api/payments/confirm \\"
echo "    -H 'Authorization: Bearer $TOKEN' \\"
echo "    -H 'Content-Type: application/json' \\"
echo "    -d '{\"paymentIntentId\":\"$PAYMENT_INTENT_ID\",\"tier\":\"$TIER\"}'"
echo ""
echo -e "${YELLOW}Testing payment confirmation...${NC}"
read -p "Do you want to test payment confirmation now? (y/n) [n]: " CONFIRM
CONFIRM=${CONFIRM:-n}

if [ "$CONFIRM" = "y" ]; then
  CONFIRM_RESPONSE=$(curl -s -X POST "$BASE_URL/api/payments/confirm" \
    -H "Authorization: Bearer $TOKEN" \
    -H "Content-Type: application/json" \
    -d "{\"paymentIntentId\":\"$PAYMENT_INTENT_ID\",\"tier\":\"$TIER\"}")
  
  if echo "$CONFIRM_RESPONSE" | grep -q "activated"; then
    echo -e "${GREEN}✓ Payment confirmed and subscription activated!${NC}"
    echo "$CONFIRM_RESPONSE" | jq '.' 2>/dev/null || echo "$CONFIRM_RESPONSE"
  else
    echo -e "${RED}✗ Payment confirmation failed${NC}"
    echo "$CONFIRM_RESPONSE"
  fi
fi

echo ""
echo -e "${GREEN}Test complete!${NC}"

