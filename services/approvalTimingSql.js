'use strict';

// Arguments are trusted SQL expressions supplied by backend code, never input.
// SQL 048 owns the common interval/parallel-hold calculation for every report.
const activeSecondsSql = (requestId,start,end) =>
  `public.approval_active_elapsed_seconds(${requestId},(${start})::timestamptz,(${end})::timestamptz)`;
const activeDaysSql = (requestId,start,end) => `(${activeSecondsSql(requestId,start,end)} / 86400.0)`;
module.exports={activeSecondsSql,activeDaysSql};
