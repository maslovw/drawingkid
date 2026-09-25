// Starts the Drawing Kid backend.

import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

import { createApp } from './app.js';
import { loadConfig } from './config.js';
import { createDeviceCheck } from './devicecheck.js';
import { createProvider } from './provider.js';
import { AppStoreVerifier } from './storekit.js';
import { Store } from './store.js';

const config = loadConfig();
if (!config.devMode && !config.adminToken) console.warn('ADMIN_TOKEN is not set: admin endpoints are disabled.');
mkdirSync(config.dataDir, { recursive: true });

const store = new Store(join(config.dataDir, 'drawingkid.sqlite'));
const app = createApp({
  config,
  store,
  provider: createProvider(config),
  appStore: new AppStoreVerifier({
    rootCertPath: config.appleRootCertPath,
    bundleId: config.bundleId,
    environments: config.appStoreEnvironments,
  }),
  deviceCheck: createDeviceCheck(config),
});

// Prompt text is kept only as long as retries need it.
const purge = () => {
  const { prompts, ideas } = store.purge(config);
  if (prompts || ideas) console.log(`purged ${prompts} prompts, ${ideas} ideas`);
};
purge();
setInterval(purge, 15 * 60_000).unref();

const server = app.server().listen(config.port, config.host, () => {
  console.log(`drawingkid-server on ${config.host}:${config.port} (provider ${config.provider}${config.devMode ? ', dev mode' : ''})`);
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    server.close(() => {
      store.close();
      process.exit(0);
    });
  });
}
