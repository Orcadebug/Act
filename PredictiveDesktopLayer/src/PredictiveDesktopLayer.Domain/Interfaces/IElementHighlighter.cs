using PredictiveDesktopLayer.Domain.Models;

namespace PredictiveDesktopLayer.Domain.Interfaces;

public interface IElementHighlighter
{
    Task ShowHighlightAsync(Region region, CancellationToken cancellationToken = default);
    Task HideHighlightAsync();
    bool IsVisible { get; }
}
