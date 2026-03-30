#!/bin/bash

# Deployment script for Stoic Shop
# This script helps build and deploy the application
#
# Usage:
#   ./deploy.sh              # core deploy (ECR + ECS) + optional Step 6 if env vars allow
#   ./deploy.sh --no-optional   # core deploy only (skip API/DB/ECS one-off/backfill hooks)
# Or: DEPLOY_SKIP_OPTIONAL=1 ./deploy.sh

set -e

SKIP_OPTIONAL=0
for arg in "$@"; do
    if [ "$arg" = "--no-optional" ]; then
        SKIP_OPTIONAL=1
    fi
done
if [ "${DEPLOY_SKIP_OPTIONAL:-}" = "1" ] || [ "${DEPLOY_SKIP_OPTIONAL:-}" = "true" ]; then
    SKIP_OPTIONAL=1
fi

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Configuration (update these)
AWS_REGION=${AWS_REGION:-us-east-1}
AWS_ACCOUNT_ID=${AWS_ACCOUNT_ID:-""}
ECR_REPO=${ECR_REPO:-"stoic-fitness-app"}

echo -e "${GREEN}Stoic Shop Deployment Script${NC}"
echo "================================"

# Check if AWS CLI is installed
if ! command -v aws &> /dev/null; then
    echo -e "${RED}Error: AWS CLI is not installed${NC}"
    echo "  Install: https://docs.aws.amazon.com/cli/latest/userguide/getting-started-install.html"
    exit 1
fi

# Check if Docker is installed
if ! command -v docker &> /dev/null; then
    echo -e "${RED}Error: Docker is not installed${NC}"
    exit 1
fi

# Option A: Verify AWS credentials on host (no containers required)
if ! aws sts get-caller-identity &> /dev/null; then
    echo -e "${RED}Error: AWS credentials not configured or expired${NC}"
    echo "  Run: aws configure"
    echo "  Or set AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY"
    echo "  See: DEPLOY_OPTION_A_SETUP.md"
    exit 1
fi

# Get AWS account ID if not set
if [ -z "$AWS_ACCOUNT_ID" ]; then
    echo -e "${YELLOW}Fetching AWS account ID...${NC}"
    AWS_ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
fi

ECR_URI="${AWS_ACCOUNT_ID}.dkr.ecr.${AWS_REGION}.amazonaws.com/${ECR_REPO}"

echo -e "${GREEN}Configuration:${NC}"
echo "  AWS Region: $AWS_REGION"
echo "  AWS Account: $AWS_ACCOUNT_ID"
echo "  ECR Repository: $ECR_URI"
echo ""

# Step 1: Login to ECR
echo -e "${YELLOW}Step 1: Logging into ECR...${NC}"
aws ecr get-login-password --region $AWS_REGION | docker login --username AWS --password-stdin $ECR_URI

# Step 2: Build Docker image for linux/amd64 platform
echo -e "${YELLOW}Step 2: Building Docker image for linux/amd64 platform...${NC}"
docker buildx build --platform linux/amd64 -t $ECR_REPO:latest --load .

# Step 3: Tag image
echo -e "${YELLOW}Step 3: Tagging image...${NC}"
docker tag $ECR_REPO:latest $ECR_URI:latest

# Step 4: Push to ECR
echo -e "${YELLOW}Step 4: Pushing to ECR...${NC}"
docker push $ECR_URI:latest

# Step 5: Force ECS service update
echo -e "${YELLOW}Step 5: Updating ECS service...${NC}"
CLUSTER_NAME="stoic-fitness-app"
SERVICE_NAME="stoic-fitness-service"

aws ecs update-service \
    --cluster $CLUSTER_NAME \
    --service $SERVICE_NAME \
    --force-new-deployment \
    --region $AWS_REGION \
    > /dev/null

echo -e "${GREEN}Deployment initiated!${NC}"
echo -e "${YELLOW}Monitor deployment status:${NC}"
echo "  aws ecs describe-services --cluster $CLUSTER_NAME --services $SERVICE_NAME --region $AWS_REGION"
echo ""
echo -e "${YELLOW}View logs:${NC}"
echo "  aws logs tail /ecs/stoic-fitness-app --follow --region $AWS_REGION"
echo ""

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

if [ "$SKIP_OPTIONAL" = "1" ]; then
    echo -e "${YELLOW}Skipping Step 6 (optional hooks): --no-optional or DEPLOY_SKIP_OPTIONAL=1${NC}"
    echo ""
    echo -e "${GREEN}Core deployment complete.${NC}"
    exit 0
fi

