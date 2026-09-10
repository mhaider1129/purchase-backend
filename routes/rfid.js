const router=require('express').Router();
const c=require('../controllers/rfidController');
const permit=require('../middleware/requirePermission');
router.get('/tags/lookup/:epc',permit('rfid.view'),c.lookup);
router.patch('/tags/:tagId/status',permit('rfid.manage-tags'),c.tagStatus);
router.post('/tags/:tagId/replace',permit('rfid.manage-tags'),c.replace);
router.patch('/exceptions/:id',permit('rfid.manage-exceptions'),c.exceptionAction);
router.post('/process',permit('rfid.manage-infrastructure'),c.process);
router.get('/integration-clients',permit('rfid.manage-integrations'),c.listClients);
router.post('/integration-clients',permit('rfid.manage-integrations'),c.createClient);
router.post('/integration-clients/:id/rotate',permit('rfid.manage-integrations'),c.rotateClient);
router.post('/integration-clients/:id/disable',permit('rfid.manage-integrations'),c.disableClient);
router.get('/portals/:id/antennas',permit('rfid.view'),c.portalAntennas);
router.put('/portals/:id/antennas',permit('rfid.manage-infrastructure'),c.assignPortalAntenna);
router.delete('/portals/:id/antennas/:antennaId',permit('rfid.manage-infrastructure'),c.removePortalAntenna);

router.post('/:resource',permit('rfid.manage-infrastructure'),c.createInfrastructure);
router.get('/:resource',(req,res,next)=>permit(req.params.resource==='reads'?'rfid.view-raw-events':'rfid.view')(req,res,next),c.list);
module.exports=router;