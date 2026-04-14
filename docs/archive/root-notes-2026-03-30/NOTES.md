# Important Notes

## Critical Points for Squarespace Integration

1. **Squarespace cannot proxy `/shop`** - It will redirect users away from Squarespace
2. **Subdomain is recommended** - Use `shop.stoic-fit.com` instead of `stoic-fit.com/shop` for better control
3. **Users will leave Squarespace** - When clicking `/shop`, they'll be redirected to your AWS-hosted application
4. **SEO considerations** - Redirects are fine, but subdomain might be treated as separate site

## Recommended Architecture

```
User visits stoic-fit.com/shop
    ↓
Squarespace redirects (301/302)
    ↓
shop.stoic-fit.com (subdomain)
    ↓
AWS ALB (Application Load Balancer)
    ↓
ECS Fargate Service
    ↓
Node.js Application (your shop backend)
```

## What You Need Before Starting

- [ ] AWS account with permissions
- [ ] Domain DNS access (wherever stoic-fit.com DNS is managed)
- [ ] Terraform installed
- [ ] Docker installed
- [ ] AWS CLI configured

## Quick Checklist

- [ ] Deploy Terraform infrastructure
- [ ] Create ECR repository and push Docker image
- [ ] Get ALB DNS name from Terraform
- [ ] Request SSL certificate in ACM
- [ ] Add DNS CNAME record for `shop.stoic-fit.com`
- [ ] Configure HTTPS listener in Terraform
- [ ] Configure redirect in Squarespace
- [ ] Test end-to-end

