#!/bin/bash
# Deploy Claude Flow Registry Cloud Function

set -e

PROJECT_ID="${GCP_PROJECT:-claude-flow}"
REGION="${GCP_REGION:-us-central1}"
FUNCTION_NAME="publish-registry"

echo "=== Deploying Cloud Function ==="
echo "Project: $PROJECT_ID"
echo "Region: $REGION"
echo "Function: $FUNCTION_NAME"
echo ""

# Create bucket if not exists
echo "Creating storage bucket..."
gsutil mb -p $PROJECT_ID gs://claude-flow-plugin-registry 2>/dev/null || true

# Create secrets if not exist
echo "Setting up secrets..."
echo "Note: You need to manually set these secrets in Secret Manager:"
echo "  - pinata-jwt: Your Pinata JWT token"
echo "  - registry-private-key: Ed25519 private key (32 bytes hex)"
echo ""

# Deploy function
echo "Deploying function..."
gcloud functions deploy $FUNCTION_NAME \
  --gen2 \
  --runtime=nodejs20 \
  --region=$REGION \
  --source=. \
  --entry-point=publishRegistry \
  --trigger-http \
  --allow-unauthenticated \
  --memory=256MB \
  --timeout=60s \
  --set-env-vars="GCP_PROJECT=$PROJECT_ID" \
  --project=$PROJECT_ID

echo ""
echo "=== Deployment Complete ==="
FUNCTION_URL=$(gcloud functions describe $FUNCTION_NAME --region=$REGION --project=$PROJECT_ID --format='value(url)')
echo "Function URL: $FUNCTION_URL"
echo ""
echo "Test with:"
echo "  curl '$FUNCTION_URL?action=status'"
echo ""
echo "Rate a plugin:"
echo "  curl -X POST '$FUNCTION_URL?action=rate' -H 'Content-Type: application/json' -d '{\"itemId\":\"@claude-flow/embeddings\",\"rating\":5}'"
