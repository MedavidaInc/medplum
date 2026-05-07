# MedaVida — AWS Deployment Guide

> Last updated: 2026-05-07  
> Stack: ECS Fargate + Aurora Serverless v2 + ElastiCache Redis + S3 + ALB  
> IaC: Terraform (`terraform/aws/`)

---

## Architecture overview

```
Internet
    │
    ▼
[Route 53] api.staging.medavida.com
    │
    ▼
[ALB] HTTPS :443 → HTTP :8103
    │
    ▼
[ECS Fargate] medavida/server container (private subnets)
    │         │                  │
    ▼         ▼                  ▼
[Aurora    [ElastiCache      [S3 bucket]
 Serverless Redis TLS]        binaries
 v2 Postgres]
    │
[Secrets Manager] db-password, redis-password, stripe-secret-key, ...
```

---

## Prerequisites

- AWS CLI configured (`aws sts get-caller-identity` returns your account)
- Terraform >= 1.6 (`terraform version`)
- Docker (for building + pushing the server image)
- An ACM certificate for your domain (must be in `us-east-1`)
- A Route 53 hosted zone (or DNS access to create a CNAME)

---

## Step 1 — Bootstrap Terraform remote state

This only needs to be done once per AWS account.

```sh
# Create the S3 state bucket
aws s3api create-bucket \
  --bucket medavida-terraform-state \
  --region us-east-1

aws s3api put-bucket-versioning \
  --bucket medavida-terraform-state \
  --versioning-configuration Status=Enabled

aws s3api put-bucket-encryption \
  --bucket medavida-terraform-state \
  --server-side-encryption-configuration \
  '{"Rules":[{"ApplyServerSideEncryptionByDefault":{"SSEAlgorithm":"AES256"}}]}'

# Create the DynamoDB lock table
aws dynamodb create-table \
  --table-name medavida-terraform-locks \
  --attribute-definitions AttributeName=LockID,AttributeType=S \
  --key-schema AttributeName=LockID,KeyType=HASH \
  --billing-mode PAY_PER_REQUEST \
  --region us-east-1
```

---

## Step 2 — Request an ACM certificate

```sh
aws acm request-certificate \
  --domain-name "api.staging.medavida.com" \
  --validation-method DNS \
  --region us-east-1
```

Complete the DNS validation in Route 53 (or your DNS provider), then copy the certificate ARN into `terraform.tfvars`.

---

## Step 3 — Configure terraform.tfvars

Edit `terraform/aws/terraform.tfvars` and fill in:

```hcl
app_domain      = "api.staging.medavida.com"
certificate_arn = "arn:aws:acm:us-east-1:YOUR_ACCOUNT_ID:certificate/YOUR_CERT_ID"
app_base_url    = "https://app.staging.medavida.com/"
```

---

## Step 4 — Terraform init + apply

```sh
cd terraform/aws

terraform init
terraform plan     # review what will be created
terraform apply
```

This provisions (~10 minutes):
- VPC + subnets + NAT gateways
- ALB + HTTPS listener
- Aurora Serverless v2 cluster
- ElastiCache Redis
- ECS cluster + task definition + service
- ECR repository
- S3 binary bucket
- Secrets Manager entries
- IAM roles

After apply, note the outputs:
```sh
terraform output
# alb_dns_name       → create your DNS CNAME to this
# ecr_repository_url → used for docker push
```

---

## Step 5 — Point DNS to the ALB

In Route 53 (or your DNS provider), create:
```
CNAME  api.staging.medavida.com  →  <alb_dns_name from terraform output>
```

---

## Step 6 — Build and push the server Docker image

```sh
# Authenticate Docker to ECR
aws ecr get-login-password --region us-east-1 | \
  docker login --username AWS --password-stdin \
  $(terraform output -raw ecr_repository_url | cut -d/ -f1)

# Build the Medplum server image from the repo root
docker build -t medavida/server -f packages/server/Dockerfile .

# Tag and push
ECR_URL=$(cd terraform/aws && terraform output -raw ecr_repository_url)
docker tag medavida/server:latest $ECR_URL:latest
docker push $ECR_URL:latest
```

---

## Step 7 — Trigger the first ECS deployment

After pushing the image, force a new deployment:

```sh
CLUSTER=$(cd terraform/aws && terraform output -raw ecs_cluster_name)
SERVICE=$(cd terraform/aws && terraform output -raw ecs_service_name)

aws ecs update-service \
  --cluster $CLUSTER \
  --service $SERVICE \
  --force-new-deployment \
  --region us-east-1
```

Watch it come up:
```sh
aws ecs wait services-stable \
  --cluster $CLUSTER \
  --services $SERVICE \
  --region us-east-1

echo "Done — checking healthcheck..."
curl https://api.staging.medavida.com/healthcheck
```

---

## Step 8 — Store bot secrets in Secrets Manager

The Stripe and pharmacy secrets were created as empty placeholders by Terraform. Populate them:

```sh
aws secretsmanager put-secret-value \
  --secret-id "medavida/staging/stripe-secret-key" \
  --secret-string "sk_test_YOUR_KEY" \
  --region us-east-1

aws secretsmanager put-secret-value \
  --secret-id "medavida/staging/pharmacy-adapter-api-key" \
  --secret-string "YOUR_KEY" \
  --region us-east-1
```

Then redeploy the ECS service to pick them up (repeat Step 7).

---

## Deploying updates

### New server release
```sh
# Build + push new image with a version tag
docker build -t medavida/server:v1.2.0 -f packages/server/Dockerfile .
docker tag medavida/server:v1.2.0 $ECR_URL:v1.2.0
docker push $ECR_URL:v1.2.0

# Update the task definition to use the new tag
cd terraform/aws
terraform apply -var="server_image_tag=v1.2.0"
```

### Config changes only (no image change)
```sh
cd terraform/aws
terraform apply
# ECS service will redeploy with updated environment variables
```

---

## Monitoring and logs

```sh
# Tail live ECS logs
aws logs tail /ecs/medavida-staging-server --follow --region us-east-1

# View recent errors
aws logs filter-log-events \
  --log-group-name /ecs/medavida-staging-server \
  --filter-pattern "ERROR" \
  --region us-east-1
```

---

## Promoting to production

1. Create a `terraform/aws/production.tfvars` based on `terraform.tfvars`
2. Set `environment = "production"`, update domain + cert ARN
3. Run:
   ```sh
   terraform apply -var-file=production.tfvars
   ```

Key differences applied automatically in production:
- RDS deletion protection enabled
- RDS backup retention 7 days (vs 1 day staging)
- Secrets Manager recovery window 30 days (vs 0 staging)
- CloudWatch log retention 90 days (vs 14 days staging)

---

## Teardown (staging only)

```sh
cd terraform/aws
terraform destroy
```

> RDS and Secrets Manager in production have deletion protection enabled — `terraform destroy` will fail safely without manual overrides.
