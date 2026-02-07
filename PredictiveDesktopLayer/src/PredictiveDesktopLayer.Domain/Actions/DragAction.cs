using PredictiveDesktopLayer.Domain.Enums;
using PredictiveDesktopLayer.Domain.Models;

namespace PredictiveDesktopLayer.Domain.Actions;

public class DragAction : IAction
{
    public ActionType Type => ActionType.Drag;
    public required string Target { get; init; }
    public Region? TargetRegion { get; init; }
    public required Region SourceRegion { get; init; }
    public required Region DestinationRegion { get; init; }
    public Func<int, int, int, int, CancellationToken, Task>? Executor { get; set; }

    public async Task ExecuteAsync(CancellationToken cancellationToken = default)
    {
        if (Executor == null) return;
        await Executor(
            SourceRegion.CenterX, SourceRegion.CenterY,
            DestinationRegion.CenterX, DestinationRegion.CenterY,
            cancellationToken);
    }

    public IAction? CreateReverseAction()
    {
        return new DragAction
        {
            Target = Target,
            SourceRegion = DestinationRegion,
            DestinationRegion = SourceRegion
        };
    }
}
