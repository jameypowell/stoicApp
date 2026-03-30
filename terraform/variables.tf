variable "aws_region" {
  description = "AWS region for resources"
  type        = string
  default     = "us-east-1"
}

variable "ecr_repository_url" {
  description = "ECR repository URL for the Docker image"
  type        = string
  default     = "your-account-id.dkr.ecr.us-east-1.amazonaws.com/stoic-shop"
}

variable "ssl_certificate_arn" {
  description = "ARN of the SSL certificate for HTTPS (optional)"
  type        = string
  default     = ""
}

