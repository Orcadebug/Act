using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using PredictiveDesktopLayer.Domain.Actions;
using PredictiveDesktopLayer.Domain.Interfaces;
using PredictiveDesktopLayer.Domain.Models;

namespace PredictiveDesktopLayer.Application.Services;

public class ActionExecutorOptions
{
    public int MinDelayMs { get; set; } = 100;
    public int MaxDelayMs { get; set; } = 300;
}

public class ActionExecutor
{
    private readonly ILogger<ActionExecutor> _logger;
    private readonly IInputSimulator _inputSimulator;
    private readonly ActionExecutorOptions _options;
    private readonly Random _random = new();

    private UndoAction? _lastUndoAction;

    public ActionExecutor(
        ILogger<ActionExecutor> logger,
        IInputSimulator inputSimulator,
        IOptions<ActionExecutorOptions> options)
    {
        _logger = logger;
        _inputSimulator = inputSimulator;
        _options = options.Value;
    }

    public async Task ExecuteAsync(ActionSequence sequence, CancellationToken cancellationToken = default)
    {
        _logger.LogInformation("Executing action sequence with {Count} actions", sequence.Actions.Count);

        IAction? lastAction = null;

        foreach (var action in sequence.Actions)
        {
            cancellationToken.ThrowIfCancellationRequested();

            BindExecutor(action);

            _logger.LogDebug("Executing action: {Type} on {Target}", action.Type, action.Target);
            await action.ExecuteAsync(cancellationToken);

            lastAction = action;

            await DelayHumanLikeAsync(cancellationToken);
        }

        if (lastAction != null)
        {
            _lastUndoAction = new UndoAction
            {
                OriginalAction = lastAction,
                ReverseAction = lastAction.CreateReverseAction()
            };
        }
    }

    public async Task UndoLastActionAsync(CancellationToken cancellationToken = default)
    {
        if (_lastUndoAction?.ReverseAction == null)
        {
            _logger.LogWarning("No action to undo or action is not reversible");
            return;
        }

        _logger.LogInformation("Undoing last action");
        BindExecutor(_lastUndoAction.ReverseAction);
        await _lastUndoAction.ReverseAction.ExecuteAsync(cancellationToken);
        _lastUndoAction = null;
    }

    private void BindExecutor(IAction action)
    {
        switch (action)
        {
            case ClickAction click:
                click.Executor = _inputSimulator.ClickAsync;
                break;
            case RightClickAction rightClick:
                rightClick.Executor = _inputSimulator.RightClickAsync;
                break;
            case DoubleClickAction doubleClick:
                doubleClick.Executor = _inputSimulator.DoubleClickAsync;
                break;
            case TypeAction type:
                type.Executor = _inputSimulator.TypeTextAsync;
                break;
            case KeyPressAction keyPress:
                keyPress.Executor = _inputSimulator.PressKeysAsync;
                break;
            case DragAction drag:
                drag.Executor = _inputSimulator.DragAsync;
                break;
            case ScrollAction scroll:
                scroll.Executor = _inputSimulator.ScrollAsync;
                break;
        }
    }

    private async Task DelayHumanLikeAsync(CancellationToken cancellationToken)
    {
        var delay = _random.Next(_options.MinDelayMs, _options.MaxDelayMs + 1);
        await Task.Delay(delay, cancellationToken);
    }
}
