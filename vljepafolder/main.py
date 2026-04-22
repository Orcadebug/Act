"""
VL-JEPA Prediction Server for Predictive Desktop Layer
FastAPI server that processes screen frames and predicts user intent.
"""

import os
import io
import base64
import logging
from datetime import datetime
from typing import Optional
from contextlib import asynccontextmanager

import torch
import numpy as np
from PIL import Image
from fastapi import FastAPI, HTTPException, Header, Request
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import uvicorn

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s"
)
logger = logging.getLogger("vljepa-server")

# ============================================================================
# Configuration
# ============================================================================

API_KEY = os.getenv("VLJEPA_API_KEY", "your-secure-api-key-here")
MODEL_PATH = os.getenv("VLJEPA_MODEL_PATH", "./models/vljepa_vitl16.pth")
DEVICE = "cuda" if torch.cuda.is_available() else "cpu"
MIN_CONFIDENCE = float(os.getenv("MIN_CONFIDENCE", "0.80"))

# ============================================================================
# Request/Response Models (matches context.md API contract)
# ============================================================================

class FrameContext(BaseModel):
    monitorWidth: int
    monitorHeight: int
    cursorX: int
    cursorY: int

class PredictionRequest(BaseModel):
    frames: list[str]  # Base64-encoded JPEG images
    timestamp: str
    context: FrameContext

class ActionRegion(BaseModel):
    x: int
    y: int
    width: int
    height: int

class PredictedAction(BaseModel):
    type: str  # click, right_click, double_click, type, key, drag, scroll
    target: str
    region: Optional[ActionRegion] = None
    text: Optional[str] = None  # For type actions
    keys: Optional[str] = None  # For key actions
    endX: Optional[int] = None  # For drag actions
    endY: Optional[int] = None
    direction: Optional[str] = None  # For scroll actions
    amount: Optional[int] = None

class PredictionResponse(BaseModel):
    confidence: float
    description: str
    actions: list[PredictedAction]

# ============================================================================
# Model Loading
# ============================================================================

class VLJEPAPredictor:
    """
    Wrapper for VL-JEPA model.

    Note: This is a simplified implementation. The actual VL-JEPA integration
    will depend on Meta's official implementation details.
    """

    def __init__(self, model_path: str, device: str):
        self.device = device
        self.model = None
        self.model_path = model_path

    def load_model(self):
        """Load the VL-JEPA model weights."""
        logger.info(f"Loading VL-JEPA model from {self.model_path} on {self.device}")

        try:
            # TODO: Replace with actual VL-JEPA model loading
            # from jepa.models import build_model
            # self.model = build_model(...)
            # self.model.load_state_dict(torch.load(self.model_path))
            # self.model.to(self.device)
            # self.model.eval()

            # Placeholder: Model loading would happen here
            logger.info("VL-JEPA model loaded successfully (placeholder mode)")

        except Exception as e:
            logger.error(f"Failed to load model: {e}")
            raise

    def decode_frame(self, base64_data: str) -> np.ndarray:
        """Decode a base64 JPEG to numpy array."""
        try:
            image_bytes = base64.b64decode(base64_data)
            image = Image.open(io.BytesIO(image_bytes))
            return np.array(image)
        except Exception as e:
            logger.error(f"Failed to decode frame: {e}")
            raise ValueError(f"Invalid frame data: {e}")

    def preprocess_frames(self, frames: list[np.ndarray]) -> torch.Tensor:
        """Preprocess frames for VL-JEPA input."""
        # Normalize and stack frames
        processed = []
        for frame in frames:
            # Resize to model input size (e.g., 224x224)
            img = Image.fromarray(frame)
            img = img.resize((224, 224))

            # Normalize to [0, 1] then apply ImageNet normalization
            arr = np.array(img).astype(np.float32) / 255.0
            mean = np.array([0.485, 0.456, 0.406])
            std = np.array([0.229, 0.224, 0.225])
            arr = (arr - mean) / std

            # Convert to CHW format
            arr = arr.transpose(2, 0, 1)
            processed.append(arr)

        # Stack into batch tensor [T, C, H, W]
        tensor = torch.tensor(np.stack(processed), dtype=torch.float32)
        return tensor.to(self.device)

    def predict(self, frames: list[str], context: FrameContext) -> PredictionResponse:
        """
        Run VL-JEPA inference on frames and return predicted actions.

        This is a placeholder implementation. In production, this would:
        1. Encode frames through VL-JEPA vision encoder
        2. Use the learned representations to predict next actions
        3. Post-process predictions into actionable commands
        """

        # Decode frames
        decoded_frames = [self.decode_frame(f) for f in frames]

        # Preprocess for model
        input_tensor = self.preprocess_frames(decoded_frames)
        logger.info(f"Preprocessed {len(frames)} frames, shape: {input_tensor.shape}")

        # TODO: Actual VL-JEPA inference
        # with torch.no_grad():
        #     embeddings = self.model.encode(input_tensor)
        #     predictions = self.model.predict_actions(embeddings, context)

        # ====================================================================
        # PLACEHOLDER: Simulated prediction based on cursor position
        # Replace this with actual VL-JEPA inference
        # ====================================================================

        cursor_x = context.cursorX
        cursor_y = context.cursorY

        # Analyze the last frame to detect UI elements (placeholder logic)
        last_frame = decoded_frames[-1]

        # Simulated confidence based on cursor position stability
        confidence = 0.85

        # Generate a plausible action based on cursor position
        # In production, this would come from the model's predictions
        actions = []
        description = "Click at current cursor position"

        # Determine action based on cursor position
        if cursor_y > context.monitorHeight - 150:
            # Bottom of screen - likely taskbar
            description = "Open application from taskbar"
            actions.append(PredictedAction(
                type="click",
                target="Taskbar item",
                region=ActionRegion(
                    x=cursor_x - 20,
                    y=cursor_y - 10,
                    width=40,
                    height=40
                )
            ))
        elif cursor_y < 100:
            # Top of screen - likely menu or toolbar
            description = "Click menu or toolbar button"
            actions.append(PredictedAction(
                type="click",
                target="Menu button",
                region=ActionRegion(
                    x=cursor_x - 40,
                    y=cursor_y - 15,
                    width=80,
                    height=30
                )
            ))
        else:
            # General screen area - always predict a click at cursor
            description = "Click on UI element"
            actions.append(PredictedAction(
                type="click",
                target="UI element",
                region=ActionRegion(
                    x=cursor_x - 50,
                    y=cursor_y - 15,
                    width=100,
                    height=30
                )
            ))

        return PredictionResponse(
            confidence=confidence,
            description=description,
            actions=actions
        )

