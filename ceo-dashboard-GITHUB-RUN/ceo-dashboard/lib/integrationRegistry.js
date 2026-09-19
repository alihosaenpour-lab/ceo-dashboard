/**
 * IntegrationRegistry — Dynamic registry for providers
 */
const registry = new Map();

const DEFAULT_PROVIDERS = [
  {
    provider: 'TELEGRAM',
    name: 'Telegram',
    icon: 'telegram',
    capabilities: ['SEND','REPLY','READ','MANAGE_WEBHOOK'],
    credentialSchema: {
      botToken: { type: 'password', required: true, label: 'Bot Token' },
      webhookSecret: { type: 'password', required: false, label: 'Webhook Secret' },
      botUsername: { type: 'text', required: false, label: 'Bot Username' },
    },
    oauth: false,
    webhook: true,
  },
  {
    provider: 'INSTAGRAM',
    name: 'Instagram',
    icon: 'instagram',
    capabilities: ['READ','REPLY','PUBLISH','MANAGE_WEBHOOK'],
    credentialSchema: {
      appId: { type: 'text', required: true, label: 'App ID' },
      appSecret: { type: 'password', required: true, label: 'App Secret' },
      accessToken: { type: 'password', required: true, label: 'Access Token' },
      pageId: { type: 'text', required: false, label: 'Page/Instagram ID' },
      verifyToken: { type: 'text', required: false, label: 'Verify Token' },
    },
    oauth: true,
    webhook: true,
  },
  {
    provider: 'FACEBOOK',
    name: 'Facebook',
    icon: 'facebook',
    capabilities: ['READ','PUBLISH','REPLY','MANAGE_WEBHOOK'],
    credentialSchema: {
      appId: { type: 'text', required: true, label: 'App ID' },
      appSecret: { type: 'password', required: true, label: 'App Secret' },
      accessToken: { type: 'password', required: true, label: 'Access Token' },
      pageId: { type: 'text', required: false, label: 'Page ID' },
      verifyToken: { type: 'text', required: false, label: 'Verify Token' },
    },
    oauth: true,
    webhook: true,
  },
  {
    provider: 'LINKEDIN',
    name: 'LinkedIn',
    icon: 'linkedin',
    capabilities: ['READ','PUBLISH','ANALYZE'],
    credentialSchema: {
      clientId: { type: 'text', required: true, label: 'Client ID' },
      clientSecret: { type: 'password', required: true, label: 'Client Secret' },
      accessToken: { type: 'password', required: true, label: 'Access Token' },
      organizationId: { type: 'text', required: false, label: 'Organization ID' },
    },
    oauth: true,
    webhook: false,
  },
  {
    provider: 'BASALAM',
    name: 'Basalam',
    icon: 'basalam',
    capabilities: ['READ','FETCH_ACCOUNT'],
    credentialSchema: {
      accessToken: { type: 'password', required: true, label: 'Access Token / JWT' },
      webhookSecret: { type: 'password', required: false, label: 'Webhook Secret' },
    },
    oauth: false,
    webhook: true,
  },
  {
    provider: 'WEBSITE',
    name: 'Website',
    icon: 'website',
    capabilities: ['READ','REPLY'],
    credentialSchema: {
      domain: { type: 'text', required: true, label: 'Domain' },
      apiKey: { type: 'password', required: false, label: 'API Key' },
    },
    oauth: false,
    webhook: true,
  },
  {
    provider: 'AI',
    name: 'AI / LLM',
    icon: 'ai',
    capabilities: ['ANALYZE','GENERATE'],
    credentialSchema: {
      provider: { type: 'select', options: ['openai','anthropic','google','local'], required: true, label: 'Provider' },
      apiKey: { type: 'password', required: true, label: 'API Key' },
      model: { type: 'text', required: true, label: 'Model' },
      baseUrl: { type: 'text', required: false, label: 'Base URL' },
    },
    oauth: false,
    webhook: false,
  },
];

for (const p of DEFAULT_PROVIDERS) registry.set(p.provider, p);

module.exports = {
  all: () => Array.from(registry.values()),
  get: (provider) => registry.get(provider?.toUpperCase()),
  register: (def) => {
    if (!def.provider) throw new Error('provider required');
    registry.set(def.provider.toUpperCase(), def);
  },
  providers: () => Array.from(registry.keys()),
};
