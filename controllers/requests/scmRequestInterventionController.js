const reject = require('../../services/scmRequestInterventionService').createScmRequestInterventionService();
exports.reject = async (req, res, next) => {
  try { res.json(await reject({ requestId: req.params.id, reason: req.body?.reason, actor: req.user })); }
  catch (error) { next(error); }
};
