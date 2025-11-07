const createHttpError = require('http-errors');
const {
  listUiResources,
  updateUiResource,
} = require('../utils/uiAccessService');

const listResources = async (req, res, next) => {
  try {
    const resources = await listUiResources();
    res.json({ resources });
  } catch (err) {
    console.error('❌ Failed to load interface access configuration:', err);
    next(createHttpError(500, 'Failed to load interface access configuration'));
  }
};

const updateResource = async (req, res, next) => {
  if (!req.user?.hasPermission?.('permissions.manage')) {
    return next(createHttpError(403, 'You do not have permission to manage interface access.'));
  }

  const resourceKey = req.params.resourceKey;
  const { permissions, permissionCodes, requireAll, require_all } = req.body || {};

  if (!resourceKey) {
    return next(createHttpError(400, 'Missing resource key.'));
  }

  const payloadPermissions = permissions ?? permissionCodes;

  try {
    const updated = await updateUiResource(resourceKey, payloadPermissions, requireAll ?? require_all);
    if (!updated) {
      return next(createHttpError(404, 'Resource not found.'));
    }

    res.json({ resource: updated });
  } catch (err) {
    console.error('❌ Failed to update UI resource permissions:', err);
    next(createHttpError(500, 'Failed to update interface access configuration.'));
  }
};

module.exports = {
  listResources,
  updateResource,
};