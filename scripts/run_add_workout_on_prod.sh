#!/bin/bash
# Run add_functional_fitness_workout.js in production via a one-off ECS task.
# The task uses the same task definition as the service (DB credentials in env).
#
# Usage:
#   ./scripts/run_add_workout_on_prod.sh                    # add workout for tomorrow
#   WORKOUT_DATE=2026-03-09 ./scripts/run_add_workout_on_prod.sh   # add for specific date
#
# Requires: aws CLI, jq, and IAM permission ecs:RunTask (and related) on the cluster.
set -e

CLUSTER_NAME="${CLUSTER_NAME:-stoic-fitness-app}"
SERVICE_NAME="${SERVICE_NAME:-stoic-fitness-service}"
TASK_DEFINITION_FAMILY="${TASK_DEFINITION_FAMILY:-stoic-fitness-app-td}"
CONTAINER_NAME="${CONTAINER_NAME:-stoic-fitness-app}"
AWS_REGION="${AWS_REGION:-us-east-1}"

WORKOUT_DATE="${WORKOUT_DATE:-}"

echo "Production: add functional fitness workout (one-off ECS task)"
echo "  Cluster: $CLUSTER_NAME  Region: $AWS_REGION"
if [ -n "$WORKOUT_DATE" ]; then
  echo "  Date: $WORKOUT_DATE"
else
  echo "  Date: tomorrow (computed by script)"
fi
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

if [ -n "$WORKOUT_DATE" ]; then
  CMD="node /app/scripts/add_functional_fitness_workout.js $WORKOUT_DATE"
else
  CMD="node /app/scripts/add_functional_fitness_workout.js"
fi

OVERRIDES=$(jq -n \
  --arg name "$CONTAINER_NAME" \
  --arg cmd "$CMD" \
  '{containerOverrides:[{name:$name,command:["sh","-c",$cmd]}]}')

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
