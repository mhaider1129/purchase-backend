jest.mock('../services/requestReclassificationService', () => ({ reclassifyRequest: jest.fn() }));
const service = require('../services/requestReclassificationService');
const { rewireRequestType } = require('../controllers/requests/updateRequestsController');
describe('rewireRequestType controller', () => {
 beforeEach(()=>jest.clearAllMocks());
 test('delegates parsed input', async()=>{ service.reclassifyRequest.mockResolvedValue({request_id:603,request_type:'IT Item'}); const req={params:{id:'603'},body:{request_type:'IT Item',reason:'Correction'},user:{id:22},correlationId:'corr'}; const res={json:jest.fn()},next=jest.fn(); await rewireRequestType(req,res,next); expect(service.reclassifyRequest).toHaveBeenCalledWith({requestId:603,targetRequestType:'IT Item',actor:req.user,reason:'Correction',correlationId:'corr'}); expect(res.json).toHaveBeenCalledWith(expect.objectContaining({request_id:603})); expect(next).not.toHaveBeenCalled(); });
 test('passes service errors to middleware',async()=>{const error=Object.assign(new Error('denied'),{statusCode:403});service.reclassifyRequest.mockRejectedValue(error);const next=jest.fn();await rewireRequestType({params:{id:'1'},body:{request_type:'Stock'},user:{}},{json:jest.fn()},next);expect(next).toHaveBeenCalledWith(error);});
 test('rejects invalid ids',async()=>{const next=jest.fn();await rewireRequestType({params:{id:'x'},body:{}},{json:jest.fn()},next);expect(next).toHaveBeenCalledWith(expect.objectContaining({statusCode:400}));expect(service.reclassifyRequest).not.toHaveBeenCalled();});
});
