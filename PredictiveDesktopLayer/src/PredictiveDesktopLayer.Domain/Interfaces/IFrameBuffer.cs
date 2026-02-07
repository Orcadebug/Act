using PredictiveDesktopLayer.Domain.Models;

namespace PredictiveDesktopLayer.Domain.Interfaces;

public interface IFrameBuffer
{
    void Add(CapturedFrame frame);
    IReadOnlyList<CapturedFrame> GetRecentFrames(int count);
    IReadOnlyList<CapturedFrame> GetFramesSince(DateTime since);
    void Clear();
    int Count { get; }
    int MaxSize { get; }
}
