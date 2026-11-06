const reporting = require('../../services/procurementReportingService');
const createHttpError = require('../../utils/httpError');
const handler = domain => async (req,res,next) => {
  try {
    if(!req.user?.hasPermission?.('requests.view-incomplete'))throw createHttpError(403,'You do not have permission to view incomplete requests');
    const result=await reporting.list(req.user,{...req.query,incomplete:true,...(domain?{request_domain:domain}:{})},undefined,{all:true,legacy:true});
    // Retain the existing array contract; browser filtering/export operates on this same cohort.
    res.json(result.data);
  } catch(e){next(e);}
};
module.exports={getAllIncomplete:handler(),getMedicalIncomplete:handler('medical'),getOperationalIncomplete:handler('operational')};