# Step 6: Run production fixes (non-interactive; skip steps that lack credentials)
echo -e "${YELLOW}Step 6: Production fixes...${NC}"

# Load .env so ADMIN_TOKEN, DB_*, ADMIN_EMAIL, ADMIN_PASSWORD can be used if set
if [ -f .env ]; then
    set -a
    # shellcheck source=/dev/null
    source .env 2>/dev/null || true
    set +a
fi

PRODUCTION_URL="${PRODUCTION_URL:-https://app.stoic-fit.com}"
API_URL="${API_URL:-${PRODUCTION_URL}/api}"

# 6a: Sharla gym update via admin API (if ADMIN_TOKEN set)
if [ -n "$ADMIN_TOKEN" ]; then
    echo "  Running gym membership update for sharla.barber@nebo.edu (via API)..."
    if EMAIL="${EMAIL:-sharla.barber@nebo.edu}" AMOUNT="${AMOUNT:-50}" DISCOUNT_NAME="${DISCOUNT_NAME:-Loyalty Discount (original price)}" PRODUCTION_URL="$PRODUCTION_URL" ./scripts/run_production_gym_updates_via_api.sh 2>/dev/null; then
        echo -e "  ${GREEN}✓ Gym update (API) done${NC}"
    else
        echo -e "  ${YELLOW}  Gym update (API) skipped or failed${NC}"
    fi
else
    echo "  Skipping gym update via API (ADMIN_TOKEN not set)"
fi

# 6b: Exercise fix via admin API (if ADMIN_EMAIL and ADMIN_PASSWORD set)
if [ -n "$ADMIN_EMAIL" ] && [ -n "$ADMIN_PASSWORD" ]; then
    echo "  Running exercise fix (via API)..."
    if API_URL="$API_URL" ./scripts/execute_fix.sh 2>/dev/null; then
        echo -e "  ${GREEN}✓ Exercise fix (API) done${NC}"
    else
        echo -e "  ${YELLOW}  Exercise fix (API) skipped or failed${NC}"
    fi
else
    echo "  Skipping exercise fix via API (ADMIN_EMAIL/ADMIN_PASSWORD not set)"
fi

# 6c: Exercise fix via direct DB (if DB_HOST set)
if [ -n "$DB_HOST" ] && [ -n "$DB_USER" ] && [ -n "$DB_PASSWORD" ]; then
    echo "  Running exercise fix (direct DB)..."
    if node scripts/fix_production_exercises.js 2>/dev/null; then
        echo -e "  ${GREEN}✓ Exercise fix (DB) done${NC}"
    else
        echo -e "  ${YELLOW}  Exercise fix (DB) skipped or failed${NC}"
    fi
else
    echo "  Skipping exercise fix via DB (DB_HOST/DB_USER/DB_PASSWORD not set)"
fi

# 6d: Sharla gym update via one-off ECS task (may fail if no ecs:RunTask permission)
echo "  Running gym membership update (ECS one-off task)..."
if ./scripts/run_production_gym_updates.sh 2>/dev/null; then
    echo -e "  ${GREEN}✓ Gym update (ECS) done${NC}"
else
    echo -e "  ${YELLOW}  Gym update (ECS) skipped or failed (e.g. no ecs:RunTask)${NC}"
fi

# 6e: Add functional fitness workout for tomorrow via one-off ECS task (uses container DB credentials)
echo "  Running add functional fitness workout (ECS one-off task)..."
if ./scripts/run_add_workout_on_prod.sh 2>/dev/null; then
    echo -e "  ${GREEN}✓ Add workout (ECS) done${NC}"
else
    echo -e "  ${YELLOW}  Add workout (ECS) skipped or failed (e.g. no ecs:RunTask)${NC}"
fi

# 6f: Backfill payment_method_id from Stripe for all eligible app + gym rows (requires DB + Stripe in .env)
if [ -n "$DB_HOST" ] && [ -n "$DB_PASSWORD" ] && [ -n "$STRIPE_SECRET_KEY" ]; then
    echo "  Running payment method backfill (Stripe → DB)..."
    if node scripts/backfill-payment-methods.js 2>/dev/null; then
        echo -e "  ${GREEN}✓ Payment method backfill done${NC}"
    else
        echo -e "  ${YELLOW}  Payment method backfill skipped or failed (check DB_HOST/STRIPE_SECRET_KEY)${NC}"
    fi
else
    echo "  Skipping payment method backfill (set DB_HOST, DB_PASSWORD, STRIPE_SECRET_KEY in .env to run after deploy)"
fi

echo ""
echo -e "${GREEN}Deployment and production fixes complete.${NC}"
