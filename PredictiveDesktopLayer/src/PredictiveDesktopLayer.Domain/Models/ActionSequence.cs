using PredictiveDesktopLayer.Domain.Actions;

namespace PredictiveDesktopLayer.Domain.Models;

public class ActionSequence
{
    private readonly List<IAction> _actions = new();

    public IReadOnlyList<IAction> Actions => _actions.AsReadOnly();

    public void Add(IAction action) => _actions.Add(action);

    public void Clear() => _actions.Clear();
}
