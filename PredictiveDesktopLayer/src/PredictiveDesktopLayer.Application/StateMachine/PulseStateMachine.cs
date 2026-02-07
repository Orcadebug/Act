using PredictiveDesktopLayer.Domain.Enums;
using PredictiveDesktopLayer.Domain.Models;
using Microsoft.Extensions.Logging;

namespace PredictiveDesktopLayer.Application.StateMachine;

public class PulseStateMachine
{
    private readonly ILogger<PulseStateMachine> _logger;
    private readonly object _lock = new();

    public PulseState CurrentState { get; private set; } = PulseState.Idle;
    public Suggestion? CurrentSuggestion { get; private set; }

    public event EventHandler<PulseStateChangedEventArgs>? StateChanged;

    public PulseStateMachine(ILogger<PulseStateMachine> logger)
    {
        _logger = logger;
    }

    public bool TryTransition(PulseState newState)
    {
        lock (_lock)
        {
            if (!IsValidTransition(CurrentState, newState))
            {
                _logger.LogWarning("Invalid state transition from {Current} to {New}", CurrentState, newState);
                return false;
            }

            var previousState = CurrentState;
            CurrentState = newState;

            _logger.LogDebug("State transition: {Previous} -> {New}", previousState, newState);
            StateChanged?.Invoke(this, new PulseStateChangedEventArgs(previousState, newState));

            return true;
        }
    }

    public void SetSuggestion(Suggestion? suggestion)
    {
        lock (_lock)
        {
            CurrentSuggestion = suggestion;
        }
    }

    public void Reset()
    {
        lock (_lock)
        {
            CurrentState = PulseState.Idle;
            CurrentSuggestion = null;
        }
    }

    private static bool IsValidTransition(PulseState from, PulseState to)
    {
        return (from, to) switch
        {
            (PulseState.Idle, PulseState.Capturing) => true,
            (PulseState.Capturing, PulseState.IntentDetected) => true,
            (PulseState.Capturing, PulseState.Idle) => true,
            (PulseState.IntentDetected, PulseState.ProcessingCloud) => true,
            (PulseState.IntentDetected, PulseState.Capturing) => true,
            (PulseState.ProcessingCloud, PulseState.AwaitingApproval) => true,
            (PulseState.ProcessingCloud, PulseState.Idle) => true,
            (PulseState.AwaitingApproval, PulseState.Executing) => true,
            (PulseState.AwaitingApproval, PulseState.Idle) => true,
            (PulseState.Executing, PulseState.Cooling) => true,
            (PulseState.Executing, PulseState.Idle) => true,
            (PulseState.Cooling, PulseState.Idle) => true,
            _ => false
        };
    }
}

public class PulseStateChangedEventArgs : EventArgs
{
    public PulseState PreviousState { get; }
    public PulseState NewState { get; }

    public PulseStateChangedEventArgs(PulseState previousState, PulseState newState)
    {
        PreviousState = previousState;
        NewState = newState;
    }
}
