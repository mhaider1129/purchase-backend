const r=require('express').Router(),c=require('../controllers/approvalDelegationsController'),permit=require('../middleware/requirePermission');
r.get('/approval-authority-delegations',permit('approval-delegation.view'),c.list);
r.post('/approval-authority-delegations',permit('approval-delegation.manage'),c.create);
r.post('/approval-authority-delegations/:id/revoke',permit('approval-delegation.manage'),c.revoke);
module.exports=r;