# VL-JEPA Server for Cloud Run GPU

FastAPI server that wraps VL-JEPA for intent prediction, optimized for Google Cloud Run with GPU (NVIDIA L4).

## Quick Deploy

```bash
# 1. Set project
gcloud config set project YOUR_PROJECT_ID

# 2. Enable APIs
gcloud services enable run.googleapis.com cloudbuild.googleapis.com

# 3. Build & Deploy
gcloud builds submit --tag gcr.io/YOUR_PROJECT_ID/vljepa-server

gcloud run deploy vljepa-server \
    --image gcr.io/YOUR_PROJECT_ID/vljepa-server \
    --region us-central1 \
    --memory 16Gi \
    --cpu 4 \
    --gpu 1 \
    --gpu-type nvidia-l4 \
    --min-instances 0 \
    --max-instances 1 \
    --port 8080 \
    --allow-unauthenticated \
    --set-env-vars "VLJEPA_API_KEY=your-key" \
    --no-cpu-throttling \
    --execution-environment gen2
```

## Files

| File | Description |
|------|-------------|
| `main.py` | FastAPI server with VL-JEPA wrapper |
| `requirements.txt` | Python dependencies (CUDA 12.1) |
| `Dockerfile` | Cloud Run optimized container |
| `deploy-cloudrun.sh` | One-click deployment script |
| `cloudbuild.yaml` | CI/CD configuration |
| `.dockerignore` | Build optimization |

## API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/health` | GET | Health check with GPU info |
| `/startup` | GET | Startup probe for Cloud Run |
| `/ready` | GET | Readiness probe |
| `/api/predict` | POST | Main prediction endpoint |

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | 8080 | Server port (Cloud Run sets this) |
| `VLJEPA_API_KEY` | - | API authentication key |
| `MIN_CONFIDENCE` | 0.80 | Minimum confidence threshold |
| `VLJEPA_MODEL_PATH` | /app/models/vljepa_vitl16.pth | Model weights path |

## Request Format

```json
POST /api/predict
Headers: X-API-Key: your-key
{
  "frames": ["base64-jpeg", ...],
  "timestamp": "2026-01-25T12:00:00Z",
  "context": {
    "monitorWidth": 1920,
    "monitorHeight": 1080,
    "cursorX": 450,
    "cursorY": 320
  }
}
```

## Response Format

```json
{
  "confidence": 0.92,
  "description": "Click the Save button",
  "actions": [
    {
      "type": "click",
      "target": "Save button",
      "region": { "x": 450, "y": 320, "width": 80, "height": 30 }
    }
  ]
}
```

## Cost (Cloud Run GPU)

- Pay only when processing requests
- Scales to zero = $0 when idle
- ~$0.000234/GPU-second when running

For detailed setup instructions, refer to the deployment section above.
