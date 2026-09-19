/**
 * ToolRegistry — Agent tools, each with permission check, validation, rate limit, audit, idempotency
 */
const registry = new Map();

const DEFAULT_TOOLS = [
  { name: 'telegram.sendMessage', provider: 'TELEGRAM', action: 'SEND', description: 'Send Telegram message', permission: 'SEND' },
  { name: 'telegram.reply', provider: 'TELEGRAM', action: 'REPLY', description: 'Reply to Telegram message', permission: 'REPLY' },
  { name: 'instagram.reply', provider: 'INSTAGRAM', action: 'REPLY', description: 'Reply to Instagram DM', permission: 'REPLY' },
  { name: 'instagram.publish', provider: 'INSTAGRAM', action: 'PUBLISH', description: 'Publish Instagram media', permission: 'PUBLISH' },
  { name: 'facebook.publish', provider: 'FACEBOOK', action: 'PUBLISH', description: 'Publish Facebook post', permission: 'PUBLISH' },
  { name: 'facebook.reply', provider: 'FACEBOOK', action: 'REPLY', description: 'Reply to Facebook comment', permission: 'REPLY' },
  { name: 'linkedin.createPost', provider: 'LINKEDIN', action: 'PUBLISH', description: 'Create LinkedIn post', permission: 'PUBLISH' },
  { name: 'linkedin.analyze', provider: 'LINKEDIN', action: 'ANALYZE', description: 'Analyze LinkedIn page', permission: 'ANALYZE' },
  { name: 'website.reply', provider: 'WEBSITE', action: 'REPLY', description: 'Reply to website chat', permission: 'REPLY' },
  { name: 'basalam.getOrder', provider: 'BASALAM', action: 'READ', description: 'Fetch Basalam order', permission: 'READ' },
  { name: 'customer.search', provider: 'OTHER', action: 'SEARCH', description: 'Search customers', permission: 'SEARCH' },
  { name: 'inventory.check', provider: 'OTHER', action: 'READ', description: 'Check inventory', permission: 'READ' },
];

for (const t of DEFAULT_TOOLS) registry.set(t.name, t);

module.exports = {
  all: () => Array.from(registry.values()),
  get: (name) => registry.get(name),
  byProvider: (provider) => Array.from(registry.values()).filter(t => t.provider === provider?.toUpperCase()),
  register: (tool) => {
    if (!tool.name) throw new Error('tool name required');
    registry.set(tool.name, tool);
  },
};
