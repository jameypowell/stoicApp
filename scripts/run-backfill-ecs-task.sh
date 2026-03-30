#!/bin/bash

# Script to run the backfill payment methods script as an ECS one-off task
# This runs the script on the production server where network connectivity is better

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Configuration
AWS_REGION=${AWS_REGION:-us-east-1}
CLUSTER_NAME="stoic-fitness-app"
TASK_DEFINITION_FAMILY="stoic-fitness-app-td"
DRY_RUN=${1:-"--dry-run"}  # Default to dry-run, pass empty string to run live

echo -e "${GREEN}Running Backfill Payment Methods as ECS Task${NC}"
echo "=================================================="

# Get the latest task definition
echo -e "${YELLOW}Fetching latest task definition...${NC}"
LATEST_TASK_DEF=$(aws ecs describe-task-definition \
  --task-definition $TASK_DEFINITION_FAMILY \
  --region $AWS_REGION \
  --query 'taskDefinition.taskDefinitionArn' \
  --output text)

if [ -z "$LATEST_TASK_DEF" ]; then
  echo -e "${RED}Error: Could not find task definition${NC}"
  exit 1
fi

echo "Using task definition: $LATEST_TASK_DEF"

# Get network configuration from the running service
echo -e "${YELLOW}Fetching network configuration from service...${NC}"
SERVICE_NAME="stoic-fitness-service"
NETWORK_CONFIG=$(aws ecs describe-services \
  --cluster $CLUSTER_NAME \
  --services $SERVICE_NAME \
  --region $AWS_REGION \
  --query 'services[0].networkConfiguration.awsvpcConfiguration' \
  --output json)

if [ -z "$NETWORK_CONFIG" ] || [ "$NETWORK_CONFIG" == "null" ]; then
  echo -e "${RED}Error: Could not get network configuration from service${NC}"
  exit 1
fi

SUBNET_IDS=$(echo $NETWORK_CONFIG | jq -r '.subnets | join(",")')
SECURITY_GROUPS=$(echo $NETWORK_CONFIG | jq -r '.securityGroups | join(",")')
ASSIGN_PUBLIC_IP=$(echo $NETWORK_CONFIG | jq -r '.assignPublicIp // "ENABLED"')

echo "Subnets: $SUBNET_IDS"
echo "Security Groups: $SECURITY_GROUPS"
echo "Assign Public IP: $ASSIGN_PUBLIC_IP"

# Determine command based on dry-run flag
if [ "$DRY_RUN" == "--dry-run" ] || [ "$DRY_RUN" == "dry-run" ]; then
  COMMAND="node scripts/backfill-payment-methods.js --dry-run"
  echo -e "${YELLOW}Running in DRY-RUN mode${NC}"
else
  COMMAND="node scripts/backfill-payment-methods.js"
  echo -e "${RED}Running in LIVE mode - will update database!${NC}"
  read -p "Are you sure you want to continue? (yes/no): " confirm
  if [ "$confirm" != "yes" ]; then
    echo "Aborted."
    exit 1
  fi
fi

# Run the task
echo -e "${YELLOW}Starting ECS task...${NC}"
TASK_ARN=$(aws ecs run-task \
  --cluster $CLUSTER_NAME \
  --task-definition $LATEST_TASK_DEF \
  --launch-type FARGATE \
  --network-configuration "awsvpcConfiguration={subnets=[$SUBNET_IDS],securityGroups=[$SECURITY_GROUPS],assignPublicIp=$ASSIGN_PUBLIC_IP}" \
  --overrides "{\"containerOverrides\":[{\"name\":\"stoic-fitness-app\",\"command\":[\"sh\",\"-c\",\"$COMMAND\"]}]}" \
  --region $AWS_REGION \
  --query 'tasks[0].taskArn' \
  --output text)

if [ -z "$TASK_ARN" ] || [ "$TASK_ARN" == "None" ]; then
  echo -e "${RED}Error: Failed to start task${NC}"
  exit 1
fi

echo -e "${GREEN}Task started: $TASK_ARN${NC}"
echo ""
echo -e "${YELLOW}Waiting for task to start...${NC}"

# Wait for task to be running
aws ecs wait tasks-running \
  --cluster $CLUSTER_NAME \
  --tasks $TASK_ARN \
  --region $AWS_REGION

echo -e "${GREEN}Task is running. Streaming logs...${NC}"
echo "Press Ctrl+C to stop streaming (task will continue running)"
echo ""

# Stream logs
TASK_ID=$(echo $TASK_ARN | awk -F/ '{print $NF}')
LOG_STREAM="ecs/stoic-fitness-app/$TASK_ID"

# Wait a moment for logs to start
sleep 5

# Stream logs
aws logs tail "/ecs/stoic-fitness-app" \
  --follow \
  --region $AWS_REGION \
  --filter-pattern "$TASK_ID" || {
  echo -e "${YELLOW}Could not stream logs. Checking task status...${NC}"
}

# Wait for task to complete
echo ""
echo -e "${YELLOW}Waiting for task to complete...${NC}"
aws ecs wait tasks-stopped \
  --cluster $CLUSTER_NAME \
  --tasks $TASK_ARN \
  --region $AWS_REGION

# Get exit code
EXIT_CODE=$(aws ecs describe-tasks \
  --cluster $CLUSTER_NAME \
  --tasks $TASK_ARN \
  --region $AWS_REGION \
  --query 'tasks[0].containers[0].exitCode' \
  --output text)

echo ""
echo -e "${GREEN}Task completed${NC}"
echo "Task ARN: $TASK_ARN"
echo "Exit Code: $EXIT_CODE"

if [ "$EXIT_CODE" == "0" ]; then
  echo -e "${GREEN}✅ Backfill completed successfully!${NC}"
else
  echo -e "${RED}❌ Backfill failed with exit code: $EXIT_CODE${NC}"
  echo "Check logs for details:"
  echo "  aws logs tail /ecs/stoic-fitness-app --follow --region $AWS_REGION"
fi

echo ""
echo "To view full logs:"
echo "  aws logs get-log-events --log-group-name /ecs/stoic-fitness-app --log-stream-name $LOG_STREAM --region $AWS_REGION"
