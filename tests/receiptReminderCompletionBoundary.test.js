jest.mock('../config/db',()=>({connect:jest.fn()}));
jest.mock('../utils/ensureRequestedItemReceivedColumns',()=>jest.fn());
jest.mock('../utils/emailService',()=>({sendEmail:jest.fn()}));
jest.mock('../utils/notificationService',()=>({createNotifications:jest.fn()}));
const db=require('../config/db');
const remind=require('../controllers/utils/remindPendingReceipts');
const {createNotifications}=require('../utils/notificationService');
test('an unanswered follow-up reminder cannot acknowledge receipt or fulfill a request',async()=>{
 const state={status:'Completed',is_received:false,received_quantity:'0',received_at:null};
 const client={release:jest.fn(),query:jest.fn(async sql=>{
   if(sql.includes('SELECT r.id AS request_id'))return {rows:[{request_id:8,requester_id:9,request_type:'Medical Device',receipt_prompt_sent_at:'2026-01-01'}]};
   if(sql.startsWith('UPDATE requests')){if(/SET\s+status\b/i.test(sql))state.status='Received';}
   if(sql.startsWith('UPDATE requested_items')){state.is_received=true;state.received_quantity='10';}
   return {rows:[]};
 })};db.connect.mockResolvedValue(client);await remind();
 expect(state).toEqual({status:'Completed',is_received:false,received_quantity:'0',received_at:null});
 expect(createNotifications).toHaveBeenCalledWith([expect.objectContaining({userId:9,message:expect.stringContaining('explicitly confirm receipt')})],client);
 expect(client.query).toHaveBeenCalledWith('COMMIT');expect(client.release).toHaveBeenCalled();
});
