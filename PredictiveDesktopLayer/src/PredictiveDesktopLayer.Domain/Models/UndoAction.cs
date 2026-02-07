using PredictiveDesktopLayer.Domain.Actions;

namespace PredictiveDesktopLayer.Domain.Models;

public class UndoAction
{
    public required IAction OriginalAction { get; init; }
    public required IAction? ReverseAction { get; init; }
    public DateTime ExecutedAt { get; init; } = DateTime.UtcNow;
}
