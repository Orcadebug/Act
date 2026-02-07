#!/bin/bash
# VL-JEPA Server Deployment Script for Google Cloud Run with GPU
# Usage: ./deploy-cloudrun.sh [project-id] [region]

set -e  # Exit on error

# ============================================================================
# Configuration
# ============================================================================

PROJECT_ID="${1:-predictive-desktop-vljepa}"
REGION="${2:-us-central1}"
SERVICE_NAME="vljepa-server"
IMAGE_NAME="gcr.io/$PROJECT_ID/$SERVICE_NAME"

# Cloud Run GPU Configuration
MEMORY="16Gi"
CPU="4"
GPU_COUNT="1"
GPU_TYPE="nvidia-l4"
MIN_INSTANCES="0"  # Scale to zero when not in use
MAX_INSTANCES="1"  # Limit for cost control
TIMEOUT="300"      # 5 min timeout for cold starts
CONCURRENCY="10"   # Requests per instance

echo "=========================================="
echo "VL-JEPA Cloud Run GPU Deployment"
echo "=========================================="
echo "Project:  $PROJECT_ID"
echo "Region:   $REGION"
echo "Service:  $SERVICE_NAME"
echo "GPU:      $GPU_TYPE x $GPU_COUNT"
echo "=========================================="

# ============================================================================
# Step 1: Setup Google Cloud Project
# ============================================================================

echo ""
echo "[1/6] Setting up Google Cloud project..."

gcloud config set project "$PROJECT_ID"

# Enable required APIs
gcloud services enable run.googleapis.com --quiet
gcloud services enable cloudbuild.googleapis.com --quiet
gcloud services enable artifactregistry.googleapis.com --quiet

echo "Project setup complete."

# ============================================================================
# Step 2: Build Container Image
# ============================================================================

echo ""
echo "[2/6] Building container image..."

# Build using Cloud Build (no local Docker needed)
gcloud builds submit --tag "$IMAGE_NAME" --timeout=1800 .

echo "Container image built: $IMAGE_NAME"

# ============================================================================
# Step 3: Deploy to Cloud Run with GPU
# ============================================================================

echo ""
echo "[3/6] Deploying to Cloud Run with GPU..."

gcloud run deploy "$SERVICE_NAME" \
    --image "$IMAGE_NAME" \
    --platform managed \
    --region "$REGION" \
    --memory "$MEMORY" \
    --cpu "$CPU" \
    --gpu "$GPU_COUNT" \
    --gpu-type "$GPU_TYPE" \
    --min-instances "$MIN_INSTANCES" \
    --max-instances "$MAX_INSTANCES" \
    --timeout "$TIMEOUT" \
    --concurrency "$CONCURRENCY" \
    --port 8080 \
    --allow-unauthenticated \
    --set-env-vars "VLJEPA_API_KEY=${VLJEPA_API_KEY:-your-secure-api-key-here}" \
    --set-env-vars "MIN_CONFIDENCE=0.80" \
    --no-cpu-throttling \
    --execution-environment gen2

echo "Deployment complete."

# ============================================================================
# Step 4: Get Service URL
# ============================================================================

echo ""
echo "[4/6] Getting service URL..."

SERVICE_URL=$(gcloud run services describe "$SERVICE_NAME" \
    --region "$REGION" \
    --format='value(status.url)')

echo "Service URL: $SERVICE_URL"

# ============================================================================
# Step 5: Verify Deployment
# ============================================================================

echo ""
echo "[5/6] Verifying deployment..."

# Wait for service to be ready
sleep 10

# Health check
if curl -s --max-time 30 "$SERVICE_URL/health" > /dev/null 2>&1; then
    echo "Health check passed!"
    curl -s "$SERVICE_URL/health" | python3 -m json.tool 2>/dev/null || curl -s "$SERVICE_URL/health"
else
    echo "Warning: Health check timed out. Service may still be starting (cold start)."
    echo "Try manually: curl $SERVICE_URL/health"
fi

# ============================================================================
# Step 6: Output Configuration
# ============================================================================

echo ""
echo "[6/6] Configuration for your desktop app..."

echo ""
echo "=========================================="
echo "Deployment Complete!"
echo "=========================================="
echo ""
echo "Service URL: $SERVICE_URL"
echo "API Endpoint: $SERVICE_URL/api/predict"
echo ""
echo "Update your appsettings.json with:"
echo ""
cat << EOF
{
  "CloudBrain": {
    "PredictionEndpoint": "$SERVICE_URL/api/predict",
    "ApiKey": "${VLJEPA_API_KEY:-your-secure-api-key-here}",
    "TimeoutMs": 5000,
    "MinConfidence": 0.80
  }
}
EOF
echo ""
echo "=========================================="
echo "Cost Info (Cloud Run GPU pricing):"
echo "  - Pay only when requests are being processed"
echo "  - ~\$0.000036/vCPU-second + \$0.00000474/GPU-second"
echo "  - Scale to zero = no charges when idle"
echo "=========================================="
echo ""
echo "Commands:"
echo "  Logs:    gcloud run services logs read $SERVICE_NAME --region $REGION"
echo "  Delete:  gcloud run services delete $SERVICE_NAME --region $REGION"
echo "  Update:  ./deploy-cloudrun.sh"
echo "=========================================="
