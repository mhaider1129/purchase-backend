const express = require('express');
const { listClauses,createClause,updateClause,deleteClause } = require('../controllers/contractGovernanceController');
const router=express.Router();
router.get('/',listClauses);
router.post('/',createClause);
router.patch('/:id',updateClause);
router.delete('/:id',deleteClause);
module.exports=router;