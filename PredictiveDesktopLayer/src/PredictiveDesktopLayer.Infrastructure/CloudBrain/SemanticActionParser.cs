using Microsoft.Extensions.Logging;
using PredictiveDesktopLayer.Domain.Actions;
using PredictiveDesktopLayer.Domain.Interfaces;
using PredictiveDesktopLayer.Domain.Models;

namespace PredictiveDesktopLayer.Infrastructure.CloudBrain;

public class SemanticActionParser : IActionParser
{
    private readonly ILogger<SemanticActionParser> _logger;

    public SemanticActionParser(ILogger<SemanticActionParser> logger)
    {
        _logger = logger;
    }

    public ActionSequence Parse(CloudBrainResponse response)
    {
        var sequence = new ActionSequence();

        // Handle server's actual format: single action + coordinates
        if (!string.IsNullOrEmpty(response.Action) && response.Coordinates != null)
        {
            var action = ParseServerAction(response.Action, response.Coordinates, response.Suggestion);
            if (action != null)
            {
                sequence.Add(action);
            }
        }
        // Fallback to expected format: actions array
        else
        {
            foreach (var cloudAction in response.Actions)
            {
                var action = ParseAction(cloudAction);
                if (action != null)
                {
                    sequence.Add(action);
                }
            }
        }

        _logger.LogDebug("Parsed {Count} actions from cloud response", sequence.Actions.Count);
        return sequence;
    }

    private IAction? ParseServerAction(string actionType, CloudCoordinates coords, string? suggestion)
    {
        var region = new Region(coords.X - 25, coords.Y - 15, 50, 30);
        var target = suggestion ?? "UI element";

        return actionType.ToUpperInvariant() switch
        {
            "CLICK" => new ClickAction { Target = target, TargetRegion = region },
            "RIGHT_CLICK" => new RightClickAction { Target = target, TargetRegion = region },
            "DOUBLE_CLICK" => new DoubleClickAction { Target = target, TargetRegion = region },
            "TYPE" => new TypeAction { Target = target, TargetRegion = region, Text = "" },
            "SCROLL_UP" => new ScrollAction { Target = target, TargetRegion = region, Direction = "up", Amount = 3 },
            "SCROLL_DOWN" => new ScrollAction { Target = target, TargetRegion = region, Direction = "down", Amount = 3 },
            _ => new ClickAction { Target = target, TargetRegion = region } // Default to click
        };
    }

    private IAction? ParseAction(CloudAction cloudAction)
    {
        // Handle direct x,y coordinates (new server format)
        Region? region = null;
        if (cloudAction.X.HasValue && cloudAction.Y.HasValue)
        {
            region = new Region(cloudAction.X.Value - 25, cloudAction.Y.Value - 15, 50, 30);
        }
        else if (cloudAction.Region != null)
        {
            region = new Region(
                cloudAction.Region.X,
                cloudAction.Region.Y,
                cloudAction.Region.Width,
                cloudAction.Region.Height);
        }

        return cloudAction.Type.ToLowerInvariant() switch
        {
            "click" => new ClickAction
            {
                Target = cloudAction.Target,
                TargetRegion = region
            },
            "right_click" => new RightClickAction
            {
                Target = cloudAction.Target,
                TargetRegion = region
            },
            "double_click" => new DoubleClickAction
            {
                Target = cloudAction.Target,
                TargetRegion = region
            },
            "type" => new TypeAction
            {
                Target = cloudAction.Target,
                TargetRegion = region,
                Text = cloudAction.Text ?? string.Empty
            },
            "key" => new KeyPressAction
            {
                Target = cloudAction.Target,
                TargetRegion = region,
                Keys = cloudAction.Keys ?? string.Empty
            },
            "drag" => ParseDragAction(cloudAction),
            "scroll" => new ScrollAction
            {
                Target = cloudAction.Target,
                TargetRegion = region,
                Direction = cloudAction.Direction ?? "down",
                Amount = cloudAction.Amount ?? 3
            },
            _ => LogUnknownAction(cloudAction.Type)
        };
    }

    private DragAction? ParseDragAction(CloudAction cloudAction)
    {
        if (cloudAction.SourceRegion == null || cloudAction.TargetRegion == null)
        {
            _logger.LogWarning("Drag action missing source or target region");
            return null;
        }

        return new DragAction
        {
            Target = cloudAction.Target,
            SourceRegion = new Region(
                cloudAction.SourceRegion.X,
                cloudAction.SourceRegion.Y,
                cloudAction.SourceRegion.Width,
                cloudAction.SourceRegion.Height),
            DestinationRegion = new Region(
                cloudAction.TargetRegion.X,
                cloudAction.TargetRegion.Y,
                cloudAction.TargetRegion.Width,
                cloudAction.TargetRegion.Height)
        };
    }

    private IAction? LogUnknownAction(string type)
    {
        _logger.LogWarning("Unknown action type: {Type}", type);
        return null;
    }
}
