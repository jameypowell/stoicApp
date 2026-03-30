# DNS and Routing Configuration Guide

## Overview
This guide explains how to route `stoic-fit.com/shop` from Squarespace to your AWS-hosted application.

## Important Limitation
**Squarespace cannot proxy subdirectory paths to external servers.** When a user visits `stoic-fit.com/shop`, Squarespace will either:
1. Show a 404 (if no page exists)
2. Redirect to an external URL (if configured)

## Recommended Solution: Subdomain Approach

Instead of routing `/shop` on the same domain, use a subdomain `shop.stoic-fit.com` for better control and SEO.

### Step 1: Deploy AWS Infrastructure

1. Deploy your Terraform infrastructure (see README.md)
2. Note the ALB DNS name from Terraform output:
   ```bash
   cd terraform
   terraform output alb_dns_name
   ```

### Step 2: Configure DNS (Outside Squarespace)

Your domain DNS is likely managed by:
- Your domain registrar (GoDaddy, Namecheap, etc.)
- Squarespace DNS (if you transferred DNS to Squarespace)
- AWS Route 53 (if using Route 53)

**Wherever your DNS is managed**, add a CNAME record:

```
Type: CNAME
Name: shop
Value: YOUR-ALB-DNS-NAME.elb.amazonaws.com
TTL: 300 (or default)
```

**Example:**
- Name: `shop`
- Points to: `stoic-shop-alb-1234567890.us-east-1.elb.amazonaws.com`

### Step 3: Set Up SSL Certificate (AWS Certificate Manager)

1. **Request Certificate**:
   - Go to AWS Certificate Manager (ACM)
   - Request a public certificate
   - Domain: `shop.stoic-fit.com` (or `*.stoic-fit.com` for wildcard)
   - Validation: DNS validation
   - Add the CNAME record to your DNS provider

2. **Wait for validation** (usually 5-30 minutes)

3. **Update Terraform**:
   - Uncomment HTTPS listener in `terraform/main.tf`
   - Comment out HTTP forward listener
   - Add certificate ARN to `terraform/terraform.tfvars`:
     ```
     ssl_certificate_arn = "arn:aws:acm:us-east-1:ACCOUNT_ID:certificate/CERT_ID"
     ```

4. **Redeploy**:
   ```bash
   cd terraform
   terraform apply
   ```

### Step 4: Configure Squarespace Redirect

1. Log into Squarespace
2. Go to **Settings** → **Domains**
3. Click on your domain (`stoic-fit.com`)
4. Under **Advanced**, find **URL Redirects**
5. Add a redirect:
   - **From**: `/shop`
   - **To**: `https://shop.stoic-fit.com`
   - **Type**: Permanent (301) or Temporary (302)

### Step 5: Test

1. Visit `stoic-fit.com/shop` - should redirect to `shop.stoic-fit.com`
2. Visit `shop.stoic-fit.com` directly - should show your shop application
3. Verify HTTPS is working

## Alternative: Direct ALB Access (Simpler, Less Professional)

If you want to skip the subdomain setup temporarily:

1. Get ALB DNS name from Terraform output
2. In Squarespace, add URL redirect:
   - **From**: `/shop`
   - **To**: `http://YOUR-ALB-DNS-NAME.elb.amazonaws.com/shop`
   - **Type**: Temporary (302)

**Note**: Users will see the AWS URL in their browser, which is not ideal for branding.

## Troubleshooting

### DNS Not Resolving
- Wait 5-30 minutes for DNS propagation
- Use `dig shop.stoic-fit.com` or `nslookup shop.stoic-fit.com` to check
- Verify CNAME record is correct

### SSL Certificate Issues
- Ensure certificate is in the same region as your ALB
- Verify DNS validation records are added to DNS
- Check certificate status in ACM console

### Redirect Not Working
- Clear browser cache
- Check Squarespace redirect configuration
- Verify redirect is active (not draft)

### 502 Bad Gateway
- Check ECS service is running: `aws ecs describe-services --cluster stoic-shop-cluster --services stoic-shop-service`
- Check target group health: `aws elbv2 describe-target-health --target-group-arn YOUR_TG_ARN`
- View application logs: `aws logs tail /ecs/stoic-shop-app --follow`

## Route 53 Setup (Optional, Recommended)

If you want to use AWS Route 53 for DNS management:

1. **Transfer DNS to Route 53**:
   - Create hosted zone for `stoic-fit.com`
   - Update name servers at your domain registrar

2. **Create Record**:
   ```bash
   aws route53 change-resource-record-sets \
     --hosted-zone-id YOUR_ZONE_ID \
     --change-batch '{
       "Changes": [{
         "Action": "CREATE",
         "ResourceRecordSet": {
           "Name": "shop.stoic-fit.com",
           "Type": "A",
           "AliasTarget": {
             "DNSName": "YOUR-ALB-DNS-NAME.elb.amazonaws.com",
             "EvaluateTargetHealth": true,
             "HostedZoneId": "ALB_ZONE_ID"
           }
         }
       }]
     }'
   ```

3. **Benefits**:
   - Better integration with AWS services
   - Health checks
   - Automatic failover
   - Better performance

## Next Steps

Once routing is configured:
1. Test the full flow from Squarespace
2. Verify HTTPS is working
3. Monitor CloudWatch logs for any issues
4. Implement your shop services/APIs

