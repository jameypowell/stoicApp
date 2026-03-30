#!/bin/bash
# Verify host has what deploy needs (Option A). No containers required.
set -e

RED='\033[0;31m'
GREEN='\033[0;32m'
NC='\033[0m'

OK=0

echo "Checking deploy environment (Option A)..."
echo ""

if ! command -v aws &> /dev/null; then
  echo -e "${RED}  AWS CLI: not installed${NC}"
  echo "    Install: https://docs.aws.amazon.com/cli/latest/userguide/getting-started-install.html"
else
  echo -e "${GREEN}  AWS CLI: installed${NC}"
  if aws sts get-caller-identity &> /dev/null; then
    echo -e "${GREEN}  AWS credentials: OK${NC}"
    aws sts get-caller-identity --query 'Arn' --output text
  else
    echo -e "${RED}  AWS credentials: missing or expired${NC}"
    echo "    Run: aws configure"
    OK=1
  fi
fi

if ! command -v docker &> /dev/null; then
  echo -e "${RED}  Docker: not installed${NC}"
  OK=1
else
  echo -e "${GREEN}  Docker: installed${NC}"
  if docker info &> /dev/null; then
    echo -e "${GREEN}  Docker daemon: running${NC}"
  else
    echo -e "${RED}  Docker daemon: not running${NC}"
    OK=1
  fi
fi

echo ""
if [ "$OK" -eq 0 ]; then
  echo -e "${GREEN}Deploy environment OK. You can run ./deploy.sh (no containers needed).${NC}"
  exit 0
else
  echo -e "${RED}Fix the items above, then run ./deploy.sh${NC}"
  echo "  See: DEPLOY_OPTION_A_SETUP.md"
  exit 1
fi
