// Controller contract; evidence and transaction behavior are exercised in real PostgreSQL.
jest.mock('../services/procurementCompletionService',()=>({complete:jest.fn()}));
jest.mock('../config/db',()=>({connect:jest.fn()}));
const completion=require('../services/procurementCompletionService');
const {markRequestAsCompleted}=require('../controllers/requests/updateRequestsController');
beforeEach(()=>jest.clearAllMocks());
test.each(['COMPLETION_EVIDENCE_REQUIRED','PERMISSION_DENIED','REQUEST_NOT_FOUND'])('completion denial %s is preserved without reporting success',async code=>{
 const err=Object.assign(new Error('Controlled refusal'),{code,statusCode:409});completion.complete.mockRejectedValue(err);
 const res={json:jest.fn()},next=jest.fn();await markRequestAsCompleted({params:{id:'124'},user:{id:7}},res,next);
 expect(next).toHaveBeenCalledWith(err);expect(res.json).not.toHaveBeenCalled();
});
test('returns canonical completion evidence after a successful lifecycle command',async()=>{
 completion.complete.mockResolvedValue({after:'Completed',completion:{fulfillment_complete:true}});
 const res={json:jest.fn()},next=jest.fn();await markRequestAsCompleted({params:{id:'124'},user:{id:7}},res,next);
 expect(next).not.toHaveBeenCalled();expect(res.json).toHaveBeenCalledWith(expect.objectContaining({status:'Completed',completion:{fulfillment_complete:true}}));
});
