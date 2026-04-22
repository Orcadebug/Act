using PredictiveDesktopLayer.Domain.Interfaces;
using PredictiveDesktopLayer.Domain.Models;

namespace PredictiveDesktopLayer.Infrastructure.Capture;

public class FrameBufferManager : IFrameBuffer
{
    private readonly LinkedList<CapturedFrame> _frames = new();
    private readonly object _lock = new();

    public int MaxSize { get; }
    public int Count
    {
        get
        {
            lock (_lock) return _frames.Count;
        }
    }

    public FrameBufferManager(int maxSize = 12)
    {
        MaxSize = maxSize;
    }

    public void Add(CapturedFrame frame)
    {
        lock (_lock)
        {
            _frames.AddLast(frame);

            while (_frames.Count > MaxSize)
            {
                _frames.RemoveFirst();
            }
        }
    }

    public IReadOnlyList<CapturedFrame> GetRecentFrames(int count)
    {
        lock (_lock)
        {
            return _frames.TakeLast(count).ToList();
        }
    }

    public IReadOnlyList<CapturedFrame> GetFramesSince(DateTime since)
    {
        lock (_lock)
        {
            return _frames.Where(f => f.CapturedAt >= since).ToList();
        }
    }

    public void Clear()
    {
        lock (_lock)
        {
            _frames.Clear();
        }
    }
}
