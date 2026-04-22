using PredictiveDesktopLayer.Domain.Enums;
using PredictiveDesktopLayer.Domain.Models;

namespace PredictiveDesktopLayer.Domain.Actions;

public class TypeAction : IAction
{
    public ActionType Type => ActionType.Type;
    public required string Target { get; init; }
    public Region? TargetRegion { get; init; }
    public required string Text { get; init; }
    public Func<string, CancellationToken, Task>? Executor { get; set; }

    public async Task ExecuteAsync(CancellationToken cancellationToken = default)
    {
        if (Executor == null) return;
        await Executor(Text, cancellationToken);
    }

    public IAction? CreateReverseAction()
    {
        return new KeyPressAction
        {
            Target = Target,
            Keys = string.Join("+", Enumerable.Repeat("backspace", Text.Length).Take(10))
        };
    }
}
