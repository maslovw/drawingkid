// Settings from environment variables. Every value has a default that works for local
// development with the mock image provider; production sets the rest in .env.

import { readFileSync } from 'node:fs';

const int = (value, fallback) => (value === undefined || value === '' ? fallback : Number.parseInt(value, 10));
const num = (value, fallback) => (value === undefined || value === '' ? fallback : Number.parseFloat(value));
const list = (value) => (value ? value.split(',').map((s) => s.trim()).filter(Boolean) : []);
const flag = (value) => value === '1' || value === 'true';

export function loadConfig(env = process.env) {
  const devMode = flag(env.DEV_MODE);
  return {
    host: env.HOST ?? '127.0.0.1',
    port: int(env.PORT, 8787),
    dataDir: env.DATA_DIR ?? './data',
    devMode,
    adminToken: env.ADMIN_TOKEN ?? '',

    // Image generation. `mock` draws a placeholder locally and costs nothing.
    provider: env.PROVIDER ?? 'openai',
    openaiApiKey: env.OPENAI_API_KEY ?? '',
    imageModel: env.IMAGE_MODEL ?? 'gpt-image-2.5-flare',
    imageQuality: env.IMAGE_QUALITY ?? 'low',
    imageSize: env.IMAGE_SIZE ?? '1024x1024',
    moderateImages: env.MODERATE_IMAGES !== '0',

    // One star = one idea: the first page plus up to `retriesPerStar` more.
    retriesPerStar: int(env.RETRIES_PER_STAR, 4),
    // Spending: generation stops for the day once estimated spend reaches the cap.
    dailyCapUsd: num(env.DAILY_CAP_USD, 20),
    worstImageUsd: num(env.WORST_IMAGE_USD, 0.03),
    imagesPerHourPerAccount: int(env.IMAGES_PER_HOUR, 30),
    alertWebhookUrl: env.ALERT_WEBHOOK_URL ?? '',
    // Prompt text is deleted after this many hours; idea rows after `ideaRetentionDays`.
    promptRetentionHours: num(env.PROMPT_RETENTION_HOURS, 24),
    ideaRetentionDays: num(env.IDEA_RETENTION_DAYS, 7),

    // App Store.
    bundleId: env.BUNDLE_ID ?? 'com.maslovw.drawingkid',
    appStoreEnvironments: list(env.APPSTORE_ENVIRONMENTS ?? 'Production,Sandbox'),
    appleRootCertPath: env.APPLE_ROOT_CERT ?? new URL('../certs/AppleRootCA-G3.cer', import.meta.url).pathname,
    // Stars that come with Full Studio when it arrives through Family Sharing. Such
    // transactions carry no appAccountToken; 0 means only the buyer's device gets stars.
    familySharedStars: int(env.FAMILY_SHARED_STARS, 0),

    // DeviceCheck: guards the free star against reinstalls. Unset in dev mode = skipped.
    deviceCheck: {
      teamId: env.APPLE_TEAM_ID ?? '',
      keyId: env.DEVICECHECK_KEY_ID ?? '',
      // Read only once the team and key IDs are filled in, so the .env template's path
      // doesn't need a file before there is an Apple key.
      privateKey: env.APPLE_TEAM_ID && env.DEVICECHECK_KEY_ID && env.DEVICECHECK_KEY_PATH ? readFileSync(env.DEVICECHECK_KEY_PATH, 'utf8') : '',
      development: flag(env.DEVICECHECK_DEVELOPMENT),
    },
  };
}
