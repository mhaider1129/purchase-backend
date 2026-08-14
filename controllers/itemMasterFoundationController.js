const createHttpError = require('../utils/httpError');
const { ItemMasterFoundationService } = require('../services/itemMasterFoundationService');

const service = new ItemMasterFoundationService();
const requirePermission = permission => (req, _res, next) => {
  if (!req.user?.hasPermission(permission)) return next(createHttpError(403, `Permission required: ${permission}`));
  next();
};
const requireAnyPermission = permissions => (req, _res, next) => {
  if (!permissions.some(permission => req.user?.hasPermission(permission))) return next(createHttpError(403, `One permission required: ${permissions.join(', ')}`));
  next();
};
const TRANSITION_PERMISSIONS = Object.freeze({ review:'item-master.edit', validation:'item-master.validate', approval:'item-master.validate', active:'item-master.approve', retired:'item-master.retire', draft:'item-master.edit' });
const requireTransitionPermission = (req, _res, next) => {
  const permission = TRANSITION_PERMISSIONS[String(req.body?.status || '')];
  if (!permission) return next(createHttpError(400, 'Unsupported lifecycle transition'));
  if (!req.user?.hasPermission(permission)) return next(createHttpError(403, `Permission required: ${permission}`));
  next();
};
const id = req => {
  const value = Number(req.params.id);
  if (!Number.isInteger(value) || value <= 0) throw createHttpError(400, 'Invalid id');
  return value;
};
const action = handler => async (req, res, next) => {
  try { await handler(req, res); } catch (error) { next(error); }
};

module.exports = {
  requirePermission,
  requireAnyPermission,
  requireTransitionPermission,
  searchGeneric: action(async (req,res)=>res.json(await service.searchGeneric(req.query))),
  createGeneric: action(async (req,res)=>res.status(201).json(await service.createGeneric(req.body,req.user.id))),
  transitionGeneric: action(async (req,res)=>res.json(await service.transitionGeneric(id(req),String(req.body?.status||''),req.user.id))),
  searchProducts: action(async (req,res)=>res.json(await service.searchProducts(req.query))),
  createProduct: action(async (req,res)=>res.status(201).json(await service.createProduct(req.body,req.user.id))),
  approveProduct: action(async (req,res)=>res.json(await service.approveProduct(id(req),req.user.id))),
  transitionProduct: action(async (req,res)=>res.json(await service.transitionProduct(id(req),String(req.body?.status||''),req.user.id))),
  searchCatalog: action(async (req,res)=>res.json(await service.searchCatalog(req.query))),
  createCatalog: action(async (req,res)=>res.status(201).json(await service.createCatalog(req.body,req.user.id))),
  updateCatalog: action(async (req,res)=>res.json(await service.updateCatalog(id(req),req.body,req.user.id))),
  deactivateCatalog: action(async (req,res)=>res.json(await service.deactivateCatalog(id(req),req.user.id))),
  submitPending: action(async (req,res)=>res.status(202).json(await service.submitPending(req.body,req.user.id))),
  pendingQueue: action(async (req,res)=>res.json(await service.pendingQueue(req.query))),
  resolvePending: action(async (req,res)=>res.json(await service.resolvePending(id(req),req.body||{},req.user))),
  resolveDuplicate: action(async (req,res)=>res.json(await service.resolveDuplicate(id(req),req.body||{},req.user.id))),
  referenceData: action(async (_req,res)=>res.json(await service.referenceData())),
  searchReferences: action(async (req,res)=>res.json(await service.searchReferences(req.params.type,req.query))),
  createReference: action(async (req,res)=>res.status(201).json(await service.createReference(req.params.type,req.body||{},req.user.id))),
  deactivateReference: action(async (req,res)=>res.json(await service.deactivateReference(req.params.type,id(req),req.user.id))),
  legacyCoverage: action(async (_req,res)=>res.json(await service.legacyCoverage())),
  unmappedLegacy: action(async (req,res)=>res.json(await service.unmappedLegacy(req.query))),
  mapLegacy: action(async (req,res)=>res.status(201).json(await service.mapLegacy(req.body||{},req.user.id))),
  requestMerge: action(async (req,res)=>res.status(202).json(await service.requestMerge(req.body||{},req.user.id))),
};