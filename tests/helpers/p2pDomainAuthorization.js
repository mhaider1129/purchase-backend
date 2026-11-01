// Domain-only repository fakes do not implement users, grants or document scopes.
// Keep these tests focused on existing financial gates. Actual authorization is
// exercised separately in integration/p2p.postgres.test.js against real scoped PostgreSQL fixtures.
module.exports = {
  id:v=>String(v),
  loadActor:async(_db,actor,cap)=>{if(!actor?.id)throw Object.assign(new Error('Authentication required'),{statusCode:401});if(!(actor.permissions||[]).includes(cap)&&!actor.hasPermission?.(cap))throw Object.assign(new Error('Permission required'),{statusCode:403});return actor;},
  fail:(statusCode,message,code)=>Object.assign(new Error(message),{statusCode,code}),
  authorizeCommand: async (tx, actor) => {
    const context = {
      actor: actor || { id: 1 },
      instituteId: actor?.institute_id || 1,
      request:{status:'Approved'},
      documents: new Map(),
    };
    tx.financialContext = context;
    return context;
  },
};
