data "aws_caller_identity" "current" {}

# ─── CloudWatch log group ─────────────────────────────────────────────────────

resource "aws_cloudwatch_log_group" "server" {
  name              = "/ecs/medavida/medplum"
  retention_in_days = var.environment == "production" ? 90 : 14
}

# ─── IAM roles ────────────────────────────────────────────────────────────────

resource "aws_iam_role" "ecs_execution" {
  name = "medavida-ecs-execution-role"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Action    = "sts:AssumeRole"
      Effect    = "Allow"
      Principal = { Service = "ecs-tasks.amazonaws.com" }
    }]
  })
}

resource "aws_iam_role_policy_attachment" "ecs_execution" {
  role       = aws_iam_role.ecs_execution.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy"
}

# Allow ECS execution role to read secrets
resource "aws_iam_role_policy" "ecs_execution_secrets" {
  name = "read-secrets"
  role = aws_iam_role.ecs_execution.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect   = "Allow"
      Action   = ["secretsmanager:GetSecretValue"]
      Resource = "arn:aws:secretsmanager:${var.aws_region}:${data.aws_caller_identity.current.account_id}:secret:medavida/*"
    }]
  })
}

resource "aws_iam_role" "ecs_task" {
  name = "medavida-ecs-task-role"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Action    = "sts:AssumeRole"
      Effect    = "Allow"
      Principal = { Service = "ecs-tasks.amazonaws.com" }
    }]
  })
}

# ─── ECS cluster ──────────────────────────────────────────────────────────────

resource "aws_ecs_cluster" "main" {
  name = "medavida"

  setting {
    name  = "containerInsights"
    value = "enabled"
  }
}

resource "aws_ecs_cluster_capacity_providers" "main" {
  cluster_name       = aws_ecs_cluster.main.name
  capacity_providers = ["FARGATE", "FARGATE_SPOT"]

  default_capacity_provider_strategy {
    capacity_provider = "FARGATE"
    weight            = 1
  }
}

# ─── Task definition ──────────────────────────────────────────────────────────

resource "aws_ecs_task_definition" "server" {
  family                   = "medavida-medplum"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = var.server_cpu
  memory                   = var.server_memory
  execution_role_arn       = aws_iam_role.ecs_execution.arn
  task_role_arn            = aws_iam_role.ecs_task.arn

  container_definitions = jsonencode([
    {
      name      = "server"
      image     = "${aws_ecr_repository.server.repository_url}:${var.server_image_tag}"
      essential = true

      portMappings = [{ containerPort = 8103, protocol = "tcp" }]

      environment = [
        { name = "NODE_ENV", value = "production" },
        { name = "MEDPLUM_PORT", value = "8103" },
        { name = "MEDPLUM_BASE_URL", value = "https://${var.app_domain}/" },
        { name = "MEDPLUM_APP_BASE_URL", value = var.app_base_url },
        { name = "MEDPLUM_STORAGE_BASE_URL", value = "https://${var.app_domain}/storage/" },
        { name = "MEDPLUM_BINARY_STORAGE", value = "s3://${local.binary_bucket_name}" },
        { name = "MEDPLUM_SUPPORT_EMAIL", value = var.support_email },
        { name = "MEDPLUM_VM_CONTEXT_BOTS_ENABLED", value = "true" },
        { name = "MEDPLUM_DEFAULT_BOT_RUNTIME_VERSION", value = "vmcontext" },
        { name = "MEDPLUM_ALLOWED_ORIGINS", value = var.app_base_url },
        { name = "MEDPLUM_DATABASE_HOST", value = aws_db_instance.main.address },
        { name = "MEDPLUM_DATABASE_PORT", value = "5432" },
        { name = "MEDPLUM_DATABASE_NAME", value = var.db_name },
        { name = "MEDPLUM_DATABASE_USERNAME", value = var.db_username },
        { name = "MEDPLUM_REDIS_HOST", value = aws_elasticache_cluster.main.cache_nodes[0].address },
        { name = "MEDPLUM_REDIS_PORT", value = "6379" },
        { name = "MEDPLUM_REDIS_TLS", value = "false" },
      ]

      secrets = [
        {
          name      = "MEDPLUM_DATABASE_PASSWORD"
          valueFrom = aws_secretsmanager_secret.db_password.arn
        },
      ]

      logConfiguration = {
        logDriver = "awslogs"
        options = {
          awslogs-group         = aws_cloudwatch_log_group.server.name
          awslogs-region        = var.aws_region
          awslogs-stream-prefix = "server"
        }
      }

      healthCheck = {
        command     = ["CMD-SHELL", "curl -f http://localhost:8103/healthcheck || exit 1"]
        interval    = 30
        timeout     = 5
        retries     = 3
        startPeriod = 60
      }
    }
  ])
}

# ─── ECS service ──────────────────────────────────────────────────────────────

resource "aws_ecs_service" "server" {
  name                               = "medavida-medplum"
  cluster                            = aws_ecs_cluster.main.id
  task_definition                    = aws_ecs_task_definition.server.arn
  desired_count                      = var.server_desired_count
  launch_type                        = "FARGATE"
  health_check_grace_period_seconds  = 120
  force_new_deployment               = true

  network_configuration {
    subnets          = aws_subnet.private[*].id
    security_groups  = [aws_security_group.ecs.id]
    assign_public_ip = false
  }

  load_balancer {
    target_group_arn = aws_lb_target_group.server.arn
    container_name   = "server"
    container_port   = 8103
  }

  depends_on = [aws_lb_listener.https]

  lifecycle {
    # Allow external deployments (CI/CD) to update task definition without Terraform drift
    ignore_changes = [task_definition]
  }
}
