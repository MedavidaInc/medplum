#!/usr/bin/env bash

ECS_CLUSTER="${ECS_CLUSTER:-medavida}"
ECS_SERVICE="${ECS_SERVICE:-medavida-medplum}"

# Fail on error
set -e

# Echo commands
set -x

# Update the medplum fargate service
aws ecs update-service \
  --region "${AWS_REGION:-us-east-2}" \
  --cluster "$ECS_CLUSTER" \
  --service "$ECS_SERVICE" \
  --force-new-deployment

# Optionally update a worker service if both env vars are set
if [[ -n "${WORKER_ECS_CLUSTER}" && -n "${WORKER_ECS_SERVICE}" ]]; then
  echo "Forcing new deployment of worker service $WORKER_ECS_SERVICE in $WORKER_ECS_CLUSTER"
  aws ecs update-service \
    --cluster "$WORKER_ECS_CLUSTER" \
    --service "$WORKER_ECS_SERVICE" \
    --force-new-deployment
fi
