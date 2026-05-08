#!/usr/bin/env bash
# Import existing AWS resources into Terraform state.
# Run from the terraform/aws directory after `terraform init`.
# Set TF_VAR_db_password before running.

set -e

echo "=== Networking ==="
terraform import aws_vpc.main vpc-0777f421ff0be314d
terraform import aws_subnet.public[0] subnet-0e277ec1b2df517a8
terraform import aws_subnet.public[1] subnet-08f8d645655bf32d6
terraform import aws_subnet.private[0] subnet-0e500332a390401c5
terraform import aws_subnet.private[1] subnet-09ed879ddc553840c
terraform import aws_internet_gateway.main igw-0949cfa2ec0cbca62
terraform import aws_eip.nat[0] eipalloc-0fcb1b2d630186056
terraform import aws_eip.nat[1] eipalloc-0db6c1c7541712468
terraform import aws_nat_gateway.main[0] nat-0c70dfe1a12f40d02
terraform import aws_nat_gateway.main[1] nat-046dc78b682449140
terraform import aws_route_table.public rtb-070b40172c8dffaba
terraform import aws_route_table.private[0] rtb-07330bd6fbe145d39
terraform import aws_route_table.private[1] rtb-05f6a35e8cc571ce8
terraform import 'aws_route_table_association.public[0]' subnet-0e277ec1b2df517a8/rtb-070b40172c8dffaba
terraform import 'aws_route_table_association.public[1]' subnet-08f8d645655bf32d6/rtb-070b40172c8dffaba
terraform import 'aws_route_table_association.private[0]' subnet-0e500332a390401c5/rtb-07330bd6fbe145d39
terraform import 'aws_route_table_association.private[1]' subnet-09ed879ddc553840c/rtb-05f6a35e8cc571ce8

echo "=== Security Groups ==="
terraform import aws_security_group.alb sg-03563b6a4f532ff57
terraform import aws_security_group.ecs sg-0af055f287c2f4bed
terraform import aws_security_group.rds sg-0905f085473765231
terraform import aws_security_group.redis sg-0326d21558e54f74c

echo "=== ALB ==="
terraform import aws_lb.main arn:aws:elasticloadbalancing:us-east-2:049815585091:loadbalancer/app/medavida-alb/7941c7a1afb268ce
terraform import aws_lb_target_group.server arn:aws:elasticloadbalancing:us-east-2:049815585091:targetgroup/medavida-medplum-tg/687f09ceb29bfe3d
terraform import aws_lb_listener.http arn:aws:elasticloadbalancing:us-east-2:049815585091:listener/app/medavida-alb/7941c7a1afb268ce/d2b9686a93aeaf44
terraform import aws_lb_listener.https arn:aws:elasticloadbalancing:us-east-2:049815585091:listener/app/medavida-alb/7941c7a1afb268ce/ecd89adde1144093

echo "=== ECR ==="
terraform import aws_ecr_repository.server medavida-medplum

echo "=== ECS ==="
terraform import aws_ecs_cluster.main medavida
terraform import aws_ecs_cluster_capacity_providers.main medavida
terraform import aws_iam_role.ecs_execution medavida-ecs-execution-role
terraform import aws_iam_role.ecs_task medavida-ecs-task-role
terraform import aws_iam_role_policy_attachment.ecs_execution medavida-ecs-execution-role/arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy
terraform import aws_iam_role_policy.ecs_execution_secrets medavida-ecs-execution-role:medavida-secrets-access
terraform import aws_cloudwatch_log_group.server /ecs/medavida/medplum
terraform import aws_ecs_task_definition.server arn:aws:ecs:us-east-2:049815585091:task-definition/medavida-medplum:3
terraform import aws_ecs_service.server medavida/medavida-medplum

echo "=== RDS ==="
terraform import aws_db_subnet_group.main medavida-db-subnet-group
terraform import aws_db_instance.main medavida-staging

echo "=== Redis ==="
terraform import aws_elasticache_subnet_group.main medavida-redis-subnet-group
terraform import aws_elasticache_cluster.main medavida-staging

echo "=== S3 ==="
terraform import aws_s3_bucket.binaries medavida-staging-binaries
terraform import aws_s3_bucket_versioning.binaries medavida-staging-binaries
terraform import aws_s3_bucket_server_side_encryption_configuration.binaries medavida-staging-binaries
terraform import aws_s3_bucket_public_access_block.binaries medavida-staging-binaries

echo "=== Secrets Manager ==="
terraform import aws_secretsmanager_secret.db_password arn:aws:secretsmanager:us-east-2:049815585091:secret:medavida/staging/db-password-6qlSW0

echo "=== Done ==="
echo "Run 'terraform plan' next to check for drift."
