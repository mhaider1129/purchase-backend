const createHttpError = require('http-errors');
const { listCapabilityPolicies, updateCapabilityPolicy } = require('../utils/capabilityPolicyService');

const listPolicies = async (req, res, next) => {
  try {
    const policies = await listCapabilityPolicies();
    res.json({ policies });
  } catch (error) {
    next(createHttpError(500, 'Failed to load capability policies.'));
  }
};

const updatePolicy = async (req, res, next) => {
  if (!req.user?.hasPermission?.('permissions.manage')) {
    return next(createHttpError(403, 'You do not have permission to manage capability policies.'));
  }

  try {
    const { routePrefix, ...updates } = req.body || {};
    const updated = await updateCapabilityPolicy(routePrefix, updates);
    if (!updated) {
      return next(createHttpError(404, 'Capability policy not found or no valid fields provided.'));
    }
    res.json({ policy: updated });
  } catch (error) {
    next(createHttpError(500, 'Failed to update capability policy.'));
  }
};

module.exports = { listPolicies, updatePolicy };