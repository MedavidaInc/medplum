resource "aws_elasticache_subnet_group" "main" {
  name       = "medavida-redis-subnet-group"
  subnet_ids = aws_subnet.private[*].id
}

resource "aws_elasticache_cluster" "main" {
  cluster_id        = "medavida-staging"
  engine            = "redis"
  engine_version    = "7.1"
  node_type         = "cache.t4g.micro"
  num_cache_nodes   = 1
  port              = 6379

  subnet_group_name  = aws_elasticache_subnet_group.main.name
  security_group_ids = [aws_security_group.redis.id]
}
