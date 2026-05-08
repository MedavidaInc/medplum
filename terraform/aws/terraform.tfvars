# Staging environment values

environment = "staging"
aws_region  = "us-east-2"

app_domain      = "api.staging.demoatable.com"
certificate_arn = "arn:aws:acm:us-east-2:049815585091:certificate/18412542-5c91-4e55-b41d-019ed0ced313"

app_base_url   = "https://app.medavida.com/"
support_email  = "support@medavida.com"

# ECS
server_cpu           = 1024
server_memory        = 2048
server_desired_count = 1
server_image_tag     = "latest"

# RDS
db_name     = "medavida"
db_username = "medavida"
# db_password = set via TF_VAR_db_password env var — do not commit

# Redis
redis_node_type = "cache.t4g.micro"
