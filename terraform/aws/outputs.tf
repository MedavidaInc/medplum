output "server_url" {
  description = "Medplum API server URL"
  value       = "https://${var.app_domain}"
}

output "alb_dns_name" {
  description = "ALB DNS name — create a CNAME from app_domain to this value"
  value       = aws_lb.main.dns_name
}

output "ecr_repository_url" {
  description = "ECR repository URL for pushing server images"
  value       = aws_ecr_repository.server.repository_url
}

output "ecs_cluster_name" {
  description = "ECS cluster name"
  value       = aws_ecs_cluster.main.name
}

output "ecs_service_name" {
  description = "ECS service name"
  value       = aws_ecs_service.server.name
}

output "rds_endpoint" {
  description = "RDS cluster writer endpoint"
  value       = aws_db_instance.main.address
  sensitive   = true
}

output "binary_bucket_name" {
  description = "S3 bucket for Medplum binary storage"
  value       = aws_s3_bucket.binaries.bucket
}

output "cloudwatch_log_group" {
  description = "CloudWatch log group for server logs"
  value       = aws_cloudwatch_log_group.server.name
}
