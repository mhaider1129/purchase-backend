const express = require('express');

const {
  listTechnicalInspections,
  getTechnicalInspectionById,
  createTechnicalInspection,
  updateTechnicalInspection,
  deleteTechnicalInspection,
} = require('../controllers/technicalInspectionsController');

const router = express.Router();

router.get('/', listTechnicalInspections);
router.get('/:id', getTechnicalInspectionById);
router.post('/', createTechnicalInspection);
router.put('/:id', updateTechnicalInspection);
router.delete('/:id', deleteTechnicalInspection);

module.exports = router;