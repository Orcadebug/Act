namespace PredictiveDesktopLayer.Domain.Models;

public class CapturedFrame
{
    public required byte[] ImageData { get; init; }
    public required DateTime CapturedAt { get; init; }
    public required int Width { get; init; }
    public required int Height { get; init; }
    public int CursorX { get; init; }
    public int CursorY { get; init; }
}
