# Required IAM Permissions for Running Backfill ECS Task

The script `run-backfill-ecs-task.sh` requires the following IAM permissions to run ECS tasks:

## Required Permissions

The IAM user/role needs these permissions:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "ecs:RunTask",
        "ecs:DescribeTasks",
        "ecs:DescribeTaskDefinition",
        "ecs:DescribeServices",
        "ecs:ListTasks"
      ],
      "Resource": "*"
    },
    {
      "Effect": "Allow",
      "Action": [
        "ec2:DescribeVpcs",
        "ec2:DescribeSubnets",
        "ec2:DescribeSecurityGroups"
      ],
      "Resource": "*"
    },
    {
      "Effect": "Allow",
      "Action": [
        "logs:GetLogEvents",
        "logs:DescribeLogStreams",
        "logs:FilterLogEvents",
        "logs:TailLogGroup"
      ],
      "Resource": "arn:aws:logs:*:*:log-group:/ecs/stoic-fitness-app:*"
    },
    {
      "Effect": "Allow",
      "Action": [
        "iam:PassRole"
      ],
      "Resource": "arn:aws:iam::*:role/ecsTaskExecutionRole"
    }
  ]
}
```

## How to Grant Permissions

### Option 1: Add to Existing IAM User

1. Go to AWS Console → IAM → Users
2. Select the user (e.g., `stoic-fitness-app`)
3. Click "Add permissions" → "Attach policies directly"
4. Create a new policy with the permissions above, or attach an existing policy that includes these permissions

### Option 2: Use AWS Admin Account

If you have access to an admin account, you can run the script with those credentials:

```bash
aws configure --profile admin
AWS_PROFILE=admin ./scripts/run-backfill-ecs-task.sh --dry-run
```

### Option 3: Run via AWS Console

You can manually run the task via the AWS Console:

1. Go to ECS → Clusters → `stoic-fitness-app`
2. Click "Tasks" tab → "Run new task"
3. Select:
   - Launch type: Fargate
   - Task definition: `stoic-fitness-app-td` (latest)
   - Cluster: `stoic-fitness-app`
   - Network: Use the same configuration as the service
4. Under "Container overrides":
   - Container name: `stoic-fitness-app`
   - Command override: `sh,-c,node scripts/backfill-payment-methods.js --dry-run`
5. Click "Run task"
6. Monitor logs in CloudWatch

## Alternative: Run Script Locally with Production Credentials

If you can't get ECS RunTask permissions, you can run the script locally but connect to production:

```bash
# Set production database credentials
export DB_HOST="stoic-fitness-pg.c7c9btnoxixy.us-east-1.rds.amazonaws.com"
export DB_USER="stoicapp"
export DB_NAME="postgres"
export DB_PORT="5432"
export DB_PASSWORD="StoicDBtrong"

# Get production Stripe key (script does this automatically)
# Then run:
node scripts/backfill-payment-methods.js --dry-run
```

However, this may still have network connectivity issues to Stripe from your local machine.
