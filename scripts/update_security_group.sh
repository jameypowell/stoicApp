#!/bin/bash

# Add your IP to the RDS security group to allow connections
# Usage: ./scripts/update_security_group.sh [--remove]

REGION=us-east-1
SECURITY_GROUP_ID=sg-0a72ab83253d48cbd

# Get your public IP
MY_IP=$(curl -s https://checkip.amazonaws.com)
echo "Your IP: $MY_IP"

if [ "$1" == "--remove" ]; then
  echo "🗑️  Removing IP $MY_IP from security group..."
  aws ec2 revoke-security-group-ingress \
    --group-id $SECURITY_GROUP_ID \
    --protocol tcp \
    --port 5432 \
    --cidr $MY_IP/32 \
    --region $REGION
  echo "✓ IP removed"
  exit 0
fi

echo "➕ Adding IP $MY_IP/32 to security group $SECURITY_GROUP_ID..."
aws ec2 authorize-security-group-ingress \
  --group-id $SECURITY_GROUP_ID \
  --protocol tcp \
  --port 5432 \
  --cidr $MY_IP/32 \
  --region $REGION

if [ $? -eq 0 ]; then
  echo "✓ IP added successfully"
  echo "⚠️  Remember to remove it after migration with: ./scripts/update_security_group.sh --remove"
else
  echo "⚠️  Rule may already exist (this is OK)"
fi

