# Staging environment values
# Replace the placeholders before running terraform apply

environment = "staging"
aws_region  = "us-east-1"

app_domain      = "api.staging.demoatable.com"
certificate_arn = "arn:aws:acm:us-east-1:049815585091:certificate/d099c7b6-90db-41c2-82e7-96e8cd9420de"

app_base_url   = "https://app.staging.medavida.com/"
support_email  = "support@medavida.com"

# ECS
server_cpu           = 1024
server_memory        = 2048
server_desired_count = 1
server_image_tag     = "latest"

# RDS — Aurora Serverless v2 scales to zero when idle (good for staging)
rds_min_capacity = 0.5
rds_max_capacity = 4

# Redis
redis_node_type = "cache.t4g.small"
