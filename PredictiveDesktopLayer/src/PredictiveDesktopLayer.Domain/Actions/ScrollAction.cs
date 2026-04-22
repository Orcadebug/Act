using PredictiveDesktopLayer.Domain.Enums;
using PredictiveDesktopLayer.Domain.Models;

namespace PredictiveDesktopLayer.Domain.Actions;

public class ScrollAction : IAction
{
    public ActionType Type => ActionType.Scroll;
    public required string Target { get; init; }
    public required Region? TargetRegion { get; init; }
    public required string Direction { get; init; }
    public required int Amount { get; init; }
    public Func<int, int, int, CancellationToken, Task>? Executor { get; set; }

    public async Task ExecuteAsync(CancellationToken cancellationToken = default)
    {
        if (TargetRegion == null || Executor == null) return;
        var scrollAmount = Direction.ToLowerInvariant() == "up" ? Amount : -Amount;
        await Executor(TargetRegion.CenterX, TargetRegion.CenterY, scrollAmount, cancellationToken);
    }

    public IAction? CreateReverseAction()
    {
        return new ScrollAction
        {
            Target = Target,
            TargetRegion = TargetRegion,
            Direction = Direction.ToLowerInvariant() == "up" ? "down" : "up",
            Amount = Amount
        };
    }
}
