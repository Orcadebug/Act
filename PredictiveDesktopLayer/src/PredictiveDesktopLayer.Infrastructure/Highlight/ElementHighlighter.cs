using System.Windows;
using System.Windows.Controls;
using System.Windows.Media;
using System.Windows.Media.Animation;
using System.Windows.Shapes;
using Microsoft.Extensions.Logging;
using PredictiveDesktopLayer.Domain.Interfaces;
using PredictiveDesktopLayer.Domain.Models;

namespace PredictiveDesktopLayer.Infrastructure.Highlight;

public class ElementHighlighter : IElementHighlighter
{
    private readonly ILogger<ElementHighlighter> _logger;
    private Window? _highlightWindow;
    private CancellationTokenSource? _animationCts;

    public bool IsVisible => _highlightWindow?.IsVisible ?? false;

    public ElementHighlighter(ILogger<ElementHighlighter> logger)
    {
        _logger = logger;
    }

    public async Task ShowHighlightAsync(Region region, CancellationToken cancellationToken = default)
    {
        await HideHighlightAsync();

        _animationCts = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);

        await System.Windows.Application.Current.Dispatcher.InvokeAsync(() =>
        {
            _highlightWindow = new Window
            {
                WindowStyle = WindowStyle.None,
                AllowsTransparency = true,
                Background = Brushes.Transparent,
                Topmost = true,
                ShowInTaskbar = false,
                Left = region.X - 4,
                Top = region.Y - 4,
                Width = region.Width + 8,
                Height = region.Height + 8,
                IsHitTestVisible = false
            };

            var border = new Border
            {
                BorderBrush = new SolidColorBrush(Color.FromArgb(128, 0, 120, 212)),
                BorderThickness = new Thickness(3),
                CornerRadius = new CornerRadius(4),
                Background = new SolidColorBrush(Color.FromArgb(30, 0, 120, 212))
            };

            _highlightWindow.Content = border;
            _highlightWindow.Show();

            StartPulseAnimation(border);
        });

        _logger.LogDebug("Showing highlight at ({X}, {Y}) size ({W}x{H})",
            region.X, region.Y, region.Width, region.Height);
    }

    private void StartPulseAnimation(Border border)
    {
        var animation = new DoubleAnimation
        {
            From = 0.3,
            To = 0.7,
            Duration = TimeSpan.FromMilliseconds(500),
            AutoReverse = true,
            RepeatBehavior = RepeatBehavior.Forever
        };

        border.BeginAnimation(UIElement.OpacityProperty, animation);
    }

    public async Task HideHighlightAsync()
    {
        _animationCts?.Cancel();
        _animationCts = null;

        if (_highlightWindow != null)
        {
            await System.Windows.Application.Current.Dispatcher.InvokeAsync(() =>
            {
                _highlightWindow.Close();
                _highlightWindow = null;
            });

            _logger.LogDebug("Highlight hidden");
        }
    }
}
