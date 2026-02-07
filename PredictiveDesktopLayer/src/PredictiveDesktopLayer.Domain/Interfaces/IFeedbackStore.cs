using PredictiveDesktopLayer.Domain.Models;

namespace PredictiveDesktopLayer.Domain.Interfaces;

public interface IFeedbackStore
{
    Task SaveSuggestionAsync(Suggestion suggestion, CancellationToken cancellationToken = default);
    Task<IReadOnlyList<Suggestion>> GetRecentSuggestionsAsync(int count, CancellationToken cancellationToken = default);
    Task UpdateSuggestionStateAsync(string suggestionId, Enums.SuggestionState state, CancellationToken cancellationToken = default);
}
