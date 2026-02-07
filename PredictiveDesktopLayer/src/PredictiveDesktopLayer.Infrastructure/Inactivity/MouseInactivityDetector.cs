using System.Runtime.InteropServices;
using PredictiveDesktopLayer.Domain.Interfaces;

namespace PredictiveDesktopLayer.Infrastructure.Inactivity;

public class MouseInactivityDetector : IInactivityDetector
{
    [StructLayout(LayoutKind.Sequential)]
    private struct LASTINPUTINFO
    {
        public uint cbSize;
        public uint dwTime;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct POINT
    {
        public int X;
        public int Y;
    }

    [DllImport("user32.dll")]
    private static extern bool GetLastInputInfo(ref LASTINPUTINFO plii);

    [DllImport("kernel32.dll")]
    private static extern uint GetTickCount();

    [DllImport("user32.dll")]
    private static extern bool GetCursorPos(out POINT lpPoint);

    public TimeSpan GetIdleTime()
    {
        var lastInput = new LASTINPUTINFO { cbSize = (uint)Marshal.SizeOf<LASTINPUTINFO>() };

        if (!GetLastInputInfo(ref lastInput))
        {
            return TimeSpan.Zero;
        }

        var idleTime = GetTickCount() - lastInput.dwTime;
        return TimeSpan.FromMilliseconds(idleTime);
    }

    public bool IsInactive(TimeSpan threshold)
    {
        return GetIdleTime() >= threshold;
    }

    public (int X, int Y) GetCursorPosition()
    {
        if (GetCursorPos(out var point))
        {
            return (point.X, point.Y);
        }
        return (0, 0);
    }
}
