terraform {
  required_version = ">= 1.0"
  
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }
}

provider "aws" {
  region = var.aws_region
}

# Get VPC and subnet information (adjust these to match your AWS setup)
data "aws_vpc" "default" {
  default = true
}

data "aws_subnets" "default" {
  filter {
    name   = "vpc-id"
    values = [data.aws_vpc.default.id]
  }
}

# Security group for the application
resource "aws_security_group" "shop_app" {
  name        = "stoic-shop-app-sg"
  description = "Security group for Stoic Shop application"
  vpc_id      = data.aws_vpc.default.id

  ingress {
    description = "HTTP"
    from_port   = 80
    to_port     = 80
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  ingress {
    description = "HTTPS"
    from_port   = 443
    to_port     = 443
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  egress {
    description = "Allow all outbound traffic"
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = {
    Name = "stoic-shop-app-sg"
  }
}

# Application Load Balancer
resource "aws_lb" "shop_alb" {
  name               = "stoic-shop-alb"
  internal           = false
  load_balancer_type = "application"
  security_groups    = [aws_security_group.shop_app.id]
  subnets            = data.aws_subnets.default.ids

  enable_deletion_protection = false

  tags = {
    Name = "stoic-shop-alb"
  }
}

# Target group for the application
resource "aws_lb_target_group" "shop_app" {
  name     = "stoic-shop-tg"
  port     = 3000
  protocol = "HTTP"
  vpc_id   = data.aws_vpc.default.id

  health_check {
    enabled             = true
    healthy_threshold   = 2
    unhealthy_threshold = 2
    timeout             = 5
    interval            = 30
    path                = "/health"
    matcher             = "200"
  }

  tags = {
    Name = "stoic-shop-tg"
  }
}

# ALB listener for HTTP (redirects to HTTPS)
resource "aws_lb_listener" "shop_http" {
  load_balancer_arn = aws_lb.shop_alb.arn
  port              = "80"
  protocol          = "HTTP"

  default_action {
    type = "redirect"
    redirect {
      port        = "443"
      protocol    = "HTTPS"
      status_code = "HTTP_301"
    }
  }
}

# ALB listener for HTTPS (requires SSL certificate)
# Note: You'll need to create or import an SSL certificate for stoic-fit.com
# This is commented out until you have the certificate set up
# resource "aws_lb_listener" "shop_https" {
#   load_balancer_arn = aws_lb.shop_alb.arn
#   port              = "443"
#   protocol          = "HTTPS"
#   ssl_policy        = "ELBSecurityPolicy-TLS13-1-2-2021-06"
#   certificate_arn    = var.ssl_certificate_arn
#
#   default_action {
#     type             = "forward"
#     target_group_arn = aws_lb_target_group.shop_app.arn
#   }
# }

# For now, HTTP listener that forwards directly (remove after SSL setup)
resource "aws_lb_listener" "shop_http_forward" {
  load_balancer_arn = aws_lb.shop_alb.arn
  port              = "80"
  protocol          = "HTTP"

  default_action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.shop_app.arn
  }
}

# ECS Cluster
resource "aws_ecs_cluster" "shop_cluster" {
  name = "stoic-shop-cluster"

  setting {
    name  = "containerInsights"
    value = "enabled"
  }

  tags = {
    Name = "stoic-shop-cluster"
  }
}

# ECS Task Definition
resource "aws_ecs_task_definition" "shop_app" {
  family                   = "stoic-shop-app"
  network_mode             = "awsvpc"
  requires_compatibilities = ["FARGATE"]
  cpu                      = "256"
  memory                   = "512"

  container_definitions = jsonencode([
    {
      name  = "stoic-shop-app"
      image = "${var.ecr_repository_url}:latest"
      
      portMappings = [
        {
          containerPort = 3000
          protocol      = "tcp"
        }
      ]

      environment = [
        {
          name  = "NODE_ENV"
          value = "production"
        },
        {
          name  = "PORT"
          value = "3000"
        }
      ]

      logConfiguration = {
        logDriver = "awslogs"
        options = {
          "awslogs-group"         = "/ecs/stoic-shop-app"
          "awslogs-region"        = var.aws_region
          "awslogs-stream-prefix" = "ecs"
        }
      }

      healthCheck = {
        command     = ["CMD-SHELL", "node -e \"require('http').get('http://localhost:3000/health', (r) => {process.exit(r.statusCode === 200 ? 0 : 1)})\""]
        interval    = 30
        timeout     = 5
        retries     = 3
        startPeriod = 60
      }
    }
  ])

  tags = {
    Name = "stoic-shop-app"
  }
}

# CloudWatch Log Group
resource "aws_cloudwatch_log_group" "shop_app" {
  name              = "/ecs/stoic-shop-app"
  retention_in_days = 7

  tags = {
    Name = "stoic-shop-app-logs"
  }
}

# ECS Service
resource "aws_ecs_service" "shop_app" {
  name            = "stoic-shop-service"
  cluster         = aws_ecs_cluster.shop_cluster.id
  task_definition = aws_ecs_task_definition.shop_app.arn
  desired_count   = 1
  launch_type     = "FARGATE"

  network_configuration {
    subnets          = data.aws_subnets.default.ids
    security_groups  = [aws_security_group.shop_app.id]
    assign_public_ip = true
  }

  load_balancer {
    target_group_arn = aws_lb_target_group.shop_app.arn
    container_name   = "stoic-shop-app"
    container_port   = 3000
  }

  depends_on = [
    aws_lb_listener.shop_http_forward
  ]

  tags = {
    Name = "stoic-shop-service"
  }
}

# Outputs
output "alb_dns_name" {
  description = "DNS name of the load balancer"
  value       = aws_lb.shop_alb.dns_name
}

output "alb_zone_id" {
  description = "Zone ID of the load balancer (for DNS configuration)"
  value       = aws_lb.shop_alb.zone_id
}

