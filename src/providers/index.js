import { createNasdaqProvider } from "./nasdaq.js";
import { createSimulatedProvider } from "./simulated.js";

/** Add new providers here, keyed by the DATA_PROVIDER value that selects them. */
const PROVIDERS = {
  nasdaq: () => createNasdaqProvider(),
  simulated: () => createSimulatedProvider(),
};

export function createProvider(config, log) {
  const make = PROVIDERS[config.provider];
  if (!make) {
    log.warn(`Unknown DATA_PROVIDER "${config.provider}", using nasdaq. Options: ${Object.keys(PROVIDERS).join(", ")}`);
    return PROVIDERS.nasdaq(config);
  }
  return make(config);
}
