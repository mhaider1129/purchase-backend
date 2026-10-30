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
router.use('/workflow',require('./technicalWorkflow'));
const worklist = require('../services/technicalWorklistService').createTechnicalWorklistService(require('../config/db'));
router.get('/worklist', (req, res, next) => {
  res.set('Cache-Control', 'no-store');
  worklist(req.user, req.query).then((result) => res.json(result)).catch(next);
});
// The parent API mount authenticates users. New review routes independently
// authorize SCM management or explicit reviewer assignments, before legacy CRUD.
router.use('/pre-procurement', require('./preprocurementTechnicalReviews'));

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
