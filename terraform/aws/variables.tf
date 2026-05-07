variable "aws_region" {
  description = "AWS region for all resources"
  type        = string
  default     = "us-east-1"
}

variable "environment" {
  description = "Deployment environment: staging or production"
  type        = string
  default     = "staging"
  validation {
    condition     = contains(["staging", "production"], var.environment)
    error_message = "environment must be staging or production"
  }
}

variable "app_domain" {
  description = "Domain for the Medplum API server (e.g. api.staging.medavida.com)"
  type        = string
}

variable "certificate_arn" {
  description = "ACM certificate ARN for the app_domain (must be in us-east-1)"
  type        = string
}

# ─── Networking ───────────────────────────────────────────────────────────────

variable "vpc_cidr" {
  description = "CIDR block for the VPC"
  type        = string
  default     = "10.0.0.0/16"
}

variable "availability_zones" {
  description = "AZs to deploy into (at least 2 for RDS multi-AZ)"
  type        = list(string)
  default     = ["us-east-1a", "us-east-1b"]
}

# ─── ECS / App ────────────────────────────────────────────────────────────────

variable "server_image_tag" {
  description = "Docker image tag to deploy (ECR image tag)"
  type        = string
  default     = "latest"
}

variable "server_cpu" {
  description = "Fargate task CPU units (256, 512, 1024, 2048, 4096)"
  type        = number
  default     = 1024
}

variable "server_memory" {
  description = "Fargate task memory in MiB"
  type        = number
  default     = 2048
}

variable "server_desired_count" {
  description = "Number of ECS tasks to run"
  type        = number
  default     = 1
}

# ─── RDS ──────────────────────────────────────────────────────────────────────

variable "db_name" {
  description = "Postgres database name"
  type        = string
  default     = "medplum"
}

variable "db_username" {
  description = "Postgres master username"
  type        = string
  default     = "medplum"
}

variable "rds_min_capacity" {
  description = "Aurora Serverless v2 min ACUs"
  type        = number
  default     = 0.5
}

variable "rds_max_capacity" {
  description = "Aurora Serverless v2 max ACUs"
  type        = number
  default     = 4
}

# ─── Redis ────────────────────────────────────────────────────────────────────

variable "redis_node_type" {
  description = "ElastiCache node type"
  type        = string
  default     = "cache.t4g.small"
}

# ─── Storage ──────────────────────────────────────────────────────────────────

variable "binary_bucket_name" {
  description = "S3 bucket name for Medplum binary storage"
  type        = string
  default     = null # defaults to medavida-{environment}-binaries
}

# ─── Medplum app config ───────────────────────────────────────────────────────

variable "app_base_url" {
  description = "URL of the Medplum web app (medavida-app)"
  type        = string
  default     = "http://localhost:3000/"
}

variable "support_email" {
  description = "Support email shown in Medplum system emails"
  type        = string
  default     = "support@medavida.com"
}
