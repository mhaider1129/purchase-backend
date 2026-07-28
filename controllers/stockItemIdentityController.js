const { StockItemIdentityService } = require('../services/stockItemIdentityService');

const service = new StockItemIdentityService();

function action(handler) {
  return async (req, res, next) => {
    try {
      await handler(req, res);
    } catch (error) {
      next(error);
    }
  };
}

const map = action(async (req, res) => {
  const mapping = await service.mapStockItem(req.body, req.user.id);
  res.json(mapping);
});

const add = action(async (req, res) => {
  const stockItem = await service.addToInventory(req.body, req.user.id);
  res.status(201).json(stockItem);
});

module.exports = { map, add };