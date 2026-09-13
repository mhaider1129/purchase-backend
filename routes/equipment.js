const router = require('express').Router();
const controller = require('../controllers/equipmentController');
const permit = require('../middleware/requirePermission');

router.get('/', permit('equipment.view'), controller.list);
router.post('/', permit('equipment.manage'), controller.create);
router.get('/available-assets', permit('equipment.view'), controller.availableAssets);
router.get('/:id/contracts', permit('equipment.view'), permit('contracts.manage'), controller.listContractCoverage);
router.post('/:id/contracts', permit('equipment.manage'), permit('contracts.manage'), controller.createContractCoverage);
router.delete('/:id/contracts/:coverageId', permit('equipment.manage'), permit('contracts.manage'), controller.removeContractCoverage);
router.get('/:id', permit('equipment.view'), controller.get);
router.patch('/:id', permit('equipment.manage'), controller.update);

module.exports = router;