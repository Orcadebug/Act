using System.Drawing;
using System.Windows;
using Hardcodet.Wpf.TaskbarNotification;
using Microsoft.Extensions.Logging;

namespace PredictiveDesktopLayer.UI.Services;

public class TrayIconService : IDisposable
{
    private readonly ILogger<TrayIconService> _logger;
    private TaskbarIcon? _trayIcon;
    private bool _disposed;

    public event EventHandler? ExitRequested;

    public TrayIconService(ILogger<TrayIconService> logger)
    {
        _logger = logger;
    }

    public void Initialize()
    {
        System.Windows.Application.Current.Dispatcher.Invoke(() =>
        {
            _trayIcon = new TaskbarIcon
            {
                ToolTipText = "Predictive Desktop Layer",
                Icon = CreateDefaultIcon(),
                ContextMenu = CreateContextMenu()
            };
        });

        _logger.LogInformation("Tray icon initialized");
    }

    private System.Windows.Controls.ContextMenu CreateContextMenu()
    {
        var menu = new System.Windows.Controls.ContextMenu();

        var exitItem = new System.Windows.Controls.MenuItem { Header = "Exit" };
        exitItem.Click += (s, e) => ExitRequested?.Invoke(this, EventArgs.Empty);

        menu.Items.Add(exitItem);

        return menu;
    }

    private static Icon CreateDefaultIcon()
    {
        var bitmap = new Bitmap(16, 16);
        using (var g = Graphics.FromImage(bitmap))
        {
            g.Clear(Color.Transparent);
            g.FillEllipse(Brushes.DodgerBlue, 2, 2, 12, 12);
        }
        var hIcon = bitmap.GetHicon();
        return Icon.FromHandle(hIcon);
    }

    public void ShowNotification(string title, string message)
    {
        _trayIcon?.ShowBalloonTip(title, message, BalloonIcon.Info);
    }

    public void Dispose()
    {
        if (_disposed) return;
        _disposed = true;
        _trayIcon?.Dispose();
        GC.SuppressFinalize(this);
    }
}
