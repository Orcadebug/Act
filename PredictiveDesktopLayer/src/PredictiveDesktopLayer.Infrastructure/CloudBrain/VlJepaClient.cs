using System.Net.Http;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using PredictiveDesktopLayer.Domain.Interfaces;
using PredictiveDesktopLayer.Domain.Models;

namespace PredictiveDesktopLayer.Infrastructure.CloudBrain;

public class CloudBrainOptions
{
    public string PredictionEndpoint { get; set; } = string.Empty;
    public string ApiKey { get; set; } = string.Empty;
    public int TimeoutMs { get; set; } = 500;
    public double MinConfidence { get; set; } = 0.80;
}

public class VlJepaClient : ICloudBrain
{
    private readonly ILogger<VlJepaClient> _logger;
    private readonly HttpClient _httpClient;
    private readonly CloudBrainOptions _options;

    public VlJepaClient(
        ILogger<VlJepaClient> logger,
        HttpClient httpClient,
        IOptions<CloudBrainOptions> options)
    {
        _logger = logger;
        _httpClient = httpClient;
        _options = options.Value;

        _httpClient.Timeout = TimeSpan.FromMilliseconds(_options.TimeoutMs);

        if (!string.IsNullOrEmpty(_options.ApiKey))
        {
            _httpClient.DefaultRequestHeaders.Add("X-API-Key", _options.ApiKey);
        }
    }

    public async Task<CloudBrainResponse?> PredictAsync(
        IReadOnlyList<CapturedFrame> frames,
        CaptureContext context,
        CancellationToken cancellationToken = default)
    {
        if (string.IsNullOrEmpty(_options.PredictionEndpoint))
        {
            _logger.LogWarning("Prediction endpoint not configured");
            return null;
        }

        try
        {
            var request = new CloudBrainRequest
            {
                Frames = frames.Select(f => Convert.ToBase64String(f.ImageData)).ToList(),
                Timestamp = DateTime.UtcNow,
                Context = context
            };

            _logger.LogDebug("Sending prediction request with {Count} frames", frames.Count);

            var response = await _httpClient.PostAsJsonAsync(
                _options.PredictionEndpoint,
                request,
                cancellationToken);

            if (!response.IsSuccessStatusCode)
            {
                _logger.LogWarning("Prediction request failed with status {Status}", response.StatusCode);
                return null;
            }

            var result = await response.Content.ReadFromJsonAsync<CloudBrainResponse>(cancellationToken: cancellationToken);

            if (result != null)
            {
                _logger.LogDebug("Received prediction with confidence {Confidence}", result.Confidence);
            }

            return result;
        }
        catch (TaskCanceledException)
        {
            _logger.LogDebug("Prediction request timed out");
            return null;
        }
        catch (HttpRequestException ex)
        {
            _logger.LogWarning(ex, "HTTP error during prediction request");
            return null;
        }
        catch (JsonException ex)
        {
            _logger.LogWarning(ex, "Failed to parse prediction response");
            return null;
        }
    }
}
