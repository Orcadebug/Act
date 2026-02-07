using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using PredictiveDesktopLayer.Domain.Models;

namespace PredictiveDesktopLayer.UI.ViewModels;

public partial class SuggestionViewModel : ObservableObject
{
    [ObservableProperty]
    private string _description = string.Empty;

    [ObservableProperty]
    private double _confidence;

    [ObservableProperty]
    private bool _isVisible;

    [ObservableProperty]
    private Suggestion? _currentSuggestion;

    public event EventHandler? ApproveRequested;
    public event EventHandler? DismissRequested;

    public void ShowSuggestion(Suggestion suggestion)
    {
        CurrentSuggestion = suggestion;
        Description = suggestion.Description;
        Confidence = suggestion.Confidence;
        IsVisible = true;
    }

    public void Hide()
    {
        IsVisible = false;
        CurrentSuggestion = null;
    }

    [RelayCommand]
    private void Approve()
    {
        ApproveRequested?.Invoke(this, EventArgs.Empty);
    }

    [RelayCommand]
    private void Dismiss()
    {
        DismissRequested?.Invoke(this, EventArgs.Empty);
    }
}
