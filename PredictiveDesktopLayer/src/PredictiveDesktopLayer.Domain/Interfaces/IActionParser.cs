using PredictiveDesktopLayer.Domain.Models;

namespace PredictiveDesktopLayer.Domain.Interfaces;

public interface IActionParser
{
    ActionSequence Parse(CloudBrainResponse response);
}
