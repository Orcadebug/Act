using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using PredictiveDesktopLayer.Application.StateMachine;
using PredictiveDesktopLayer.Domain.Enums;
using PredictiveDesktopLayer.Domain.Interfaces;
using PredictiveDesktopLayer.Domain.Models;

namespace PredictiveDesktopLayer.Application.Services;

public class PulseLoopOptions
{
    public int FramesPerSecond { get; set; } = 3;
    public int BufferSeconds { get; set; } = 4;
    public int PauseThresholdMs { get; set; } = 1000;
    public double MinConfidence { get; set; } = 0.80;
    public int CoolingPeriodMs { get; set; } = 500;
}

public class PulseLoopService : BackgroundService
{
    private readonly ILogger<PulseLoopService> _logger;
    private readonly PulseStateMachine _stateMachine;
    private readonly IScreenCapture _screenCapture;
    private readonly IFrameBuffer _frameBuffer;
    private readonly IInactivityDetector _inactivityDetector;
    private readonly ICloudBrain _cloudBrain;
    private readonly IActionParser _actionParser;
    private readonly ActionExecutor _actionExecutor;
    private readonly PulseLoopOptions _options;

    public event EventHandler<Suggestion>? SuggestionReady;
    public event EventHandler? SuggestionDismissed;
    public event EventHandler<string>? ExecutionError;

    public PulseLoopService(
        ILogger<PulseLoopService> logger,
        PulseStateMachine stateMachine,
        IScreenCapture screenCapture,
        IFrameBuffer frameBuffer,
        IInactivityDetector inactivityDetector,
        ICloudBrain cloudBrain,
        IActionParser actionParser,
        ActionExecutor actionExecutor,
        IOptions<PulseLoopOptions> options)
    {
        _logger = logger;
        _stateMachine = stateMachine;
        _screenCapture = screenCapture;
        _frameBuffer = frameBuffer;
        _inactivityDetector = inactivityDetector;
        _cloudBrain = cloudBrain;
        _actionParser = actionParser;
        _actionExecutor = actionExecutor;
        _options = options.Value;
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        _logger.LogInformation("PulseLoopService starting");

        await _screenCapture.StartAsync(stoppingToken);

        var frameInterval = TimeSpan.FromMilliseconds(1000.0 / _options.FramesPerSecond);
        var pauseThreshold = TimeSpan.FromMilliseconds(_options.PauseThresholdMs);

        while (!stoppingToken.IsCancellationRequested)
        {
            try
            {
                await ProcessLoopIterationAsync(frameInterval, pauseThreshold, stoppingToken);
            }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
            {
                break;
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error in pulse loop iteration");
                await Task.Delay(1000, stoppingToken);
            }
        }

        await _screenCapture.StopAsync(stoppingToken);
        _logger.LogInformation("PulseLoopService stopped");
    }

    private async Task ProcessLoopIterationAsync(TimeSpan frameInterval, TimeSpan pauseThreshold, CancellationToken stoppingToken)
    {
        switch (_stateMachine.CurrentState)
        {
            case PulseState.Idle:
                _stateMachine.TryTransition(PulseState.Capturing);
                break;

            case PulseState.Capturing:
                await CaptureFrameAsync(stoppingToken);
                if (_inactivityDetector.IsInactive(pauseThreshold))
                {
                    _stateMachine.TryTransition(PulseState.IntentDetected);
                }
                break;

            case PulseState.IntentDetected:
                _stateMachine.TryTransition(PulseState.ProcessingCloud);
                await ProcessCloudAsync(stoppingToken);
                break;

            case PulseState.ProcessingCloud:
                break;

            case PulseState.AwaitingApproval:
                break;

            case PulseState.Executing:
                break;

            case PulseState.Cooling:
                await Task.Delay(_options.CoolingPeriodMs, stoppingToken);
                _stateMachine.TryTransition(PulseState.Idle);
                break;
        }

        await Task.Delay(frameInterval, stoppingToken);
    }

    private async Task CaptureFrameAsync(CancellationToken stoppingToken)
    {
        var frame = await _screenCapture.CaptureAsync(stoppingToken);
        if (frame != null)
        {
            _frameBuffer.Add(frame);
        }
    }

    private async Task ProcessCloudAsync(CancellationToken stoppingToken)
    {
        var frames = _frameBuffer.GetRecentFrames(_options.FramesPerSecond * _options.BufferSeconds);
        if (frames.Count == 0)
        {
            _stateMachine.TryTransition(PulseState.Idle);
            return;
        }

        var cursorPos = _inactivityDetector.GetCursorPosition();
        var latestFrame = frames[^1];

        var context = new CaptureContext
        {
            MonitorWidth = latestFrame.Width,
            MonitorHeight = latestFrame.Height,
            CursorX = cursorPos.X,
            CursorY = cursorPos.Y
        };

        var response = await _cloudBrain.PredictAsync(frames, context, stoppingToken);

        if (response == null || response.Confidence < _options.MinConfidence)
        {
            _logger.LogDebug("Low confidence or no response, returning to idle");
            _stateMachine.TryTransition(PulseState.Idle);
            return;
        }

        var actionSequence = _actionParser.Parse(response);
        var suggestion = new Suggestion
        {
            Id = Guid.NewGuid().ToString(),
            Description = response.Description,
            Confidence = response.Confidence,
            Actions = actionSequence
        };

        _stateMachine.SetSuggestion(suggestion);
        _stateMachine.TryTransition(PulseState.AwaitingApproval);
        SuggestionReady?.Invoke(this, suggestion);
    }

    public async Task ApproveSuggestionAsync(CancellationToken stoppingToken = default)
    {
        if (_stateMachine.CurrentState != PulseState.AwaitingApproval)
        {
            _logger.LogWarning("Cannot approve: not in AwaitingApproval state");
            return;
        }

        var suggestion = _stateMachine.CurrentSuggestion;
        if (suggestion == null)
        {
            _logger.LogWarning("Cannot approve: no current suggestion");
            _stateMachine.TryTransition(PulseState.Idle);
            return;
        }

        _stateMachine.TryTransition(PulseState.Executing);

        try
        {
            await _actionExecutor.ExecuteAsync(suggestion.Actions, stoppingToken);
            suggestion.State = SuggestionState.Executed;
            _stateMachine.TryTransition(PulseState.Cooling);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error executing action sequence");
            suggestion.State = SuggestionState.Failed;
            ExecutionError?.Invoke(this, ex.Message);
            _stateMachine.TryTransition(PulseState.Idle);
        }
    }

    public void DismissSuggestion()
    {
        if (_stateMachine.CurrentState != PulseState.AwaitingApproval)
        {
            return;
        }

        var suggestion = _stateMachine.CurrentSuggestion;
        if (suggestion != null)
        {
            suggestion.State = SuggestionState.Dismissed;
        }

        _stateMachine.SetSuggestion(null);
        _stateMachine.TryTransition(PulseState.Idle);
        SuggestionDismissed?.Invoke(this, EventArgs.Empty);
    }
}
