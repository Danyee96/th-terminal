import { createNasdaqProvider } from "./nasdaq.js";

/** Add new providers here, keyed by the DATA_PROVIDER value that selects them. */
const PROVIDERS = {
  nasdaq: () => createNasdaqProvider(),
};

export function createProvider(config, log) {
  const make = PROVIDERS[config.provider];
  if (!make) {
    log.warn(`Unknown DATA_PROVIDER "${config.provider}", using nasdaq. Options: ${Object.keys(PROVIDERS).join(", ")}`);
    return PROVIDERS.nasdaq(config);
  }
  return make(config);
}
