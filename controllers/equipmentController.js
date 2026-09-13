const { EquipmentService } = require('../services/equipmentService');
const { ContractEquipmentCoverageService } = require('../services/contractEquipmentCoverageService');

const service = new EquipmentService();
const coverageService = new ContractEquipmentCoverageService();
const context = req => {
  if (!req.user?.institute_id) throw Object.assign(new Error('Institute scope is required'), { statusCode: 403 });
  return { instituteId: req.user.institute_id, userId: req.user.id };
};
const wrap = handler => (req, res, next) => Promise.resolve(handler(req, res)).catch(next);

exports.list = wrap(async (req, res) => res.json(await service.list(req.query, context(req))));
exports.availableAssets = wrap(async (req, res) => res.json({ data: await service.availableAssets(req.query, context(req)) }));
exports.get = wrap(async (req, res) => res.json({ data: await service.get(req.params.id, context(req)) }));
exports.create = wrap(async (req, res) => res.status(201).json({ data: await service.save(null, req.body, context(req)) }));
exports.update = wrap(async (req, res) => res.json({ data: await service.save(req.params.id, req.body, context(req)) }));
exports.listContractCoverage = wrap(async (req, res) => res.json({ data: await coverageService.list(req.params.id, context(req)) }));
exports.createContractCoverage = wrap(async (req, res) => res.status(201).json({ data: await coverageService.create(req.params.id, req.body, context(req)) }));
exports.removeContractCoverage = wrap(async (req, res) => res.json({ data: await coverageService.remove(req.params.id, req.params.coverageId, context(req)) }));