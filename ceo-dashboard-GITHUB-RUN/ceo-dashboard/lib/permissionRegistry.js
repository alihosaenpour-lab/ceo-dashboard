/**
 * PermissionRegistry — Central permission matrix
 */
const ALL_ACTIONS = ['READ','SEND','REPLY','CREATE_DRAFT','PUBLISH','EDIT','DELETE','ANALYZE','SEARCH','FETCH_ACCOUNT','MANAGE_WEBHOOK','MANAGE_CREDENTIAL'];

const DEFAULT_MATRIX = {
  CEO: ALL_ACTIONS,
  ADMIN: ALL_ACTIONS,
  MANAGER: ['READ','ANALYZE','SEARCH','FETCH_ACCOUNT'],
  OPERATOR: ['READ','SEND','REPLY','CREATE_DRAFT','SEARCH'],
  VIEWER: ['READ','SEARCH','FETCH_ACCOUNT','ANALYZE'],
  AGENT: [], // per-agent via DB
};

module.exports = {
  ALL_ACTIONS,
  DEFAULT_MATRIX,
  can: (role, action) => {
    const perms = DEFAULT_MATRIX[role] || [];
    return perms.includes(action) || perms.includes('*');
  },
  // For AGENT, check DB AgentPermission
  canAgent: async (prisma, agentId, provider, action) => {
    const perm = await prisma.agentPermission.findUnique({
      where: { agentId_provider_action: { agentId, provider: provider.toUpperCase(), action } }
    });
    return perm?.allowed === true;
  }
};
