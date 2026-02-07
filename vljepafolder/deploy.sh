#!/bin/bash
# VL-JEPA Server Deployment Script for Google Cloud
# Usage: ./deploy.sh [project-id] [zone]

set -e  # Exit on error

# ============================================================================
# Configuration
# ============================================================================

PROJECT_ID="${1:-predictive-desktop-vljepa}"
ZONE="${2:-us-central1-a}"
INSTANCE_NAME="vljepa-server"
MACHINE_TYPE="n1-standard-8"
GPU_TYPE="nvidia-tesla-t4"
DISK_SIZE="100GB"

echo "=========================================="
echo "VL-JEPA Server Deployment"
echo "=========================================="
echo "Project: $PROJECT_ID"
echo "Zone: $ZONE"
echo "Instance: $INSTANCE_NAME"
echo "=========================================="

# ============================================================================
# Step 1: Setup Google Cloud Project
# ============================================================================

echo ""
echo "[1/7] Setting up Google Cloud project..."

# Set active project
gcloud config set project "$PROJECT_ID"

# Enable required APIs
gcloud services enable compute.googleapis.com --quiet
gcloud services enable containerregistry.googleapis.com --quiet

echo "Project setup complete."

# ============================================================================
# Step 2: Create Firewall Rules
# ============================================================================

echo ""
echo "[2/7] Creating firewall rules..."

# Check if firewall rule exists
if ! gcloud compute firewall-rules describe allow-vljepa-api --quiet 2>/dev/null; then
    gcloud compute firewall-rules create allow-vljepa-api \
        --allow=tcp:8000 \
        --target-tags=http-server \
        --description="Allow VL-JEPA API traffic on port 8000" \
        --quiet
    echo "Firewall rule created."
else
    echo "Firewall rule already exists."
fi

# ============================================================================
# Step 3: Create GPU VM Instance
# ============================================================================

echo ""
echo "[3/7] Creating GPU VM instance..."

# Check if instance exists
if gcloud compute instances describe "$INSTANCE_NAME" --zone="$ZONE" --quiet 2>/dev/null; then
    echo "Instance already exists. Skipping creation."
else
    gcloud compute instances create "$INSTANCE_NAME" \
        --zone="$ZONE" \
        --machine-type="$MACHINE_TYPE" \
        --accelerator="type=$GPU_TYPE,count=1" \
        --image-family=pytorch-latest-gpu \
        --image-project=deeplearning-platform-release \
        --boot-disk-size="$DISK_SIZE" \
        --boot-disk-type=pd-ssd \
        --maintenance-policy=TERMINATE \
        --metadata="install-nvidia-driver=True" \
        --tags=http-server,https-server \
        --quiet

    echo "Waiting for instance to be ready..."
    sleep 60
fi

echo "VM instance ready."

# ============================================================================
# Step 4: Get Instance IP
# ============================================================================

echo ""
echo "[4/7] Getting instance external IP..."

EXTERNAL_IP=$(gcloud compute instances describe "$INSTANCE_NAME" \
    --zone="$ZONE" \
    --format='get(networkInterfaces[0].accessConfigs[0].natIP)')

echo "External IP: $EXTERNAL_IP"

# ============================================================================
# Step 5: Upload Server Files
# ============================================================================

echo ""
echo "[5/7] Uploading server files..."

# Create server directory on VM
gcloud compute ssh "$INSTANCE_NAME" --zone="$ZONE" --command="mkdir -p ~/server ~/models" --quiet

# Upload files
gcloud compute scp main.py "$INSTANCE_NAME":~/server/ --zone="$ZONE" --quiet
gcloud compute scp requirements.txt "$INSTANCE_NAME":~/server/ --zone="$ZONE" --quiet
gcloud compute scp startup.sh "$INSTANCE_NAME":~/server/ --zone="$ZONE" --quiet

echo "Files uploaded."

# ============================================================================
# Step 6: Install Dependencies and Start Server
# ============================================================================

echo ""
echo "[6/7] Installing dependencies and starting server..."

gcloud compute ssh "$INSTANCE_NAME" --zone="$ZONE" --command="
    cd ~/server
    chmod +x startup.sh
    ./startup.sh
" --quiet

echo "Server starting..."

# ============================================================================
# Step 7: Verify Deployment
# ============================================================================

echo ""
echo "[7/7] Verifying deployment..."

# Wait for server to start
echo "Waiting for server to initialize..."
sleep 30

# Health check
if curl -s --max-time 10 "http://$EXTERNAL_IP:8000/health" > /dev/null 2>&1; then
    echo "Health check passed!"
else
    echo "Warning: Health check failed. Server may still be starting."
    echo "Try manually: curl http://$EXTERNAL_IP:8000/health"
fi

# ============================================================================
# Complete
# ============================================================================

echo ""
echo "=========================================="
echo "Deployment Complete!"
echo "=========================================="
echo ""
echo "Server URL: http://$EXTERNAL_IP:8000"
echo "API Endpoint: http://$EXTERNAL_IP:8000/api/predict"
echo ""
echo "Update your appsettings.json with:"
echo ""
echo '{
  "CloudBrain": {
    "PredictionEndpoint": "http://'"$EXTERNAL_IP"':8000/api/predict",
    "ApiKey": "your-secure-api-key-here",
    "TimeoutMs": 2000,
    "MinConfidence": 0.80
  }
}'
echo ""
echo "=========================================="
echo "Commands:"
echo "  SSH: gcloud compute ssh $INSTANCE_NAME --zone=$ZONE"
echo "  Stop: gcloud compute instances stop $INSTANCE_NAME --zone=$ZONE"
echo "  Start: gcloud compute instances start $INSTANCE_NAME --zone=$ZONE"
echo "  Delete: gcloud compute instances delete $INSTANCE_NAME --zone=$ZONE"
echo "=========================================="
