const pool = require('../config/db');
const ensureTechnicalInspectionsTable = require('./ensureTechnicalInspectionsTable');

const normalizeRunner = (client) => (client && client.query ? client : pool);

const getInspectionSummaryForRequest = async (client, requestId) => {
  if (!requestId) {
    return { pendingCount: 0, totalCount: 0 };
  }

  const runner = normalizeRunner(client);
  await ensureTechnicalInspectionsTable(runner);

  const { rows } = await runner.query(
    `SELECT
        COUNT(*) FILTER (
          WHERE LOWER(COALESCE(acceptance_status, 'pending')) <> 'passed'
        ) AS pending_count,
        COUNT(*) AS total_count
      FROM technical_inspections
     WHERE request_id = $1`,
    [requestId],
  );

  const quantities=require('../services/receiptInspectionQuantities');
  const delivery=(await runner.query(`SELECT count(*) FILTER(WHERE actual.accepted_quantity<poi.quantity)::integer pending_count,count(*)::integer total_count FROM purchase_order_items poi JOIN purchase_orders po ON po.id=poi.purchase_order_id JOIN LATERAL (SELECT SUM(${quantities.accepted()}) AS accepted_quantity,bool_or(${quantities.required()}) AS required FROM goods_receipt_items gri WHERE gri.purchase_order_item_id=poi.id) actual ON actual.required WHERE po.request_id=$1 AND po.status NOT IN ('PO_CANCELLED','CANCELLED')`,[requestId])).rows[0]||{};
  const pendingCount = Number(rows[0]?.pending_count || 0) + Number(delivery.pending_count || 0);
  const totalCount = Number(rows[0]?.total_count || 0) + Number(delivery.total_count || 0);

  return { pendingCount, totalCount };
};

// Compatibility API for historical callers. Inspection evidence is not authority
// to transition a request, close a case, settle a PO or release inventory.
// Explicit request completion still consumes the read-only summary above.
const applyRequestStatusFromInspections = async (client, { requestId }) => ({
  ...(await getInspectionSummaryForRequest(client, requestId)),
  appliedStatus: null,
  statusUpdated: false,
});

module.exports = { getInspectionSummaryForRequest, applyRequestStatusFromInspections };
