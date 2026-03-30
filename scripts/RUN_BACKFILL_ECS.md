# Running Backfill Payment Methods as ECS Task

This guide explains how to run the backfill payment methods script as an ECS one-off task on the production server.

## Why Run as ECS Task?

Running the backfill script as an ECS task has several advantages:
- Better network connectivity to Stripe API
- Access to production database credentials automatically
- Runs in the same environment as the production application
- Logs are automatically captured in CloudWatch

## Prerequisites

- AWS CLI configured with appropriate permissions
- Access to the ECS cluster and task definitions
- The backfill script must be included in the Docker image

## Usage

### Dry Run (Recommended First)

Test the script without making any changes:

```bash
./scripts/run-backfill-ecs-task.sh --dry-run
```

### Live Run

Run the script to actually update the database:

```bash
./scripts/run-backfill-ecs-task.sh live
```

**Note:** The script will prompt for confirmation before running in live mode.

## What the Script Does

1. Fetches the latest task definition from ECS
2. Gets network configuration from the running service
3. Runs a one-off ECS task with the backfill script
4. Streams logs in real-time
5. Waits for task completion and reports exit code

## Monitoring

### View Logs in Real-Time

The script automatically streams logs, but you can also view them manually:

```bash
# View all recent logs
aws logs tail /ecs/stoic-fitness-app --follow --region us-east-1

# View logs for a specific task
TASK_ID="your-task-id"
aws logs get-log-events \
  --log-group-name /ecs/stoic-fitness-app \
  --log-stream-name "ecs/stoic-fitness-app/$TASK_ID" \
  --region us-east-1
```

### Check Task Status

```bash
# Get task status
aws ecs describe-tasks \
  --cluster stoic-fitness-app \
  --tasks <TASK_ARN> \
  --region us-east-1

# List recent tasks
aws ecs list-tasks \
  --cluster stoic-fitness-app \
  --region us-east-1
```

## Troubleshooting

### Task Fails to Start

- Check that the task definition exists
- Verify network configuration (subnets, security groups)
- Ensure the Docker image includes the backfill script

### Connection Errors to Stripe

- The script includes timeouts and retries
- Check CloudWatch logs for specific error messages
- Verify the Stripe API key is correct in the task definition

### Database Connection Errors

- Verify database credentials are set in the task definition
- Check security group allows outbound connections to RDS
- Ensure the database is accessible from the VPC

## Expected Output

The script will:
- Process all subscriptions without payment methods
- Process all gym memberships without payment methods
- Report how many were updated and any errors
- Complete in a few minutes depending on the number of subscriptions

## After Running

Once the backfill completes successfully:
- New payments will automatically save payment methods
- The nightly renewal job can use the saved payment methods
- Users with saved payment methods won't need to re-enter them
