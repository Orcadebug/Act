using System.Windows;
using PredictiveDesktopLayer.UI.ViewModels;

namespace PredictiveDesktopLayer.UI.Windows;

public partial class SuggestionOverlay : Window
{
    public SuggestionOverlay()
    {
        InitializeComponent();
        Loaded += OnLoaded;
    }

    public SuggestionOverlay(SuggestionViewModel viewModel) : this()
    {
        DataContext = viewModel;
        viewModel.PropertyChanged += (s, e) =>
        {
            if (e.PropertyName == nameof(SuggestionViewModel.IsVisible))
            {
                if (viewModel.IsVisible)
                {
                    Show();
                    PositionBottomRight();
                }
                else
                {
                    Hide();
                }
            }
        };
    }

    private void OnLoaded(object sender, RoutedEventArgs e)
    {
        PositionBottomRight();
    }

    private void PositionBottomRight()
    {
        var workArea = SystemParameters.WorkArea;
        Left = workArea.Right - ActualWidth - 20;
        Top = workArea.Bottom - ActualHeight - 20;
    }
}
