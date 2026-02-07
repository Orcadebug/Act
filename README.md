An intelligent Windows desktop application that observes user activity, predicts intent using vision AI, and offers automated action suggestions with human-in-the-loop approval

How its works
1. **Observe** - Continuously captures screen at 3 FPS
2. **Detect** - Identifies when you pause (1 second inactivity)
3. **Predict** - Sends frames to VL-JEPA cloud AI for intent prediction
4. **Suggest** - Shows a floating overlay with the predicted action
5. **Execute** - Single Alt tap approves, double tap dismisses

Desktop: .NET 8, WPF, DXGI Desktop Duplication
AI Server: Python, FastAPI, VL-JEPA, CUDA
Cloud: Google Cloud Run with NVIDIA L4 GPU
