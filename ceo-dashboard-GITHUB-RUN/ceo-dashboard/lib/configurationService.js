/**
 * ConfigurationService — SINGLE ACCESS LAYER for all dynamic config
 * Reads from DB (BusinessSetting, Integration) and falls back to ENV for infra.
 * Never reads .env directly for UI-managed credentials.
 */
const prisma = require('./prisma');

const INFRA_KEYS = new Set(['DATABASE_URL','JWT_SECRET','ENCRYPTION_KEY','INTERNAL_SERVICE_SECRET','PORT','NODE_ENV']);

class ConfigurationService {
  async get(key) {
    // key like "integrations.telegram", "integrations.telegram.credentials", "ai.default_model", "brand.name"
    if (!key) return null;
    // AI, brand, business etc are BusinessSetting
    if (key.startsWith('integrations.')) {
      const parts = key.split('.');
      const provider = parts[1]?.toUpperCase();
      if (!provider) return null;
      const integration = await prisma.integration.findUnique({ where: { provider } });
      if (!integration) {
        // Fallback to ENV for legacy (TELEGRAM_BOT_TOKEN etc) — only for infra migration
        return this.getFromEnv(provider);
      }
      if (parts.length === 2) return integration;
      if (parts[2] === 'credentials') {
        // Decrypt but caller should use getDecrypted
        return integration.credentialsEncrypted ? require('./encryption').decrypt(integration.credentialsEncrypted) : null;
      }
      if (parts[2] === 'config') return integration.config;
      if (parts[2] === 'status') return integration.status;
      return integration;
    }
    // Business settings
    const setting = await prisma.businessSetting.findUnique({ where: { key } });
    if (setting) return setting.value;
    // Env fallback for infra only
    if (INFRA_KEYS.has(key)) return process.env[key] || null;
    return null;
  }

  getFromEnv(provider) {
    // Legacy ENV mapping for migration — returns masked object
    const map = {
      TELEGRAM: { botToken: process.env.TELEGRAM_BOT_TOKEN, webhookSecret: process.env.TELEGRAM_WEBHOOK_SECRET },
      INSTAGRAM: { appId: process.env.INSTAGRAM_CLIENT_ID, appSecret: process.env.INSTAGRAM_CLIENT_SECRET, accessToken: process.env.INSTAGRAM_ACCESS_TOKEN },
      FACEBOOK: { appId: process.env.FB_CLIENT_ID, appSecret: process.env.FB_CLIENT_SECRET },
      LINKEDIN: { clientId: process.env.LINKEDIN_CLIENT_ID, clientSecret: process.env.LINKEDIN_CLIENT_SECRET },
      BASALAM: { token: process.env.BASALAM_TOKEN },
      WEBSITE: { domain: process.env.ALLOWED_DOMAIN },
      AI: { apiKey: process.env.OPENAI_API_KEY, provider: process.env.AI_PROVIDER },
    };
    return map[provider] || null;
  }

  async getDecrypted(provider) {
    const p = provider.toUpperCase();
    const integration = await prisma.integration.findUnique({ where: { provider: p } });
    if (!integration || !integration.credentialsEncrypted) return null;
    return require('./encryption').decrypt(integration.credentialsEncrypted);
  }

  async setBusinessSetting(key, value, category, actorId) {
    return prisma.businessSetting.upsert({
      where: { key },
      update: { value, category, updatedBy: actorId },
      create: { key, value, category, updatedBy: actorId },
    });
  }

  async getBusinessSetting(key) {
    const s = await prisma.businessSetting.findUnique({ where: { key } });
    return s ? s.value : null;
  }

  // For hot config: no restart needed, just DB update
  async isHotReloadable(key) {
    const hotKeys = ['integrations.', 'brand.', 'business.', 'ai.'];
    return hotKeys.some(k => key.startsWith(k));
  }
}

module.exports = new ConfigurationService();
