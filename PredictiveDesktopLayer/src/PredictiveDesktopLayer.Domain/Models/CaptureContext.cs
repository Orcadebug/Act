namespace PredictiveDesktopLayer.Domain.Models;

public class CaptureContext
{
    public required int MonitorWidth { get; init; }
    public required int MonitorHeight { get; init; }
    public required int CursorX { get; init; }
    public required int CursorY { get; init; }
    public DateTime Timestamp { get; init; } = DateTime.UtcNow;
}
