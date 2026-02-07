using PredictiveDesktopLayer.Domain.Enums;
using PredictiveDesktopLayer.Domain.Models;

namespace PredictiveDesktopLayer.Domain.Actions;

public class RightClickAction : IAction
{
    public ActionType Type => ActionType.RightClick;
    public required string Target { get; init; }
    public required Region? TargetRegion { get; init; }
    public Func<int, int, CancellationToken, Task>? Executor { get; set; }

    public async Task ExecuteAsync(CancellationToken cancellationToken = default)
    {
        if (TargetRegion == null || Executor == null) return;
        await Executor(TargetRegion.CenterX, TargetRegion.CenterY, cancellationToken);
    }

    public IAction? CreateReverseAction() => null;
}
