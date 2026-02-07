# VL-JEPA Server Dockerfile
# Optimized for Google Cloud Run with GPU (NVIDIA L4)

FROM nvidia/cuda:12.1-cudnn8-runtime-ubuntu22.04

# Prevent interactive prompts during build
ENV DEBIAN_FRONTEND=noninteractive

# Set working directory
WORKDIR /app

# Install Python and system dependencies
RUN apt-get update && apt-get install -y \
    python3.11 \
    python3.11-venv \
    python3-pip \
    curl \
    && rm -rf /var/lib/apt/lists/* \
    && apt-get clean

# Create symlinks for python
RUN ln -sf /usr/bin/python3.11 /usr/bin/python && \
    ln -sf /usr/bin/pip3 /usr/bin/pip

# Upgrade pip
RUN pip install --upgrade pip setuptools wheel

# Copy requirements first (for Docker cache optimization)
COPY requirements.txt .

# Install Python dependencies
RUN pip install --no-cache-dir -r requirements.txt

# Copy application code
COPY main.py .

# Create models directory (for optional model weights)
RUN mkdir -p /app/models

# ============================================================================
# Cloud Run Configuration
# ============================================================================
# Cloud Run injects PORT env var - server MUST listen on this port
# Default to 8080 (Cloud Run default) but allow override
ENV PYTHONUNBUFFERED=1
ENV PORT=8080
ENV HOST=0.0.0.0
ENV VLJEPA_MODEL_PATH=/app/models/vljepa_vitl16.pth
ENV MIN_CONFIDENCE=0.80

# Cloud Run does not use EXPOSE, but we document it
EXPOSE 8080

# Cloud Run handles health checks via HTTP - no HEALTHCHECK needed
# Cloud Run will call the /health endpoint automatically

# Run with optimized settings for Cloud Run
# - Single worker (Cloud Run handles scaling)
# - No reload (production)
# - Timeout set high for GPU cold starts
CMD exec python main.py
