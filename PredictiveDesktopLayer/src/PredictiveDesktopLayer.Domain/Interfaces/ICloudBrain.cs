using PredictiveDesktopLayer.Domain.Models;

namespace PredictiveDesktopLayer.Domain.Interfaces;

public interface ICloudBrain
{
    Task<CloudBrainResponse?> PredictAsync(
        IReadOnlyList<CapturedFrame> frames,
        CaptureContext context,
        CancellationToken cancellationToken = default);
}
