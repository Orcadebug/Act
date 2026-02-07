using PredictiveDesktopLayer.Domain.Models;

namespace PredictiveDesktopLayer.Domain.Interfaces;

public interface IScreenCapture : IDisposable
{
    Task<CapturedFrame?> CaptureAsync(CancellationToken cancellationToken = default);
    Task StartAsync(CancellationToken cancellationToken = default);
    Task StopAsync(CancellationToken cancellationToken = default);
}
