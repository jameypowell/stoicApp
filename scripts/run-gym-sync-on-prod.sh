#!/bin/bash
# Run gym membership sync on production as one-off ECS task
set -e

CLUSTER_NAME="${CLUSTER_NAME:-stoic-fitness-app}"
SERVICE_NAME="${SERVICE_NAME:-stoic-fitness-service}"
TASK_DEFINITION_FAMILY="${TASK_DEFINITION_FAMILY:-stoic-fitness-app-td}"
AWS_REGION="${AWS_REGION:-us-east-1}"

CMD="node /app/scripts/run-gym-sync.js"

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

echo "Starting one-off task to run gym membership sync..."
TASK_ARN=$(aws ecs run-task \
  --cluster "$CLUSTER_NAME" \
  --task-definition "$LATEST_TASK_DEF" \
  --launch-type FARGATE \
  --network-configuration "awsvpcConfiguration={subnets=[$SUBNET_IDS],securityGroups=[$SECURITY_GROUPS],assignPublicIp=ENABLED}" \
  --overrides "{\"containerOverrides\":[{\"name\":\"stoic-fitness-app\",\"command\":[\"sh\",\"-c\",\"$CMD\"]}]}" \
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
echo "Output (from CloudWatch logs):"
aws logs tail /ecs/stoic-fitness-app --since 5m --region "$AWS_REGION" --format short --filter-pattern "$TASK_ID" 2>/dev/null || echo "Run: aws logs tail /ecs/stoic-fitness-app --since 5m --region $AWS_REGION --filter-pattern $TASK_ID"
echo ""

exit "$EXIT_CODE"
