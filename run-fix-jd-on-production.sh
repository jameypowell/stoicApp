#!/bin/bash

# Script to run fix-jd-production.js on production server
# This can be executed via AWS ECS exec or SSH

echo "🚨 Running JD Nielson account fix on production..."
echo ""

# Option 1: Run via AWS ECS exec (if you have the cluster/task info)
# Uncomment and modify these lines:
# CLUSTER_NAME="your-ecs-cluster-name"
# TASK_ID=$(aws ecs list-tasks --cluster $CLUSTER_NAME --service-name stoic-shop --query 'taskArns[0]' --output text | cut -d'/' -f3)
# CONTAINER_NAME="stoic-shop"
# 
# echo "Executing on ECS task: $TASK_ID"
# aws ecs execute-command \
#   --cluster $CLUSTER_NAME \
#   --task $TASK_ID \
#   --container $CONTAINER_NAME \
#   --interactive \
#   --command "node /app/fix-jd-production.js"

# Option 2: Run directly if you're already on the production server
# Just run: node fix-jd-production.js

# Option 3: Copy script to server and run
# scp fix-jd-production.js user@production-server:/path/to/app/
# ssh user@production-server "cd /path/to/app && node fix-jd-production.js"

echo "To run this fix, choose one of the following:"
echo ""
echo "1. If you have AWS ECS access:"
echo "   aws ecs execute-command --cluster <cluster> --task <task-id> --container <container> --interactive --command 'node /app/fix-jd-production.js'"
echo ""
echo "2. If you have SSH access to production server:"
echo "   ssh user@production-server"
echo "   cd /path/to/app"
echo "   node fix-jd-production.js"
echo ""
echo "3. Use the admin API endpoint (fastest):"
echo "   See FIX_JD_NOW.md for browser console method"


