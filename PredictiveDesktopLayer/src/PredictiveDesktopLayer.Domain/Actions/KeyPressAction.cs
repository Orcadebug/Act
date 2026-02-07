using PredictiveDesktopLayer.Domain.Enums;
using PredictiveDesktopLayer.Domain.Models;

namespace PredictiveDesktopLayer.Domain.Actions;

public class KeyPressAction : IAction
{
    public ActionType Type => ActionType.KeyPress;
    public required string Target { get; init; }
    public Region? TargetRegion { get; init; }
    public required string Keys { get; init; }
    public Func<string, CancellationToken, Task>? Executor { get; set; }

    public async Task ExecuteAsync(CancellationToken cancellationToken = default)
    {
        if (Executor == null) return;
        await Executor(Keys, cancellationToken);
    }

    public IAction? CreateReverseAction() => null;
}
