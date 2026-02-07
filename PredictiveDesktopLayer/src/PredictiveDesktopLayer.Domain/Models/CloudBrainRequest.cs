using System.Text.Json.Serialization;

namespace PredictiveDesktopLayer.Domain.Models;

public class CloudBrainRequest
{
    [JsonPropertyName("frames")]
    public required List<string> Frames { get; init; }

    [JsonPropertyName("timestamp")]
    public required DateTime Timestamp { get; init; }

    [JsonPropertyName("context")]
    public required CaptureContext Context { get; init; }
}
