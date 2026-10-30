const { requireCapability } = require('../services/planningAuthorizationService');
module.exports = (action = 'read') => (req, _res, next) => {
  try { requireCapability(req.user, action); next(); } catch (error) { next(error); }
};
