using H.Hooks;
using Microsoft.Extensions.Logging;

namespace PredictiveDesktopLayer.UI.Services;

public class AltKeyService : IDisposable
{
    private readonly ILogger<AltKeyService> _logger;
    private readonly LowLevelKeyboardHook _hook;
    private DateTime _lastAltPress = DateTime.MinValue;
    private bool _disposed;

    private const int DoubleTapThresholdMs = 400;

    public event EventHandler? SingleAltTap;
    public event EventHandler? DoubleAltTap;

    public AltKeyService(ILogger<AltKeyService> logger)
    {
        _logger = logger;
        _hook = new LowLevelKeyboardHook();
        _hook.Up += OnKeyUp;
    }

    public void Start()
    {
        _hook.Start();
        _logger.LogInformation("Alt key service started");
    }

    public void Stop()
    {
        _hook.Stop();
        _logger.LogInformation("Alt key service stopped");
    }

    private void OnKeyUp(object? sender, KeyboardEventArgs e)
    {
        // H.Hooks Keys wraps key info - compare using Equals for struct or check the value
        // The Keys struct has implicit conversion or use raw comparison
        var keys = e.Keys;
        
        // Check using keyboard event data - Alt key detection
        // LMenu = Left Alt (0xA4), RMenu = Right Alt (0xA5), Menu = 0x12
        bool isAlt = keys.Values.Any(k => 
            k == Key.LeftAlt || k == Key.RightAlt || k == Key.Alt);
        
        if (!isAlt)
        {
            return;
        }

        var now = DateTime.UtcNow;
        var timeSinceLastPress = now - _lastAltPress;

        if (timeSinceLastPress.TotalMilliseconds < DoubleTapThresholdMs)
        {
            _logger.LogDebug("Double Alt tap detected");
            _lastAltPress = DateTime.MinValue;
            DoubleAltTap?.Invoke(this, EventArgs.Empty);
        }
        else
        {
            _lastAltPress = now;

            Task.Delay(DoubleTapThresholdMs + 50).ContinueWith(_ =>
            {
                if (_lastAltPress != DateTime.MinValue &&
                    (DateTime.UtcNow - _lastAltPress).TotalMilliseconds >= DoubleTapThresholdMs)
                {
                    _logger.LogDebug("Single Alt tap detected");
                    _lastAltPress = DateTime.MinValue;
                    SingleAltTap?.Invoke(this, EventArgs.Empty);
                }
            });
        }
    }

    public void Dispose()
    {
        if (_disposed) return;
        _disposed = true;
        _hook.Dispose();
        GC.SuppressFinalize(this);
    }
}
