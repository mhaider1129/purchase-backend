// Domain-test repository adapter representing a database before optional SQL 049.
// Technical review enforcement itself is exercised with configured databases in
// dedicated gate tests and the disposable PostgreSQL workflow integration.
module.exports = () => ({
  query: async (sql,parameters=[]) => {
    // This calculation-only adapter assumes the fixture's institute-1 source graph.
    // Native PostgreSQL tests verify actual object ownership and reject mismatches.
    if(/^SELECT \* FROM (requests|purchase_orders|procurement_awards)/.test(sql))return{rows:[{id:parameters[0],request_id:1,institute_id:1}]};
    if(sql.startsWith('SELECT DISTINCT r.institute_id'))return{rows:[{institute_id:1}]};
    // This domain adapter has no installed contract module; native tests cover it.
    if (sql.includes("to_regclass('public.contracts')")) return {rows:[{present:null}]};
    if (sql.includes("technical_review_available"))
      return { rows: [{ technical_review_available: false }] };
    if (
      sql.includes("INSERT INTO audit_logs") ||
      sql.includes("INSERT INTO notification_outbox")
    )
      return { rows: [{ id: 1 }] };
    throw new Error(
      `Unexpected SQL in legacy technical review adapter: ${sql}`,
    );
  },
});
