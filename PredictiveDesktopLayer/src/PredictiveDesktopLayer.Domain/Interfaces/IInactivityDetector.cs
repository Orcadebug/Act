namespace PredictiveDesktopLayer.Domain.Interfaces;

public interface IInactivityDetector
{
    TimeSpan GetIdleTime();
    bool IsInactive(TimeSpan threshold);
    (int X, int Y) GetCursorPosition();
}
