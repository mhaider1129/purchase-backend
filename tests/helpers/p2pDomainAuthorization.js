// Domain-only repository fakes do not implement users, grants or document scopes.
// Keep these tests focused on existing financial gates. Actual authorization is
// exercised separately in integration/p2p.postgres.test.js against real scoped PostgreSQL fixtures.
module.exports = {
  authorizeCommand: async (tx, actor) => {
    const context = {
      actor: actor || { id: 1 },
      instituteId: actor?.institute_id || 1,
      documents: new Map(),
    };
    tx.financialContext = context;
    return context;
  },
};
