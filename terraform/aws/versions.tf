terraform {
  required_version = ">= 1.6.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
    random = {
      source  = "hashicorp/random"
      version = "~> 3.6"
    }
  }

  # Remote state in S3 — create this bucket manually before first `terraform init`
  # aws s3api create-bucket --bucket medavida-terraform-state --region us-east-1
  # aws s3api put-bucket-versioning --bucket medavida-terraform-state --versioning-configuration Status=Enabled
  # aws dynamodb create-table --table-name medavida-terraform-locks \
  #   --attribute-definitions AttributeName=LockID,AttributeType=S \
  #   --key-schema AttributeName=LockID,KeyType=HASH \
  #   --billing-mode PAY_PER_REQUEST --region us-east-1
  backend "s3" {
    bucket       = "medavida-terraform-state"
    key          = "medplum/terraform.tfstate"
    region       = "us-east-2"
    use_lockfile = true
    encrypt      = true
  }
}

provider "aws" {
  region = var.aws_region

  default_tags {
    tags = {
      Project     = "medavida"
      Environment = var.environment
      ManagedBy   = "terraform"
    }
  }
}
