#!/bin/bash

# Script to run tests against production environment
# This script runs the test suite against the production API

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${GREEN}Production Test Runner${NC}"
echo "================================"
echo ""

# Configuration
PROD_URL=${PROD_URL:-"http://stoic-shop-alb-123456789.us-east-1.elb.amazonaws.com"}
TEST_TIMEOUT=30000

# Check if production URL is provided
if [ -z "$PROD_URL" ] || [ "$PROD_URL" == "http://stoic-shop-alb-123456789.us-east-1.elb.amazonaws.com" ]; then
    echo -e "${YELLOW}Warning: PROD_URL not set.${NC}"
    echo "Please set PROD_URL environment variable to your production API URL"
    echo "Example: export PROD_URL=http://your-alb-dns-name.elb.amazonaws.com"
    echo ""
    echo "Attempting to get ALB DNS name from AWS..."
    
    # Try to get ALB DNS name from AWS
    if command -v aws &> /dev/null; then
        REGION=${AWS_REGION:-us-east-1}
        ALB_ARN=$(aws elbv2 describe-load-balancers --region $REGION --query 'LoadBalancers[?contains(LoadBalancerName, `stoic`) || contains(LoadBalancerName, `shop`)].DNSName' --output text 2>/dev/null | head -1)
        if [ ! -z "$ALB_ARN" ]; then
            PROD_URL="http://${ALB_ARN}"
            echo -e "${GREEN}Found ALB: ${PROD_URL}${NC}"
        else
            echo -e "${RED}Could not find ALB. Please set PROD_URL manually.${NC}"
            exit 1
        fi
    else
        echo -e "${RED}AWS CLI not found. Please set PROD_URL manually.${NC}"
        exit 1
    fi
fi

echo -e "${GREEN}Testing against: ${PROD_URL}${NC}"
echo ""

# Check if production is accessible (follow redirects and handle HTTPS)
echo "▶ Checking production health..."
HEALTH_RESPONSE=$(curl -s -L -k -o /dev/null -w "%{http_code}" "${PROD_URL}/health" 2>&1 | tail -1)

# If PROD_URL is HTTP but redirects to HTTPS, try HTTPS
if [ "$HEALTH_RESPONSE" = "301" ] || [ "$HEALTH_RESPONSE" = "302" ] || [ "$HEALTH_RESPONSE" = "301000" ] || [ "$HEALTH_RESPONSE" = "302000" ]; then
    HTTPS_URL=$(echo "$PROD_URL" | sed 's|^http://|https://|')
    echo "   HTTP redirect detected, trying HTTPS..."
    HEALTH_RESPONSE=$(curl -s -L -k -o /dev/null -w "%{http_code}" "${HTTPS_URL}/health" 2>&1 | tail -1)
    if [ "$HEALTH_RESPONSE" = "200" ]; then
        PROD_URL="$HTTPS_URL"
        echo -e "${GREEN}✅ Using HTTPS: ${PROD_URL}${NC}"
    fi
fi

if [ "$HEALTH_RESPONSE" != "200" ]; then
    echo -e "${RED}❌ Production health check failed (HTTP ${HEALTH_RESPONSE})${NC}"
    echo "   Production may be unreachable or unhealthy"
    echo ""
    echo "   Troubleshooting:"
    echo "   1. Check if the ECS service is running:"
    echo "      aws ecs describe-services --cluster stoic-fitness-app --services stoic-fitness-service --region us-east-1"
    echo ""
    echo "   2. Check ALB target health:"
    echo "      aws elbv2 describe-target-health --target-group-arn <target-group-arn> --region us-east-1"
    echo ""
    exit 1
fi

echo -e "${GREEN}✅ Production is healthy${NC}"
echo ""

# Run tests with production URL override
echo "▶ Running test suite against production..."
echo ""

# Note: The tests are currently designed to run against a local database
# For true production testing, we would need to:
# 1. Create API integration tests that test endpoints
# 2. Or run tests inside a production container
# 3. Or use a test database that mirrors production schema

echo -e "${YELLOW}Note: Current tests are unit tests that use a local test database.${NC}"
echo -e "${YELLOW}For production integration testing, we need API endpoint tests.${NC}"
echo ""

# Run the test suite (it will still use local test DB, but we can add API tests)
cd "$(dirname "$0")/.."

# Run unit tests
echo "▶ Running unit tests..."
npm test

# Run production API integration tests if PROD_URL is set
if [ ! -z "$PROD_URL" ] && [ "$PROD_URL" != "http://stoic-shop-alb-123456789.us-east-1.elb.amazonaws.com" ]; then
    echo ""
    echo "▶ Running production API integration tests..."
    echo "   Testing against: ${PROD_URL}"
    echo ""
    
    # Run production API tests
    PROD_URL="$PROD_URL" npm test -- tests/production-api.test.js || {
        echo -e "${RED}❌ Production API tests failed${NC}"
        exit 1
    }
    
    echo ""
    echo -e "${GREEN}✅ Production API tests passed${NC}"
fi

echo ""
echo -e "${GREEN}✅ All tests passed${NC}"
echo ""
echo -e "${GREEN}Production deployment verified:${NC}"
echo "  - Service is healthy"
echo "  - Unit tests passed"
if [ ! -z "$PROD_URL" ] && [ "$PROD_URL" != "http://stoic-shop-alb-123456789.us-east-1.elb.amazonaws.com" ]; then
    echo "  - Production API integration tests passed"
    echo "    ✓ User registration with password"
    echo "    ✓ User login with password"
    echo "    ✓ Password reset request"
    echo "    ✓ Password reset with token"
fi
echo ""
echo -e "${YELLOW}Next steps for full production testing:${NC}"
echo "  1. Test subscription tiers against production API"
echo "  2. Test workout access logic against production database"
echo "  3. Test payment flow end-to-end"

