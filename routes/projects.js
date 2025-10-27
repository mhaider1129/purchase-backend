const express = require('express');
const router = express.Router();
const {
  getProjects,
  createProject,
  getAllProjects,
  deactivateProject,
} = require('../controllers/projectsController');

router.get('/', getProjects);
router.get('/management', getAllProjects);
router.post('/', createProject);
router.patch('/:id/deactivate', deactivateProject);

module.exports = router;