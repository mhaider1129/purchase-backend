// Domain-test repository adapter representing a database before optional SQL 049.
// Technical review enforcement itself is exercised with configured databases in
// dedicated gate tests and the disposable PostgreSQL workflow integration.
module.exports = () => ({
  query: async (sql) => {
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
