namespace PredictiveDesktopLayer.Domain.Enums;

public enum PulseState
{
    Idle,
    Capturing,
    IntentDetected,
    ProcessingCloud,
    AwaitingApproval,
    Executing,
    Cooling
}
