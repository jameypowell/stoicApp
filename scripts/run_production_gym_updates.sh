#!/bin/bash
# Run gym membership updates in production via a one-off ECS task.
# The task uses the same task definition as the service (DB credentials in env).
#
# Default: sets Sharla's monthly amount to $50 and discount name to "Loyalty Discount (original price)".
# Override with env vars: EMAIL, AMOUNT, DISCOUNT_NAME
#
# Usage:
#   ./scripts/run_production_gym_updates.sh
#   EMAIL=other@example.com AMOUNT=45 DISCOUNT_NAME="Staff Discount" ./scripts/run_production_gym_updates.sh
#
# Requires: aws CLI, jq, and IAM permission ecs:RunTask (and related) on the cluster.
# If you don't have ecs:RunTask, use scripts/run_production_gym_updates_via_api.sh with an admin token instead.
set -e

CLUSTER_NAME="${CLUSTER_NAME:-stoic-fitness-app}"
SERVICE_NAME="${SERVICE_NAME:-stoic-fitness-service}"
TASK_DEFINITION_FAMILY="${TASK_DEFINITION_FAMILY:-stoic-fitness-app-td}"
CONTAINER_NAME="${CONTAINER_NAME:-stoic-fitness-app}"
AWS_REGION="${AWS_REGION:-us-east-1}"

EMAIL="${EMAIL:-sharla.barber@nebo.edu}"
AMOUNT="${AMOUNT:-50}"
DISCOUNT_NAME="${DISCOUNT_NAME:-Loyalty Discount (original price)}"

echo "Production gym membership update (one-off ECS task)"
echo "  Cluster: $CLUSTER_NAME  Region: $AWS_REGION"
echo "  Email: $EMAIL  Amount: \$$AMOUNT  Discount: $DISCOUNT_NAME"
echo ""

LATEST_TASK_DEF=$(aws ecs describe-task-definition \
  --task-definition "$TASK_DEFINITION_FAMILY" \
  --region "$AWS_REGION" \
  --query 'taskDefinition.taskDefinitionArn' \
  --output text)

NETWORK_CONFIG=$(aws ecs describe-services \
  --cluster "$CLUSTER_NAME" \
  --services "$SERVICE_NAME" \
  --region "$AWS_REGION" \
  --query 'services[0].networkConfiguration.awsvpcConfiguration' \
  --output json)

SUBNET_IDS=$(echo "$NETWORK_CONFIG" | jq -r '.subnets | join(",")')
SECURITY_GROUPS=$(echo "$NETWORK_CONFIG" | jq -r '.securityGroups | join(",")')

# Container override: run set_monthly_amount_for_user.js with env-based args (avoids escaping quotes in JSON).
# Node script sets both monthly_amount_cents and discount_name in one call.
OVERRIDE_ENV=$(jq -n \
  --arg e "$EMAIL" \
  --arg a "$AMOUNT" \
  --arg d "$DISCOUNT_NAME" \
  '[{name:"EMAIL",value:$e},{name:"AMOUNT",value:$a},{name:"DISCOUNT_NAME",value:$d}]')
CMD='node /app/scripts/set_monthly_amount_for_user.js "$EMAIL" "$AMOUNT" "$DISCOUNT_NAME"'
OVERRIDES=$(jq -n \
  --arg name "$CONTAINER_NAME" \
  --arg cmd "$CMD" \
  --argjson env "$OVERRIDE_ENV" \
  '{containerOverrides:[{name:$name,command:["sh","-c",$cmd],environment:$env}]}')

echo "Starting one-off task..."
TASK_ARN=$(aws ecs run-task \
  --cluster "$CLUSTER_NAME" \
  --task-definition "$LATEST_TASK_DEF" \
  --launch-type FARGATE \
  --network-configuration "awsvpcConfiguration={subnets=[$SUBNET_IDS],securityGroups=[$SECURITY_GROUPS],assignPublicIp=ENABLED}" \
  --overrides "$OVERRIDES" \
  --region "$AWS_REGION" \
  --query 'tasks[0].taskArn' \
  --output text)

if [ -z "$TASK_ARN" ] || [ "$TASK_ARN" = "None" ]; then
  echo "Error: Failed to start task (check ecs:RunTask IAM permission)"
  exit 1
fi

TASK_ID=$(echo "$TASK_ARN" | awk -F/ '{print $NF}')
echo "Task ID: $TASK_ID - waiting for completion..."

aws ecs wait tasks-running --cluster "$CLUSTER_NAME" --tasks "$TASK_ARN" --region "$AWS_REGION"
aws ecs wait tasks-stopped --cluster "$CLUSTER_NAME" --tasks "$TASK_ARN" --region "$AWS_REGION"

EXIT_CODE=$(aws ecs describe-tasks \
  --cluster "$CLUSTER_NAME" \
  --tasks "$TASK_ARN" \
  --region "$AWS_REGION" \
  --query 'tasks[0].containers[0].exitCode' \
  --output text)

echo ""
echo "Task finished. Exit code: $EXIT_CODE"
echo ""
echo "Recent log output:"
aws logs tail /ecs/stoic-fitness-app --since 5m --region "$AWS_REGION" --format short --filter-pattern "$TASK_ID" 2>/dev/null || echo "  (Run: aws logs tail /ecs/stoic-fitness-app --since 5m --region $AWS_REGION --filter-pattern $TASK_ID)"
echo ""

exit "${EXIT_CODE:-1}"
