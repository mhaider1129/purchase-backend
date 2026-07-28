const createHttpError = require('../utils/httpError');
const { userHasPermission } = require('../utils/permissionService');

/** Enforce an authenticated user's centrally-loaded permission set. */
const requirePermission = permissionCode => (req, _res, next) => {
  if (!req.user) {
    return next(createHttpError(401, 'Authentication required'));
  }

  if (!userHasPermission(req.user, permissionCode)) {
    return next(createHttpError(403, `Permission required: ${permissionCode}`));
  }

  return next();
};

module.exports = requirePermission;