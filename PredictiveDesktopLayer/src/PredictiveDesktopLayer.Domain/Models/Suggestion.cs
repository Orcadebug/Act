using PredictiveDesktopLayer.Domain.Enums;

namespace PredictiveDesktopLayer.Domain.Models;

public class Suggestion
{
    public required string Id { get; init; }
    public required string Description { get; init; }
    public required double Confidence { get; init; }
    public required ActionSequence Actions { get; init; }
    public SuggestionState State { get; set; } = SuggestionState.Pending;
    public DateTime CreatedAt { get; init; } = DateTime.UtcNow;
}
