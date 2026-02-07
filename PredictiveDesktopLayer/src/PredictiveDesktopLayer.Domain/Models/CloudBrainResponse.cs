using System.Text.Json.Serialization;

namespace PredictiveDesktopLayer.Domain.Models;

public class CloudBrainResponse
{
    [JsonPropertyName("confidence")]
    public double Confidence { get; init; }

    [JsonPropertyName("description")]
    public string Description { get; init; } = string.Empty;

    [JsonPropertyName("actions")]
    public List<CloudAction> Actions { get; init; } = new();

    // Server's actual format (different from expected)
    [JsonPropertyName("suggestion")]
    public string? Suggestion { get; init; }

    [JsonPropertyName("action")]
    public string? Action { get; init; }

    [JsonPropertyName("coordinates")]
    public CloudCoordinates? Coordinates { get; init; }
}

public class CloudCoordinates
{
    [JsonPropertyName("x")]
    public int X { get; init; }

    [JsonPropertyName("y")]
    public int Y { get; init; }
}

public class CloudAction
{
    [JsonPropertyName("type")]
    public string Type { get; init; } = string.Empty;

    [JsonPropertyName("target")]
    public string Target { get; init; } = string.Empty;

    [JsonPropertyName("region")]
    public CloudRegion? Region { get; init; }

    // Direct coordinates (new server format)
    [JsonPropertyName("x")]
    public int? X { get; init; }

    [JsonPropertyName("y")]
    public int? Y { get; init; }

    [JsonPropertyName("text")]
    public string? Text { get; init; }

    [JsonPropertyName("keys")]
    public string? Keys { get; init; }

    [JsonPropertyName("sourceRegion")]
    public CloudRegion? SourceRegion { get; init; }

    [JsonPropertyName("targetRegion")]
    public CloudRegion? TargetRegion { get; init; }

    [JsonPropertyName("direction")]
    public string? Direction { get; init; }

    [JsonPropertyName("amount")]
    public int? Amount { get; init; }
}

public class CloudRegion
{
    [JsonPropertyName("x")]
    public int X { get; init; }

    [JsonPropertyName("y")]
    public int Y { get; init; }

    [JsonPropertyName("width")]
    public int Width { get; init; }

    [JsonPropertyName("height")]
    public int Height { get; init; }
}
