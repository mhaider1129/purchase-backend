"use strict";
const service = require("../services/contractFinancialReconciliationService");
exports.worklist = async (req, res, next) => {
  try {
    res.json(
      await service.worklist(req.user, { contractId: req.query.contractId }),
    );
  } catch (e) {
    next(e);
  }
};
exports.review = async (req, res, next) => {
  try {
    res.json(await service.review(req.user, req.body || {}));
  } catch (e) {
    next(e);
  }
};
