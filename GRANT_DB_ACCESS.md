# Granting Database Access to stoic-fitness-app User

## Current User
- **User ARN**: `arn:aws:iam::882517740539:user/stoic-fitness-app`
- **Account ID**: `882517740539`
- **Region**: `us-east-1`

## Option 1: Secrets Manager Access (Recommended - Easiest)

If the database password is stored in AWS Secrets Manager, grant read access:

### Quick Method (Full Access):
```bash
aws iam attach-user-policy \
  --user-name stoic-fitness-app \
  --policy-arn arn:aws:iam::aws:policy/SecretsManagerReadWrite \
  --region us-east-1
```

### Custom Policy (More Secure - Specific Secret Only):
```bash
# Create the policy
aws iam create-policy \
  --policy-name StoicFitnessSecretsReadOnly \
  --policy-document '{
    "Version": "2012-10-17",
    "Statement": [{
      "Effect": "Allow",
      "Action": [
        "secretsmanager:GetSecretValue",
        "secretsmanager:DescribeSecret"
      ],
      "Resource": "arn:aws:secretsmanager:us-east-1:882517740539:secret:*"
    }]
  }' \
  --region us-east-1

# Attach to user
aws iam attach-user-policy \
  --user-name stoic-fitness-app \
  --policy-arn arn:aws:iam::882517740539:policy/StoicFitnessSecretsReadOnly \
  --region us-east-1
```

---

## Option 2: Systems Manager Parameter Store Access

If the database password is stored in Parameter Store:

### Quick Method (Full Access):
```bash
aws iam attach-user-policy \
  --user-name stoic-fitness-app \
  --policy-arn arn:aws:iam::aws:policy/AmazonSSMReadOnlyAccess \
  --region us-east-1
```

### Custom Policy (More Secure - Specific Parameter Only):
```bash
# Create the policy
aws iam create-policy \
  --policy-name StoicFitnessSSMReadOnly \
  --policy-document '{
    "Version": "2012-10-17",
    "Statement": [{
      "Effect": "Allow",
      "Action": [
        "ssm:GetParameter",
        "ssm:GetParameters",
        "ssm:GetParametersByPath"
      ],
      "Resource": "arn:aws:ssm:us-east-1:882517740539:parameter/*"
    }]
  }' \
  --region us-east-1

# Attach to user
aws iam attach-user-policy \
  --user-name stoic-fitness-app \
  --policy-arn arn:aws:iam::882517740539:policy/StoicFitnessSSMReadOnly \
  --region us-east-1
```

---

## Option 3: Enable IAM Database Authentication (Most Secure)

This allows using IAM authentication tokens instead of passwords:

### Step 1: Enable IAM Auth on RDS Instance
```bash
aws rds modify-db-instance \
  --db-instance-identifier stoic-fitness-pg \
  --enable-iam-database-authentication \
  --apply-immediately \
  --region us-east-1
```

**Note**: This requires a brief maintenance window (usually 1-2 minutes).

### Step 2: Create IAM Policy for RDS IAM Auth
```bash
aws iam create-policy \
  --policy-name StoicFitnessRDSIAMAuth \
  --policy-document '{
    "Version": "2012-10-17",
    "Statement": [{
      "Effect": "Allow",
      "Action": [
        "rds-db:connect"
      ],
      "Resource": "arn:aws:rds-db:us-east-1:882517740539:dbuser:*/stoicapp"
    }]
  }' \
  --region us-east-1

# Attach to user
aws iam attach-user-policy \
  --user-name stoic-fitness-app \
  --policy-arn arn:aws:iam::882517740539:policy/StoicFitnessRDSIAMAuth \
  --region us-east-1
```

### Step 3: Grant Database User IAM Privileges
After enabling IAM auth, connect to the database as the master user and run:
```sql
CREATE USER stoicapp_iam;
GRANT rds_iam TO stoicapp_iam;
GRANT ALL PRIVILEGES ON DATABASE postgres TO stoicapp_iam;
```

---

## Verify Permissions

After granting permissions, verify they're attached:
```bash
aws iam list-attached-user-policies \
  --user-name stoic-fitness-app \
  --region us-east-1
```

---

## Testing Access

### Test Secrets Manager:
```bash
aws secretsmanager list-secrets --region us-east-1
aws secretsmanager get-secret-value --secret-id <secret-name> --region us-east-1
```

### Test Parameter Store:
```bash
aws ssm get-parameters-by-path --path / --region us-east-1 --recursive
aws ssm get-parameter --name <parameter-name> --region us-east-1 --with-decryption
```

### Test IAM Auth (after enabling):
```bash
aws rds generate-db-auth-token \
  --hostname stoic-fitness-pg.c7c9btnoxixy.us-east-1.rds.amazonaws.com \
  --port 5432 \
  --region us-east-1 \
  --username stoicapp_iam
```

---

## Recommendation

**Start with Option 1 (Secrets Manager)** - it's the easiest and most common way to store database passwords. If the password isn't in Secrets Manager, try Option 2 (Parameter Store). Option 3 (IAM Auth) is the most secure but requires more setup.







