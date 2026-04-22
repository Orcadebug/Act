using System.IO;
using LiteDB;
using Microsoft.Extensions.Logging;
using PredictiveDesktopLayer.Domain.Enums;
using PredictiveDesktopLayer.Domain.Interfaces;
using PredictiveDesktopLayer.Domain.Models;

namespace PredictiveDesktopLayer.Infrastructure.Persistence;

public class FeedbackStore : IFeedbackStore, IDisposable
{
    private readonly ILogger<FeedbackStore> _logger;
    private readonly LiteDatabase _database;
    private readonly ILiteCollection<SuggestionRecord> _suggestions;
    private bool _disposed;

    public FeedbackStore(ILogger<FeedbackStore> logger)
    {
        _logger = logger;

        var dbPath = Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
            "PredictiveDesktopLayer",
            "feedback.db");

        Directory.CreateDirectory(Path.GetDirectoryName(dbPath)!);

        _database = new LiteDatabase(dbPath);
        _suggestions = _database.GetCollection<SuggestionRecord>("suggestions");
        _suggestions.EnsureIndex(x => x.CreatedAt);
    }

    public Task SaveSuggestionAsync(Suggestion suggestion, CancellationToken cancellationToken = default)
    {
        var record = new SuggestionRecord
        {
            Id = suggestion.Id,
            Description = suggestion.Description,
            Confidence = suggestion.Confidence,
            State = suggestion.State.ToString(),
            CreatedAt = suggestion.CreatedAt,
            ActionCount = suggestion.Actions.Actions.Count
        };

        _suggestions.Insert(record);
        _logger.LogDebug("Saved suggestion {Id} with state {State}", record.Id, record.State);

        return Task.CompletedTask;
    }

    public Task<IReadOnlyList<Suggestion>> GetRecentSuggestionsAsync(int count, CancellationToken cancellationToken = default)
    {
        var records = _suggestions
            .Query()
            .OrderByDescending(x => x.CreatedAt)
            .Limit(count)
            .ToList();

        var suggestions = records.Select(r => new Suggestion
        {
            Id = r.Id,
            Description = r.Description,
            Confidence = r.Confidence,
            State = Enum.Parse<SuggestionState>(r.State),
            CreatedAt = r.CreatedAt,
            Actions = new ActionSequence()
        }).ToList();

        return Task.FromResult<IReadOnlyList<Suggestion>>(suggestions);
    }

    public Task UpdateSuggestionStateAsync(string suggestionId, SuggestionState state, CancellationToken cancellationToken = default)
    {
        var record = _suggestions.FindById(suggestionId);
        if (record != null)
        {
            record.State = state.ToString();
            _suggestions.Update(record);
            _logger.LogDebug("Updated suggestion {Id} to state {State}", suggestionId, state);
        }

        return Task.CompletedTask;
    }

    public void Dispose()
    {
        if (_disposed) return;
        _disposed = true;
        _database.Dispose();
        GC.SuppressFinalize(this);
    }

    private class SuggestionRecord
    {
        public string Id { get; set; } = string.Empty;
        public string Description { get; set; } = string.Empty;
        public double Confidence { get; set; }
        public string State { get; set; } = string.Empty;
        public DateTime CreatedAt { get; set; }
        public int ActionCount { get; set; }
    }
}
