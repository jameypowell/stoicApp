# Stoic Shop - Setup Guide

## Overview
This project sets up a subdomain application for `stoic-fit.com/shop` that will be hosted on AWS and routed from your Squarespace site.

## Architecture
- **Frontend**: Squarespace (stoic-fit.com) with route to `/shop`
- **Backend**: AWS ECS Fargate running Node.js/Express application
- **Load Balancer**: Application Load Balancer (ALB)
- **Infrastructure**: Managed with Terraform

## Prerequisites

1. **AWS Account** with appropriate permissions
2. **Terraform** installed (v1.0+)
3. **AWS CLI** configured with credentials
4. **Docker** installed (for building images)
5. **Node.js** installed (v18+)
6. **Domain DNS access** (to configure routing)

## Installing Node.js (if not already installed)

### Option 1: Official Installer (Recommended for Quick Setup)

1. Visit [nodejs.org](https://nodejs.org/)
2. Download the LTS (Long Term Support) version for macOS
3. Run the installer and follow the prompts
4. Verify installation:
   ```bash
   node --version
   npm --version
   ```

### Option 2: Using Homebrew (If you prefer package managers)

1. Install Homebrew (if not installed):
   ```bash
   /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
   ```
   Follow the prompts and enter your password when asked.

2. Install Node.js:
   ```bash
   brew install node
   ```

3. Verify installation:
   ```bash
   node --version
   npm --version
   ```

### Option 3: Using nvm (Node Version Manager)

1. Install nvm:
   ```bash
   curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.0/install.sh | bash
   ```

2. Restart your terminal or run:
   ```bash
   source ~/.zshrc
   ```

3. Install Node.js:
   ```bash
   nvm install --lts
   nvm use --lts
   ```

4. Verify installation:
   ```bash
   node --version
   npm --version
   ```

## Initial Setup Steps

### 1. Install Dependencies

```bash
npm install
```

### 2. Configure Environment Variables

```bash
cp config/env.example .env
# Edit .env with your configuration (test vs production values)
```

Key variables:

- `DB_PATH` – absolute path or relative path to the SQLite (or external) database file.
- `STRIPE_*` – publishable, secret, and webhook keys for the active Stripe account.
- `GOOGLE_*` – OAuth client credentials and refresh token with `drive.readonly` scope.
- `JWT_SECRET` – set to a long, random string before deploying to AWS.
- `GOOGLE_REDIRECT_URI` – include the production URL (`https://stoic-fit.com/auth/google/callback`) alongside any staging callback.

**📘 Need help setting up Stripe and Google credentials?**
See **[CREDENTIALS_SETUP.md](./CREDENTIALS_SETUP.md)** for detailed step-by-step instructions!

Quick reference: **[QUICK_SETUP.md](./QUICK_SETUP.md)**

### 3. Test Locally

```bash
npm run dev
# or
npm start
```

Visit `http://localhost:3000` to verify the server is running.

#### Local Payment Testing

`npm run dev` runs the server with Stripe webhook forwarding for full payment testing:

1. **Install Stripe CLI** (one-time): `brew install stripe/stripe-cli/stripe`
2. **Log in** (one-time): `stripe login`
3. **Run dev**: `npm run dev` — starts server + webhook listener; use test card `4242 4242 4242 4242`

For server-only (no payment webhooks): `npm run dev:server`

### 4. AWS Infrastructure Setup

#### Step 4a: Create ECR Repository

```bash
# Login to ECR
aws ecr get-login-password --region us-east-1 | docker login --username AWS --password-stdin YOUR_ACCOUNT_ID.dkr.ecr.us-east-1.amazonaws.com

# Create ECR repository
aws ecr create-repository --repository-name stoic-shop --region us-east-1
```

#### Step 4b: Build and Push Docker Image

```bash
# Build the image
docker build -t stoic-shop .

# Tag for ECR
docker tag stoic-shop:latest YOUR_ACCOUNT_ID.dkr.ecr.us-east-1.amazonaws.com/stoic-shop:latest

# Push to ECR
docker push YOUR_ACCOUNT_ID.dkr.ecr.us-east-1.amazonaws.com/stoic-shop:latest
```

#### Step 4c: Configure Terraform

```bash
cd terraform
cp terraform.tfvars.example terraform.tfvars
# Edit terraform.tfvars with your AWS account ID and ECR URL
```

Edit `terraform/variables.tf` and `terraform/terraform.tfvars` with:
- Your AWS account ID
- Your ECR repository URL
- Your preferred region

#### Step 4d: Deploy Infrastructure

```bash
cd terraform
terraform init
terraform plan
terraform apply
```

After deployment, note the ALB DNS name from the output.

### 5. DNS Configuration in Squarespace

Squarespace doesn't directly support subdomain routing to external servers. You have two options:

#### Option A: Use Squarespace's URL Redirect (Simpler)

1. In Squarespace Settings → Domains → Advanced → URL Redirects
2. Add a redirect:
   - **From**: `/shop`
   - **To**: `http://YOUR-ALB-DNS-NAME.amazonaws.com/shop` (or your custom domain)
   - **Type**: Permanent (301) or Temporary (302)

**Note**: This will redirect away from Squarespace, so users see the AWS URL.

#### Option B: Use DNS CNAME with Subdomain (Better UX)

1. **Create a subdomain** in your DNS provider (wherever stoic-fit.com is managed):
   - Create a CNAME record: `shop.stoic-fit.com` → `YOUR-ALB-DNS-NAME.amazonaws.com`
   
2. **Update Terraform** to use a custom domain:
   - You'll need to create an SSL certificate for `shop.stoic-fit.com` using AWS Certificate Manager
   - Update the ALB listener to use HTTPS

3. **In Squarespace**, create a redirect:
   - **From**: `/shop`
   - **To**: `https://shop.stoic-fit.com`

### 6. SSL Certificate Setup (Recommended)

For HTTPS support:

1. **Request Certificate in AWS Certificate Manager**:
   ```bash
   # Via AWS Console: Certificate Manager → Request Certificate
   # Domain: shop.stoic-fit.com (or *.stoic-fit.com for wildcard)
   # Validation: DNS validation (add the CNAME record to your DNS)
   ```

2. **Update Terraform**:
   - Uncomment the HTTPS listener in `terraform/main.tf`
   - Comment out the HTTP forward listener
   - Add `ssl_certificate_arn` to your `terraform.tfvars`

3. **Redeploy**:
   ```bash
   terraform apply
   ```

### 7. Update DNS Records

After Terraform deployment, you'll get an ALB DNS name. Update your DNS:

- **CNAME**: `shop.stoic-fit.com` → `YOUR-ALB-DNS-NAME.elb.amazonaws.com`

Or use Route 53 for better integration:

- Create an **A record** (alias) pointing to the ALB

## Deployment Workflow

### Making Changes

1. **Update code** in `server.js` or other files
2. **Build and push Docker image**:
   ```bash
   docker build -t stoic-shop .
   docker tag stoic-shop:latest YOUR_ACCOUNT_ID.dkr.ecr.us-east-1.amazonaws.com/stoic-shop:latest
   docker push YOUR_ACCOUNT_ID.dkr.ecr.us-east-1.amazonaws.com/stoic-shop:latest
   ```
3. **Force ECS service update**:
   ```bash
   aws ecs update-service --cluster stoic-shop-cluster --service stoic-shop-service --force-new-deployment --region us-east-1
   ```

## Troubleshooting

### Check ECS Service Status
```bash
aws ecs describe-services --cluster stoic-shop-cluster --services stoic-shop-service --region us-east-1
```

### View Logs
```bash
aws logs tail /ecs/stoic-shop-app --follow --region us-east-1
```

### Check ALB Target Health
```bash
aws elbv2 describe-target-health --target-group-arn YOUR_TARGET_GROUP_ARN --region us-east-1
```

### Test Locally with Docker
```bash
docker build -t stoic-shop .
docker run -p 3000:3000 stoic-shop
```

## Cost Considerations

- **ECS Fargate**: ~$15-30/month for 1 task (0.25 vCPU, 0.5GB RAM)
- **Application Load Balancer**: ~$16/month + data transfer
- **ECR**: Storage costs (~$0.10/GB/month)
- **CloudWatch Logs**: Based on log volume

Total estimated: ~$30-50/month for basic setup

## Next Steps

Once infrastructure is deployed:
1. Verify the ALB is accessible
2. Configure DNS routing
3. Test end-to-end from Squarespace
4. Implement your shop services/APIs in the application

## Security Notes

- Always use HTTPS in production
- Keep security groups minimal (only necessary ports)
- Use environment variables for secrets (never commit `.env`)
- Enable AWS WAF for additional protection if needed
- Regularly update dependencies

## Support

For issues or questions:
- Check AWS CloudWatch logs for application errors
- Verify security group rules
- Ensure target group health checks are passing

