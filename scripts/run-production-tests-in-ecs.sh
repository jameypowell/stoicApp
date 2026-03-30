#!/bin/bash
# Run production tests in the production environment.
# Mode 1: ECS Exec into running task (requires Session Manager plugin).
# Mode 2: One-off ECS task with same image/env (no plugin needed).
set -e

CLUSTER_NAME="${CLUSTER_NAME:-stoic-fitness-app}"
SERVICE_NAME="${SERVICE_NAME:-stoic-fitness-service}"
TASK_DEFINITION_FAMILY="${TASK_DEFINITION_FAMILY:-stoic-fitness-app-td}"
AWS_REGION="${AWS_REGION:-us-east-1}"
PROD_URL="${PROD_URL:-https://app.stoic-fit.com}"

# When running in one-off task, tests hit the live API at PROD_URL
TEST_CMD="PROD_URL=$PROD_URL node scripts/production-tests/index.js"

if command -v session-manager-plugin &>/dev/null; then
  echo "Using ECS Exec (session inside running task)..."
  echo ""

  TASK_ARN=$(aws ecs list-tasks \
    --cluster "$CLUSTER_NAME" \
    --service-name "$SERVICE_NAME" \
    --desired-status RUNNING \
    --region "$AWS_REGION" \
    --query 'taskArns[0]' \
    --output text)

  if [ -z "$TASK_ARN" ] || [ "$TASK_ARN" = "None" ]; then
    echo "No running task found for service $SERVICE_NAME"
    exit 1
  fi

  TASK_ID=$(echo "$TASK_ARN" | cut -d'/' -f3)
  CONTAINER_NAME=$(aws ecs describe-tasks \
    --cluster "$CLUSTER_NAME" \
    --tasks "$TASK_ARN" \
    --region "$AWS_REGION" \
    --query 'tasks[0].containers[0].name' \
    --output text)

  echo "Task: $TASK_ID | Container: $CONTAINER_NAME"
  echo "Running tests (PROD_URL=http://localhost:3000)..."
  echo "----------------------------------------"

  aws ecs execute-command \
    --cluster "$CLUSTER_NAME" \
    --task "$TASK_ID" \
    --container "$CONTAINER_NAME" \
    --region "$AWS_REGION" \
    --interactive \
    --command "PROD_URL=http://localhost:3000 node /app/scripts/production-tests/index.js"
  exit $?
fi

# Fallback: one-off Fargate task (same env as production, tests hit PROD_URL)
echo "Session Manager plugin not found. Running tests as one-off ECS task (production env)."
echo "Tests will hit: $PROD_URL"
echo ""

LATEST_TASK_DEF=$(aws ecs describe-task-definition \
  --task-definition "$TASK_DEFINITION_FAMILY" \
  --region "$AWS_REGION" \
  --query 'taskDefinition.taskDefinitionArn' \
  --output text)

if [ -z "$LATEST_TASK_DEF" ]; then
  echo "Error: Could not find task definition $TASK_DEFINITION_FAMILY"
  exit 1
fi

NETWORK_CONFIG=$(aws ecs describe-services \
  --cluster "$CLUSTER_NAME" \
  --services "$SERVICE_NAME" \
  --region "$AWS_REGION" \
  --query 'services[0].networkConfiguration.awsvpcConfiguration' \
  --output json)

SUBNET_IDS=$(echo "$NETWORK_CONFIG" | jq -r '.subnets | join(",")')
SECURITY_GROUPS=$(echo "$NETWORK_CONFIG" | jq -r '.securityGroups | join(",")')
ASSIGN_PUBLIC_IP=$(echo "$NETWORK_CONFIG" | jq -r '.assignPublicIp // "ENABLED"')

echo "Starting one-off task..."
TASK_ARN=$(aws ecs run-task \
  --cluster "$CLUSTER_NAME" \
  --task-definition "$LATEST_TASK_DEF" \
  --launch-type FARGATE \
  --network-configuration "awsvpcConfiguration={subnets=[$SUBNET_IDS],securityGroups=[$SECURITY_GROUPS],assignPublicIp=$ASSIGN_PUBLIC_IP}" \
  --overrides "{\"containerOverrides\":[{\"name\":\"stoic-fitness-app\",\"command\":[\"sh\",\"-c\",\"$TEST_CMD\"]}]}" \
  --region "$AWS_REGION" \
  --query 'tasks[0].taskArn' \
  --output text)

if [ -z "$TASK_ARN" ] || [ "$TASK_ARN" = "None" ]; then
  echo "Error: Failed to start task"
  echo ""
  echo "If you see AccessDeniedException for ecs:RunTask, add that permission to the IAM user/role"
  echo "used by AWS CLI (e.g. stoic-fitness-app). Alternatively, install the Session Manager plugin"
  echo "and use ECS Exec (tests will run inside the existing task):"
  echo "  https://docs.aws.amazon.com/systems-manager/latest/userguide/session-manager-working-with-install-plugin.html"
  exit 1
fi

TASK_ID=$(echo "$TASK_ARN" | awk -F/ '{print $NF}')
echo "Task ID: $TASK_ID"
echo ""

echo "Waiting for task to run..."
aws ecs wait tasks-running \
  --cluster "$CLUSTER_NAME" \
  --tasks "$TASK_ARN" \
  --region "$AWS_REGION"

echo "Waiting for task to finish..."
aws ecs wait tasks-stopped \
  --cluster "$CLUSTER_NAME" \
  --tasks "$TASK_ARN" \
  --region "$AWS_REGION"

EXIT_CODE=$(aws ecs describe-tasks \
  --cluster "$CLUSTER_NAME" \
  --tasks "$TASK_ARN" \
  --region "$AWS_REGION" \
  --query 'tasks[0].containers[0].exitCode' \
  --output text)

echo ""
echo "----------------------------------------"
echo "Task finished. Exit code: $EXIT_CODE"
echo ""
echo "To view test output in CloudWatch:"
echo "  aws logs tail /ecs/stoic-fitness-app --since 5m --region $AWS_REGION --filter-pattern \"$TASK_ID\""
echo ""

if [ "$EXIT_CODE" = "0" ]; then
  echo "Production tests passed."
  exit 0
else
  echo "Production tests failed (exit code $EXIT_CODE). Check logs above."
  exit 1
fi
