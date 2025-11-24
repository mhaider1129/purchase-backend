const express = require('express');

const {
  listTechnicalInspections,
  getTechnicalInspectionById,
  createTechnicalInspection,
  updateTechnicalInspection,
  deleteTechnicalInspection,
} = require('../controllers/technicalInspectionsController');
const createHttpError = require('../utils/httpError');

const router = express.Router();

const requireTechnicalInspectionPermission = (req, _res, next) => {
  const hasPermission = req.user?.hasPermission?.('technical-inspections.manage');

  if (!hasPermission) {
    return next(
      createHttpError(
        403,
        'You do not have permission to manage technical inspections'
      )
    );
  }

  next();
};

router.use(requireTechnicalInspectionPermission);

router.get('/', listTechnicalInspections);
router.get('/:id', getTechnicalInspectionById);
router.post('/', createTechnicalInspection);
router.put('/:id', updateTechnicalInspection);
router.delete('/:id', deleteTechnicalInspection);

module.exports = router;