# ============================================================================
# FastAPI Application
# ============================================================================

# Global predictor instance
predictor: Optional[VLJEPAPredictor] = None

@asynccontextmanager
async def lifespan(app: FastAPI):
    """Load model on startup, cleanup on shutdown."""
    global predictor

    logger.info("Starting VL-JEPA server...")
    predictor = VLJEPAPredictor(MODEL_PATH, DEVICE)

    try:
        predictor.load_model()
    except Exception as e:
        logger.warning(f"Model loading failed: {e}. Running in placeholder mode.")

    yield

    logger.info("Shutting down VL-JEPA server...")
    predictor = None

app = FastAPI(
    title="VL-JEPA Prediction Server",
    description="Vision-Language Joint Embedding Predictive Architecture for Desktop Intent Prediction",
    version="1.0.0",
    lifespan=lifespan
)

# CORS middleware for local development
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ============================================================================
# API Endpoints
# ============================================================================

@app.get("/health")
async def health_check():
    """Health check endpoint."""
    return {
        "status": "healthy",
        "device": DEVICE,
        "gpu_available": torch.cuda.is_available(),
        "gpu_name": torch.cuda.get_device_name(0) if torch.cuda.is_available() else None,
        "timestamp": datetime.utcnow().isoformat()
    }

@app.get("/")
async def root():
    """Root endpoint with API info."""
    return {
        "name": "VL-JEPA Prediction Server",
        "version": "1.0.0",
        "endpoints": {
            "/health": "Health check",
            "/api/predict": "POST - Submit frames for prediction"
        }
    }

@app.post("/api/predict", response_model=PredictionResponse)
async def predict(
    request: PredictionRequest,
    x_api_key: str = Header(None, alias="X-API-Key")
):
    """
    Process screen frames and predict user intent.

    Request body:
    - frames: List of base64-encoded JPEG images
    - timestamp: ISO timestamp of capture
    - context: Monitor dimensions and cursor position

    Returns predicted actions with confidence scores.
    """

    # Validate API key
    if x_api_key != API_KEY:
        raise HTTPException(status_code=401, detail="Invalid API key")

    # Validate request
    if not request.frames:
        raise HTTPException(status_code=400, detail="No frames provided")

    if len(request.frames) > 20:
        raise HTTPException(status_code=400, detail="Too many frames (max 20)")

    logger.info(f"Received prediction request: {len(request.frames)} frames, cursor at ({request.context.cursorX}, {request.context.cursorY})")

    try:
        # Run prediction
        result = predictor.predict(request.frames, request.context)

        # Filter low-confidence predictions
        if result.confidence < MIN_CONFIDENCE:
            logger.info(f"Prediction below threshold: {result.confidence:.2f} < {MIN_CONFIDENCE}")
            return PredictionResponse(
                confidence=result.confidence,
                description="No confident prediction",
                actions=[]
            )

        logger.info(f"Prediction: {result.description} (confidence: {result.confidence:.2f})")
        return result

    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.error(f"Prediction failed: {e}")
        raise HTTPException(status_code=500, detail="Prediction failed")

# ============================================================================
# Cloud Run Startup Probe Endpoint
# ============================================================================

@app.get("/startup")
async def startup_probe():
    """
    Cloud Run startup probe endpoint.
    Returns 200 when the service is ready to receive traffic.
    """
    return {"status": "ready", "model_loaded": predictor is not None}

@app.get("/ready")
async def readiness_probe():
    """
    Readiness probe for Cloud Run.
    """
    if predictor is None:
        raise HTTPException(status_code=503, detail="Model not loaded")
    return {"status": "ready"}

# ============================================================================
# Main Entry Point
# ============================================================================

if __name__ == "__main__":
    # Cloud Run injects PORT environment variable
    # Default to 8080 (Cloud Run default) instead of 8000
    port = int(os.getenv("PORT", "8080"))
    host = os.getenv("HOST", "0.0.0.0")

    logger.info(f"Starting VL-JEPA server on {host}:{port}")
    logger.info(f"Device: {DEVICE}")
    logger.info(f"GPU Available: {torch.cuda.is_available()}")
    if torch.cuda.is_available():
        logger.info(f"GPU Name: {torch.cuda.get_device_name(0)}")
        logger.info(f"GPU Memory: {torch.cuda.get_device_properties(0).total_memory / 1e9:.1f} GB")

    # Cloud Run optimized settings:
    # - Single worker (Cloud Run handles horizontal scaling)
    # - No reload in production
    # - Longer timeout for GPU model loading
    uvicorn.run(
        "main:app",
        host=host,
        port=port,
        reload=False,
        workers=1,  # Single worker for GPU memory management
        log_level="info",
        timeout_keep_alive=120  # Keep connections alive longer for Cloud Run
    )
