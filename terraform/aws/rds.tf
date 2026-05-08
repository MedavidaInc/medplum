resource "aws_db_subnet_group" "main" {
  name       = "medavida-db-subnet-group"
  subnet_ids = aws_subnet.private[*].id
}

resource "aws_db_instance" "main" {
  identifier        = "medavida-staging"
  engine            = "postgres"
  engine_version    = "16.13"
  instance_class    = "db.t4g.micro"
  allocated_storage = 20
  storage_encrypted = true

  db_name  = var.db_name
  username = var.db_username
  password = var.db_password

  db_subnet_group_name   = aws_db_subnet_group.main.name
  vpc_security_group_ids = [aws_security_group.rds.id]

  backup_retention_period = 1
  skip_final_snapshot     = true
  deletion_protection     = false

  apply_immediately = true
}
