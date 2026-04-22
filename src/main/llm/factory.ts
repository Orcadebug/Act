import { PulseSettings } from '../../shared/types';
import { IntentProvider, ActionProvider } from './types';
import { TinkerIntentProvider } from './tinker';
import { PerplexityActionProvider } from './perplexity';

export function buildProviders(settings: PulseSettings): { intent: IntentProvider; action: ActionProvider } {
  const intent = new TinkerIntentProvider(settings.tinkerApiKey, settings.tinkerModel, settings.tinkerEndpoint);
  const action = new PerplexityActionProvider(settings.perplexityApiKey, settings.perplexityModel);
  return { intent, action };
}
