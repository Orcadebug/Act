using PredictiveDesktopLayer.Domain.Enums;
using PredictiveDesktopLayer.Domain.Models;

namespace PredictiveDesktopLayer.Domain.Actions;

public interface IAction
{
    ActionType Type { get; }
    string Target { get; }
    Region? TargetRegion { get; }
    Task ExecuteAsync(CancellationToken cancellationToken = default);
    IAction? CreateReverseAction();
}
