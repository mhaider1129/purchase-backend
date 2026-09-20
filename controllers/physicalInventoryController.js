const { PhysicalInventoryService } = require('../services/physicalInventoryService');
const { context } = require('../services/fixedAssetService');
const service = new PhysicalInventoryService();
const send = (fn,status=200) => async (req,res,next) => { try { res.status(status).json(await fn(req)); } catch (error) { next(error); } };
module.exports={
  list:send(req=>service.sessions(req.query,context(req.user))), get:send(req=>service.get(req.params.sessionId,context(req.user))), preview:send(req=>service.preview(req.body,context(req.user))),
  create:send(req=>service.create(req.body,context(req.user)),201), transition:status=>send(req=>service.transition(req.params.sessionId,status,context(req.user),req.body)),
  observe:send(req=>service.observe(req.params.sessionId,req.body,context(req.user)),201), discover:send(req=>service.discover(req.params.sessionId,req.body,context(req.user)),201),
  resolve:send(req=>service.resolve(req.params.findingId,req.body,context(req.user))), register:send(req=>service.registerDiscovery(req.params.discoveryId,req.body,context(req.user)),201),
};