namespace PredictiveDesktopLayer.Domain.Models;

public record Region(int X, int Y, int Width, int Height)
{
    public int CenterX => X + Width / 2;
    public int CenterY => Y + Height / 2;
}
