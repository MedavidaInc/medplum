resource "random_password" "redis" {
  length  = 32
  special = false
}

resource "aws_elasticache_subnet_group" "main" {
  name       = "medavida-${var.environment}"
  subnet_ids = aws_subnet.private[*].id
}

resource "aws_elasticache_replication_group" "main" {
  replication_group_id = "medavida-${var.environment}"
  description          = "MedaVida ${var.environment} Redis"

  node_type            = var.redis_node_type
  num_cache_clusters   = 1
  engine_version       = "7.1"
  port                 = 6379
  parameter_group_name = "default.redis7"

  subnet_group_name  = aws_elasticache_subnet_group.main.name
  security_group_ids = [aws_security_group.redis.id]

  auth_token                 = random_password.redis.result
  transit_encryption_enabled = true
  at_rest_encryption_enabled = true
}
