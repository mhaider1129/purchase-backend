const express = require('express');
const { listTemplates,getTemplate,createTemplate,updateTemplate,deleteTemplate } = require('../controllers/contractGovernanceController');
const router=express.Router();
router.get('/',listTemplates);
router.get('/:id',getTemplate);
router.post('/',createTemplate);
router.patch('/:id',updateTemplate);
router.delete('/:id',deleteTemplate);
module.exports=router;