locals {
  binary_bucket_name = coalesce(var.binary_bucket_name, "medavida-${var.environment}-binaries")
}

resource "aws_s3_bucket" "binaries" {
  bucket = local.binary_bucket_name
}

resource "aws_s3_bucket_versioning" "binaries" {
  bucket = aws_s3_bucket.binaries.id
  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "binaries" {
  bucket = aws_s3_bucket.binaries.id
  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

resource "aws_s3_bucket_public_access_block" "binaries" {
  bucket                  = aws_s3_bucket.binaries.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

# Allow ECS task role to read/write binaries
resource "aws_s3_bucket_policy" "binaries" {
  bucket = aws_s3_bucket.binaries.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid    = "AllowECSTaskAccess"
        Effect = "Allow"
        Principal = {
          AWS = aws_iam_role.ecs_task.arn
        }
        Action   = ["s3:GetObject", "s3:PutObject", "s3:DeleteObject", "s3:ListBucket"]
        Resource = [aws_s3_bucket.binaries.arn, "${aws_s3_bucket.binaries.arn}/*"]
      }
    ]
  })
  depends_on = [aws_iam_role.ecs_task]
}
