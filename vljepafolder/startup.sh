#!/bin/bash
# VL-JEPA Server Startup Script
# Run this on the Google Cloud VM to set up and start the server

set -e

echo "=========================================="
echo "VL-JEPA Server Setup"
echo "=========================================="

# ============================================================================
# Environment Setup
# ============================================================================

export VLJEPA_API_KEY="${VLJEPA_API_KEY:-your-secure-api-key-here}"
export VLJEPA_MODEL_PATH="${VLJEPA_MODEL_PATH:-/home/$USER/models/vljepa_vitl16.pth}"
export MIN_CONFIDENCE="${MIN_CONFIDENCE:-0.80}"
export PORT="${PORT:-8000}"
export HOST="${HOST:-0.0.0.0}"

# ============================================================================
# Check GPU
# ============================================================================

echo ""
echo "[1/5] Checking GPU..."

if command -v nvidia-smi &> /dev/null; then
    nvidia-smi --query-gpu=name,memory.total,driver_version --format=csv
    echo "GPU detected."
else
    echo "Warning: nvidia-smi not found. GPU may not be available."
fi

# ============================================================================
# Install Python Dependencies
# ============================================================================

echo ""
echo "[2/5] Installing Python dependencies..."

cd ~/server

# Upgrade pip
pip install --upgrade pip setuptools wheel --quiet

# Install PyTorch with CUDA support
pip install torch torchvision --index-url https://download.pytorch.org/whl/cu118 --quiet

# Install other dependencies
pip install fastapi uvicorn python-multipart pillow numpy pydantic python-dotenv --quiet

echo "Dependencies installed."

# ============================================================================
# Download VL-JEPA (Optional)
# ============================================================================

echo ""
echo "[3/5] Setting up VL-JEPA model..."

# Create models directory
mkdir -p ~/models

# Note: You need to manually download VL-JEPA weights from Meta
# The model weights are not publicly available via direct download
# See: https://github.com/facebookresearch/jepa

if [ ! -f "$VLJEPA_MODEL_PATH" ]; then
    echo "Warning: Model weights not found at $VLJEPA_MODEL_PATH"
    echo "The server will run in placeholder mode."
    echo ""
    echo "To download VL-JEPA weights:"
    echo "  1. Visit https://github.com/facebookresearch/jepa"
    echo "  2. Follow instructions to download pretrained weights"
    echo "  3. Place weights at: $VLJEPA_MODEL_PATH"
else
    echo "Model weights found."
fi

# ============================================================================
# Create Systemd Service (Optional)
# ============================================================================

echo ""
echo "[4/5] Setting up systemd service..."

# Create systemd service file
sudo tee /etc/systemd/system/vljepa.service > /dev/null << EOF
[Unit]
Description=VL-JEPA Prediction Server
After=network.target

[Service]
Type=simple
User=$USER
WorkingDirectory=/home/$USER/server
Environment="VLJEPA_API_KEY=$VLJEPA_API_KEY"
Environment="VLJEPA_MODEL_PATH=$VLJEPA_MODEL_PATH"
Environment="MIN_CONFIDENCE=$MIN_CONFIDENCE"
Environment="PORT=$PORT"
Environment="HOST=$HOST"
ExecStart=/usr/bin/python3 /home/$USER/server/main.py
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
EOF

# Reload systemd
sudo systemctl daemon-reload

echo "Systemd service created."

# ============================================================================
# Start Server
# ============================================================================

echo ""
echo "[5/5] Starting VL-JEPA server..."

# Enable and start service
sudo systemctl enable vljepa
sudo systemctl start vljepa

# Wait a moment for startup
sleep 5

# Check status
if sudo systemctl is-active --quiet vljepa; then
    echo "Server is running!"
    echo ""
    echo "=========================================="
    echo "Server Status"
    echo "=========================================="
    sudo systemctl status vljepa --no-pager -l
else
    echo "Warning: Server may not have started correctly."
    echo "Check logs with: sudo journalctl -u vljepa -f"
fi

echo ""
echo "=========================================="
echo "Setup Complete!"
echo "=========================================="
echo ""
echo "Server is running on port $PORT"
echo ""
echo "Useful commands:"
echo "  View logs:    sudo journalctl -u vljepa -f"
echo "  Restart:      sudo systemctl restart vljepa"
echo "  Stop:         sudo systemctl stop vljepa"
echo "  Status:       sudo systemctl status vljepa"
echo ""
echo "Test the API:"
echo "  curl http://localhost:$PORT/health"
echo ""
echo "=========================================="
