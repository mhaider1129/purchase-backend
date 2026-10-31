function fixture() {
  const state = {
    user: {
      id: 1,
      institute_id: 10,
      department_id: 2,
      role: "Requester",
      is_active: true,
    },
    permissions: ["stock-requests.create"],
    scopes: {},
    root: { id: 20, institute_id: 10, requester_id: 1, department_id: 2 },
    file: {
      id: 30,
      request_id: 20,
      file_path: "uploads/request-20/test.pdf",
      file_name: "test.pdf",
      uploaded_by: 1,
    },
    approver: false,
    buyer: false,
    technical: false,
    demoReviewer: false,
    selected: true,
    signed: false,
    retained: false,
    tables: new Set(),
    deleted: false,
    version: 0,
  };
  const query = jest.fn(async (sql, args = []) => {
    let rows = [];
    if (sql.startsWith("SELECT id,role,"))
      rows = state.user ? [state.user] : [];
    else if (sql.startsWith("SELECT to_regclass"))
      rows = [{ available: state.tables.has(args[0].replace("public.", "")) }];
    else if (sql.startsWith("SELECT * FROM requests"))
      rows = state.root ? [state.root] : [];
    else if (sql.includes("FROM contracts c LEFT JOIN"))
      rows = state.contract ? [state.contract] : [];
    else if (sql.startsWith("SELECT p.*,d.institute_id"))
      rows = state.plan ? [state.plan] : [];
    else if (sql.startsWith("SELECT * FROM attachments"))
      rows = state.file && !state.deleted ? [state.file] : [];
    else if (sql.includes("FROM approvals") && sql.includes("approver_id"))
      rows = state.approver ? [{ id: 40 }] : [];
    else if (sql.includes("FROM approvals") && sql.includes("LIMIT 1"))
      rows = state.signed ? [{ id: 40 }] : [];
    else if (sql.startsWith("SELECT id FROM requested_items WHERE request_id"))
      rows = state.buyer ? [{ id: 50 }] : [];
    else if (sql.startsWith("SELECT id,request_id FROM requested_items"))
      rows = [{ id: args[0], request_id: 20 }];
    else if (
      sql.includes("FROM preprocurement_technical_review_assignments own")
    )
      rows = state.technical ? [{ id: 60 }] : [];
    else if (sql.includes("FROM device_demo_reviewers own")) {
      // SQL 050 defines PRIMARY KEY(workspace_id,reviewer_id), not an id column.
      // The old permissive fixture hid this query/schema mismatch.
      if (/\bown\.id\b/.test(sql))
        throw Object.assign(new Error('column own.id does not exist'), { code: '42703' });
      rows = state.demoReviewer ? [{ authorized: 1 }] : [];
    }
    else if (sql.startsWith("SELECT e.id FROM device_demo_events"))
      rows = state.demoReviewer && state.selected ? [{ id: 61 }] : [];
    else if (sql.startsWith("SELECT t.id FROM preprocurement"))
      rows = state.technical && state.selected ? [{ id: 60 }] : [];
    else if (
      sql.startsWith("SELECT id FROM contract_approvals WHERE contract_id") &&
      !sql.includes("reviewer_id")
    )
      rows = state.contractSigned ? [{ id: 80 }] : [];
    else if (sql.startsWith("SELECT id FROM contract_document_versions"))
      rows = state.versionRetained ? [{ id: 81 }] : [];
    else if (
      sql.startsWith(
        "SELECT id FROM delivery_inspection_tasks WHERE request_id",
      )
    )
      rows = state.receiver ? [{ id: 90 }] : [];
    else if (sql.startsWith("SELECT e.id FROM technical_evidence_references"))
      rows = state.receiver && state.selected ? [{ id: 91 }] : [];
    else if (sql.startsWith("SELECT * FROM contract_approvals"))
      rows = state.contractStep ? [state.contractStep] : [];
    else if (sql.startsWith("SELECT id FROM technical_evidence_references"))
      rows = state.retained ? [{ id: 70 }] : [];
    else if (sql.startsWith("SELECT * FROM attachments WHERE request_id"))
      rows = state.file ? [state.file] : [];
    else if (
      sql.startsWith("SELECT id FROM attachments WHERE file_path=$1 LIMIT")
    )
      rows = [];
    else if (
      sql.startsWith("SELECT id FROM attachments WHERE file_path") ||
      sql.includes("regexp_replace(file_path")
    )
      rows = state.file ? [{ id: state.file.id }] : [];
    else if (sql.startsWith("DELETE FROM attachments")) {
      if (state.fkRace)
        throw Object.assign(new Error("retained"), { code: "23503" });
      state.deleted = true;
    } else if (sql.startsWith("INSERT INTO attachments")) rows = [{ id: 31 }];
    return { rows, rowCount: rows.length };
  });
  return {
    state,
    query,
    db: { query },
    authority: async () => ({
      permissions: state.permissions,
      dataScopes: state.scopes,
    }),
  };
}
module.exports = fixture;
