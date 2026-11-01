const pool = require("../config/db");
const createHttpError = require("../utils/httpError");
const sourcing = require("../services/rfxAuthorization");
const { createAward } = require("../services/procurementAwardService");
const {
  assertRequestItemsReadyForSourcing,
} = require("../services/sourcingReadinessService");
const {
  createPurchaseOrderFromAwards,
} = require("../services/purchaseOrderService");
const {
  createConnectedP2PRepository,
} = require("../repositories/connectedP2PRepository");
const {
  priceAggregateRfxResponse,
  priceNormalizedRfxResponse,
} = require("../services/rfxAwardPricingService");
const { submitLinkedRfxResponse } = require("../services/rfxResponseService");
const notificationOutbox = require("../services/notificationOutboxService");

const normalizeText = (value) =>
  typeof value === "string" ? value.trim() : "";

const clampScore = (value, fallback = 0) => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  if (numeric < 0) return 0;
  if (numeric > 100) return 100;
  return numeric;
};

const normalizeBidAmount = (value) => {
  if (value === null || value === undefined) return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric >= 0 ? numeric : null;
};

const calculatePriceScore = (bidAmount, minBid, maxBid) => {
  if (!Number.isFinite(bidAmount) || minBid === null || maxBid === null)
    return null;
  if (maxBid === minBid) return 100;

  const distanceFromMin = maxBid - bidAmount;
  const priceRange = maxBid - minBid;
  const normalized = (distanceFromMin / priceRange) * 100;
  return clampScore(normalized, 0);
};

const listValidOfferings = async (req, res, next) => {
  try {
    const result = await sourcing.transaction(
      req.user,
      { itemId: req.query.requested_item_id },
      async (client, ctx) => {
        const supplier = await sourcing.resolveSupplier(
          client,
          req.query,
          ctx.instituteId,
        );
        return (
          await client.query(
            `SELECT c.id supplier_catalog_item_id,c.supplier_item_code,c.supplier_description,c.purchasing_uom,c.purchasing_uom_id,c.conversion_factor,
        p.id approved_product_id,p.product_name,p.manufacturer,p.manufacturer_part_number,p.product_uom,p.package_quantity,
        g.id generic_item_id,g.generic_name,(p.id=ri.preferred_product_id) is_preferred
        FROM requested_items ri JOIN generic_items g ON g.id=ri.generic_item_id JOIN approved_products p ON p.generic_item_id=g.id
        JOIN supplier_catalog_items c ON c.approved_product_id=p.id JOIN item_uom u ON u.id=c.purchasing_uom_id
        WHERE ri.id=$1 AND c.supplier_id=$2 AND c.is_active=TRUE AND p.is_active=TRUE AND p.approval_status='approved'
          AND (p.institute_id IS NULL OR p.institute_id=$3)
          AND g.is_active=TRUE AND g.lifecycle_status='active' AND u.is_active=TRUE
          AND (ri.mandatory_product_id IS NULL OR p.id=ri.mandatory_product_id)
        ORDER BY (p.id=ri.preferred_product_id) DESC,p.product_name,c.supplier_item_code`,
            [req.query.requested_item_id, supplier.id, ctx.instituteId],
          )
        ).rows;
      },
    );
    res.json({ data: result });
  } catch (error) {
    next(error);
  }
};

const listRfxEvents = async (req, res, next) => {
  try {
    const rows = await sourcing.transaction(
      req.user,
      null,
      async (client, ctx) =>
        (
          await client.query(
            `SELECT e.*,COALESCE(resp.response_count,0) AS response_count,resp.last_submitted_at
       FROM rfx_events e LEFT JOIN LATERAL (
         SELECT COUNT(*) AS response_count,MAX(resp.created_at) AS last_submitted_at
         FROM rfx_responses resp WHERE resp.rfx_id=e.id AND ${sourcing.responsePredicate()}
       ) resp ON TRUE
       WHERE ${sourcing.eventPredicate("e", "$1")} AND ($2::text IS NULL OR e.status=$2)
       ORDER BY e.created_at DESC`,
            [ctx.instituteId, normalizeText(req.query?.status) || null],
          )
        ).rows,
    );
    res.json(rows);
  } catch (error) {
    next(error);
  }
};

const createRfxEvent = async (req, res, next) => {
  const title = normalizeText(req.body?.title);
  const rfxType = normalizeText(
    req.body?.rfx_type || req.body?.type,
  ).toLowerCase();
  const description = normalizeText(req.body?.description) || null;
  let incomingDetails =
    req.body?.details ?? (req.body?.items ? { items: req.body.items } : null);
  const requestIdRaw = req.body?.request_id ?? req.body?.requestId;
  const dueDateRaw = normalizeText(req.body?.due_date);
  const allowedTypes = new Set(["rfq", "rfp", "rfi", "itt", "rft"]);
  const requestId =
    requestIdRaw !== undefined && requestIdRaw !== null
      ? Number(requestIdRaw)
      : null;

  if (!title) {
    return next(createHttpError(400, "Title is required"));
  }

  if (!allowedTypes.has(rfxType)) {
    return next(
      createHttpError(400, "Invalid RFX type. Use RFQ, RFP, RFI, ITT, or RFT"),
    );
  }

  if (!Number.isSafeInteger(requestId) || requestId <= 0) {
    return next(
      createHttpError(
        400,
        "Invalid request_id; provide a valid requisition id",
      ),
    );
  }

  const dueDate = dueDateRaw ? new Date(dueDateRaw) : null;
  if (dueDate && Number.isNaN(dueDate.getTime())) {
    return next(createHttpError(400, "Invalid due date"));
  }

  try {
    const created = await sourcing.transaction(
      req.user,
      { requestId },
      async (client, ctx) => {
        await sourcing.assertActiveSourcing(client, ctx);
        await assertRequestItemsReadyForSourcing(
          client,
          requestId,
          undefined,
          ctx.actor,
        );
        const requestItems = await client.query(
          "SELECT id AS requested_item_id,item_name,specs,quantity,approval_comments AS notes FROM requested_items WHERE request_id=$1 ORDER BY id FOR SHARE",
          [requestId],
        );
        incomingDetails = {
          ...(incomingDetails || {}),
          items: requestItems.rows,
        };
        const row = (
          await client.query(
            `INSERT INTO rfx_events(title,rfx_type,description,details,request_id,due_date,status,created_by)
        VALUES($1,$2,$3,$4,$5,$6,'open',$7) RETURNING *`,
            [
              title,
              rfxType.toUpperCase(),
              description,
              incomingDetails,
              requestId,
              dueDate,
              ctx.actor.id,
            ],
          )
        ).rows[0];
        await sourcing.audit(client, ctx, "RFX_CREATED", row.id, null, row);
        await notificationOutbox.enqueueNotification(client, {
          type: "RFX_CREATED",
          entityType: "rfx_event",
          entityId: row.id,
          payload: {
            requestId,
            requestedItemIds: requestItems.rows.map((i) => i.requested_item_id),
            actorId: ctx.actor.id,
          },
          idempotencyKey: `rfx-created:${row.id}`,
        });
        return row;
      },
    );
    res.status(201).json(created);
  } catch (error) {
    next(error);
  }
};

const submitRfxResponse = async (req, res, next) => {
  try {
    const result = await sourcing.transaction(
      req.user,
      { eventId: req.params.id },
      async (client, ctx) => {
        const { event } = ctx;
        if (
          !["open"].includes(String(event.status).toLowerCase()) ||
          (event.due_date && new Date(event.due_date).getTime() < Date.now())
        )
          throw createHttpError(
            409,
            "This RFX event is no longer accepting responses",
          );
        const supplier = await sourcing.resolveSupplier(
          client,
          req.body || {},
          ctx.instituteId,
        );
        const bidAmount = req.body?.bid_amount;
        const notes = normalizeText(req.body?.notes) || null;
        const responseData =
          req.body?.response_data || req.body?.details || null;
        const repository = {
          client,
          loadRequestedItems: async (requestId) =>
            (
              await client.query(
                "SELECT * FROM requested_items WHERE request_id=$1 ORDER BY id FOR SHARE",
                [requestId],
              )
            ).rows,
          assertOfferIdentity: async (line, supplierId) => {
            const result = await client.query(
              `SELECT c.supplier_id,c.approved_product_id,c.is_active catalog_active,c.purchasing_uom_id,c.conversion_factor,p.generic_item_id,p.approval_status,p.is_active product_active,p.package_quantity,g.lifecycle_status,g.is_active generic_active,ri.generic_item_id requested_generic_id,ri.mandatory_product_id,ri.request_mode,u.is_active uom_active
            FROM requested_items ri JOIN approved_products p ON p.id=$2 JOIN generic_items g ON g.id=p.generic_item_id JOIN supplier_catalog_items c ON c.id=$3 LEFT JOIN item_uom u ON u.id=c.purchasing_uom_id
            WHERE ri.id=$1 FOR SHARE OF c,p,g`,
              [
                line.requested_item_id,
                line.approved_product_id,
                line.supplier_catalog_item_id,
              ],
            );
            const x = result.rows[0];
            if (!x || Number(x.supplier_id) !== Number(supplierId))
              throw Object.assign(
                new Error("Catalog does not belong to responding supplier"),
                { code: "RFX_CATALOG_SUPPLIER_MISMATCH", statusCode: 409 },
              );
            if (
              Number(x.approved_product_id) !==
                Number(line.approved_product_id) ||
              !x.catalog_active ||
              x.approval_status !== "approved" ||
              !x.product_active ||
              x.lifecycle_status !== "active" ||
              !x.generic_active
            )
              throw Object.assign(
                new Error("Offered Product/Catalog is not active and approved"),
                { code: "RFX_CATALOG_IDENTITY_INVALID", statusCode: 409 },
              );
            if (Number(x.generic_item_id) !== Number(x.requested_generic_id))
              throw Object.assign(
                new Error(
                  "Offered Product does not belong to requested Generic",
                ),
                { code: "RFX_PRODUCT_GENERIC_MISMATCH", statusCode: 409 },
              );
            if (
              x.mandatory_product_id &&
              Number(x.mandatory_product_id) !==
                Number(line.approved_product_id)
            )
              throw Object.assign(
                new Error(
                  "Offered Product violates mandatory Product restriction",
                ),
                { code: "RFX_MANDATORY_PRODUCT_MISMATCH", statusCode: 409 },
              );
            await sourcing.assertProductScope(
              client,
              line.approved_product_id,
              ctx.instituteId,
            );
            return x;
          },
          insertResponse: async (row) =>
            (
              await client.query(
                `INSERT INTO rfx_responses (rfx_id,request_id,supplier_id,submitted_by,bid_amount,notes,response_data) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
                [
                  row.rfx_id,
                  row.request_id,
                  row.supplier_id,
                  row.submitted_by,
                  row.bid_amount,
                  row.notes,
                  row.response_data,
                ],
              )
            ).rows[0],
          insertResponseItem: async (row) =>
            (
              await client.query(
                `INSERT INTO rfx_response_items (rfx_response_id,requested_item_id,quoted_quantity,free_quantity,unit_price,currency,brand,offered_specs,notes,approved_product_id,supplier_catalog_item_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
                [
                  row.rfx_response_id,
                  row.requested_item_id,
                  row.quoted_quantity,
                  row.free_quantity,
                  row.unit_price,
                  row.currency,
                  row.brand,
                  row.offered_specs,
                  row.notes,
                  row.approved_product_id,
                  row.supplier_catalog_item_id,
                ],
              )
            ).rows[0],
        };
        const response = await submitLinkedRfxResponse({
          repository,
          event,
          supplierId: supplier.id,
          submittedBy: ctx.actor.id,
          actor: ctx.actor,
          bidAmount,
          notes,
          responseData,
          lines: req.body?.items || responseData?.items,
        });
        await sourcing.audit(
          client,
          ctx,
          "RFX_RESPONSE_SUBMITTED",
          response.id,
          null,
          response,
          "rfx_response",
        );
        await notificationOutbox.enqueueNotification(client, {
          type: "RFX_RESPONSE_SUBMITTED",
          entityType: "rfx_response",
          entityId: response.id,
          payload: {
            rfxId: event.id,
            requestedItemIds: response.items.map((i) => i.requested_item_id),
            supplierId: supplier.id,
            actorId: ctx.actor.id,
          },
          idempotencyKey: `rfx-response-submitted:${response.id}`,
        });
        return response;
      },
    );
    res.status(201).json(result);
  } catch (error) {
    next(error);
  }
};

const listRfxResponses = async (req, res, next) => {
  try {
    const rows = await sourcing.transaction(
      req.user,
      { eventId: req.params.id },
      async (client, ctx) =>
        (
          await client.query(
            `SELECT resp.id,resp.rfx_id,resp.request_id,resp.supplier_id,resp.bid_amount,resp.notes,resp.response_data,resp.status,resp.created_at,s.name AS supplier_name
       FROM rfx_responses resp JOIN rfx_events e ON e.id=resp.rfx_id JOIN suppliers s ON s.id=resp.supplier_id
       WHERE resp.rfx_id=$1 AND ${sourcing.responsePredicate()} ORDER BY resp.created_at DESC`,
            [ctx.event.id],
          )
        ).rows,
    );
    res.json(rows);
  } catch (error) {
    next(error);
  }
};

const updateRfxStatus = async (req, res, next) => {
  const status = normalizeText(req.body?.status).toLowerCase();
  if (!["open", "closed", "cancelled", "draft"].includes(status))
    return next(
      createHttpError(
        400,
        "Use the canonical award command to record an award; otherwise choose open, closed, cancelled or draft",
      ),
    );
  try {
    const row = await sourcing.transaction(
      req.user,
      { eventId: req.params.id },
      async (client, ctx) => {
        const activePo = await client.query(
          "SELECT id FROM purchase_orders WHERE rfx_id=$1 AND status NOT IN ('PO_CANCELLED','CANCELLED') LIMIT 1",
          [ctx.event.id],
        );
        if (activePo.rowCount)
          throw createHttpError(
            409,
            "Resolve the existing purchase order through its canonical lifecycle before revising the RFx",
          );
        const updated = (
          await client.query(
            "UPDATE rfx_events SET status=$1,updated_at=NOW() WHERE id=$2 RETURNING *",
            [status, ctx.event.id],
          )
        ).rows[0];
        await sourcing.audit(
          client,
          ctx,
          "RFX_STATUS_CHANGED",
          updated.id,
          { status: ctx.event.status },
          { status: updated.status },
        );
        return updated;
      },
    );
    res.json(row);
  } catch (error) {
    next(error);
  }
};

const analyzeQuotations = async (req, res, next) => {
  const rfxId = Number(req.params.id);
  const quotations = Array.isArray(req.body?.quotations)
    ? req.body.quotations
    : [];

  if (!Number.isInteger(rfxId) || rfxId <= 0) {
    return next(createHttpError(400, "Invalid RFX id"));
  }

  if (quotations.length === 0) {
    return next(
      createHttpError(400, "Provide at least one quotation to analyze"),
    );
  }

  try {
    const result = await sourcing.transaction(
      req.user,
      { eventId: rfxId },
      async (client, ctx) => {
        const bidValues = quotations
          .map((quote) => normalizeBidAmount(quote?.bid_amount))
          .filter((value) => value !== null);
        const minBid = bidValues.length ? Math.min(...bidValues) : null;
        const maxBid = bidValues.length ? Math.max(...bidValues) : null;

        const weightedResults = quotations.map((quote, index) => {
          const supplierName =
            normalizeText(quote?.supplier_name) || `Supplier ${index + 1}`;
          const bidAmount = normalizeBidAmount(quote?.bid_amount);
          const safetyScore = clampScore(quote?.safety_score ?? quote?.safety);
          const valueScore = clampScore(quote?.value_score ?? quote?.value);
          const jciScore = clampScore(
            quote?.jci_score ??
              quote?.jci_compliance_score ??
              quote?.jci_compliance,
          );
          const deliveryScore = clampScore(
            quote?.delivery_score ?? quote?.delivery,
          );

          const priceScore = calculatePriceScore(bidAmount, minBid, maxBid);

          // Weighted formula tuned for price/value competitiveness with safety and JCI compliance
          const combinedScore =
            (priceScore ?? 0) * 0.3 +
            valueScore * 0.3 +
            safetyScore * 0.25 +
            jciScore * 0.1 +
            deliveryScore * 0.05;

          return {
            supplier_name: supplierName,
            bid_amount: bidAmount,
            safety_score: safetyScore,
            value_score: valueScore,
            jci_score: jciScore,
            delivery_score: deliveryScore,
            price_score: priceScore,
            composite_score: Number(combinedScore.toFixed(2)),
            notes: normalizeText(quote?.notes) || null,
          };
        });

        const rankings = weightedResults
          .sort((a, b) => b.composite_score - a.composite_score)
          .map((result, position) => ({ ...result, rank: position + 1 }));

        return {
          rfx_id: rfxId,
          evaluated_on: new Date().toISOString(),
          best_quotation: rankings[0],
          rankings,
        };
      },
    );
    res.json(result);
  } catch (err) {
    console.error("❌ Failed to analyze quotations:", err);
    next(err);
  }
};

const awardRfxResponse = async (req, res, next) => {
  const rfxId = Number(req.params.id);
  const responseIdRaw =
    req.body?.response_id ??
    req.body?.rfx_response_id ??
    req.body?.rfxResponseId;
  const poNumberInput = normalizeText(
    req.body?.po_number ?? req.body?.poNumber,
  );
  const awardNotes = normalizeText(req.body?.notes) || null;
  const responseId =
    responseIdRaw !== undefined && responseIdRaw !== null
      ? Number(responseIdRaw)
      : null;

  if (!Number.isInteger(rfxId) || rfxId <= 0) {
    return next(createHttpError(400, "Invalid RFX id"));
  }

  if (!Number.isInteger(responseId) || responseId <= 0) {
    return next(
      createHttpError(
        400,
        "Invalid response_id; select a valid supplier response to award",
      ),
    );
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const sourcingContext = await sourcing.authorize(client, req.user, {
      eventId: rfxId,
      responseId,
    });

    const responseRes = await client.query(
      `SELECT resp.id,
              resp.rfx_id,
              resp.request_id,
              resp.supplier_id,
              resp.bid_amount,
              resp.status AS response_status,
              evt.request_id AS event_request_id,
              evt.status AS event_status
         FROM rfx_responses resp
         JOIN rfx_events evt ON evt.id = resp.rfx_id
        WHERE resp.id = $1
          AND resp.rfx_id = $2
        FOR UPDATE`,
      [responseId, rfxId],
    );

    if (responseRes.rowCount === 0) {
      await client.query("ROLLBACK");
      return next(
        createHttpError(404, "RFX response not found for this event"),
      );
    }

    const responseRow = responseRes.rows[0];
    const requestId = sourcingContext.requestId;

    if (!requestId) {
      await client.query("ROLLBACK");
      return next(
        createHttpError(
          400,
          "RFX must be linked to a requisition before awarding a supplier",
        ),
      );
    }

    if (
      responseRow.event_status &&
      ["cancelled"].includes(responseRow.event_status.toLowerCase())
    ) {
      await client.query("ROLLBACK");
      return next(createHttpError(400, "Cannot award a cancelled RFX"));
    }

    const requestRes = await client.query(
      `SELECT id, status, sourcing_status, purchase_order_id
         FROM requests
        WHERE id = $1
        FOR UPDATE`,
      [requestId],
    );

    if (requestRes.rowCount === 0) {
      await client.query("ROLLBACK");
      return next(createHttpError(404, "Linked request not found"));
    }

    const financialActor = (
      await require("../services/p2pAuthorization").authorizeCommand(
        { client },
        req.user,
        "procure-to-pay.purchase-orders.manage",
        { requestId },
      )
    ).actor;

    if (
      !["submitted", "evaluated", "awarded", "po_created"].includes(
        String(responseRow.response_status).toLowerCase().replace(/ /g, "_"),
      )
    )
      throw createHttpError(409, "Quotation is not available for award");
    const existingPo = await client.query(
      `SELECT * FROM purchase_orders WHERE rfx_id = $1 AND rfx_response_id = $2 ORDER BY id LIMIT 1`,
      [rfxId, responseId],
    );

    if (existingPo.rowCount > 0) {
      await require("../services/p2pAuthorization").authorizeCommand(
        { client },
        financialActor,
        "procure-to-pay.purchase-orders.manage",
        { requestId, purchaseOrderId: existingPo.rows[0].id },
      );
      await client.query("COMMIT");
      return res.json({
        message: "Supplier award already recorded",
        rfx_id: rfxId,
        request_id: requestId,
        awarded_response_id: responseId,
        purchase_order: existingPo.rows[0],
        idempotent: true,
      });
    }

    // Award closes sibling bids too; validate every affected source before writing.
    const affectedResponses = await client.query(
      "SELECT id FROM rfx_responses WHERE rfx_id=$1 ORDER BY id",
      [rfxId],
    );
    for (const row of affectedResponses.rows)
      await sourcing.authorize(client, financialActor, {
        requestId,
        eventId: rfxId,
        responseId: row.id,
      });

    const itemResult = await client.query(
      `SELECT * FROM requested_items WHERE request_id=$1 ORDER BY id FOR UPDATE`,
      [requestId],
    );
    const responseItems = await client.query(
      `SELECT * FROM rfx_response_items WHERE rfx_response_id=$1 ORDER BY id`,
      [responseId],
    );
    const conflictingPo = await client.query(
      `SELECT po.* FROM purchase_orders po
        WHERE po.rfx_id = $1 AND po.rfx_response_id IS DISTINCT FROM $2
          AND po.status NOT IN ('PO_CANCELLED', 'CANCELLED')
        ORDER BY po.id LIMIT 1 FOR UPDATE`,
      [rfxId, responseId],
    );
    if (conflictingPo.rowCount) {
      throw Object.assign(
        createHttpError(
          409,
          "RFX already has a different canonical winning response",
        ),
        {
          code: "RFX_WINNER_CONFLICT",
        },
      );
    }
    const pricedItems = responseItems.rows.length
      ? priceNormalizedRfxResponse({
          responseItems: responseItems.rows,
          requestItems: itemResult.rows,
        })
      : priceAggregateRfxResponse({
          bidAmount: responseRow.bid_amount,
          requestItems: itemResult.rows,
          currency: "USD",
        });

    // The connected repository is bound to this RFx transaction.  Service-level
    // transactions therefore compose without opening an independent connection.
    const repository = createConnectedP2PRepository(client);
    repository.withTransaction = async (work) => work(repository);
    const actor = financialActor;
    const awards = [];
    for (const priced of pricedItems) {
      const award = await createAward({
        repository,
        requestItem: priced.requestItem,
        supplier: { id: responseRow.supplier_id },
        actor,
        input: {
          awarded_quantity: priced.quantity,
          unit_price: priced.unitPrice,
          currency: priced.currency,
          approved_product_id: priced.responseItem?.approved_product_id,
          supplier_catalog_item_id:
            priced.responseItem?.supplier_catalog_item_id,
          source_type: "QUOTATION",
          source_id: String(priced.sourceId || responseId),
          selection_reason: awardNotes || `Winning RFx response ${responseId}`,
          idempotency_key: `rfx:${rfxId}:response:${responseId}:item:${priced.requestItem.id}`,
        },
      });
      awards.push(award);
      await repository.linkDocuments(
        requestId,
        "RFX_EVENT",
        rfxId,
        "AWARD",
        award.id,
        actor.id,
      );
      await repository.linkDocuments(
        requestId,
        "RFX_RESPONSE",
        responseId,
        "AWARD",
        award.id,
        actor.id,
      );
    }
    const poRow = await createPurchaseOrderFromAwards({
      repository,
      awardIds: awards.map((award) => award.id),
      actor,
      input: {
        rfx_id: rfxId,
        rfx_response_id: responseId,
        po_number: poNumberInput || undefined,
        notes: awardNotes,
      },
    });

    await client.query(
      `UPDATE rfx_responses
          SET status = CASE WHEN id = $1 THEN 'awarded' ELSE 'closed' END
        WHERE rfx_id = $2`,
      [responseId, rfxId],
    );

    await client.query(
      `UPDATE rfx_events
          SET status = 'awarded',
              updated_at = NOW(),
              request_id = COALESCE(request_id, $2)
        WHERE id = $1`,
      [rfxId, requestId],
    );

    const requestUpdate = await client.query(
      `UPDATE requests
          SET awarded_supplier_id = $1,
              awarded_rfx_id = $2,
              awarded_rfx_response_id = $3,
              purchase_order_id = $4,
              purchase_order_number = $5,
              sourcing_status = 'awarded',
              awarded_at = COALESCE(awarded_at, NOW()),
              po_issued_at = NULL
        WHERE id = $6
        RETURNING id, status, sourcing_status, purchase_order_id, purchase_order_number, awarded_supplier_id`,
      [
        responseRow.supplier_id,
        rfxId,
        responseId,
        poRow.id,
        poRow.po_number,
        requestId,
      ],
    );

    await client.query(
      `INSERT INTO request_logs (request_id, action, actor_id, comments)
       VALUES ($1, 'RFX Awarded', $2, $3)`,
      [
        requestId,
        req.user?.id || null,
        `Awarded supplier response ${responseId} with PO ${poRow.po_number}`,
      ],
    );

    await sourcing.audit(
      client,
      sourcingContext,
      "RFX_AWARDED",
      rfxId,
      { status: sourcingContext.event.status },
      {
        status: "awarded",
        response_id: responseId,
        supplier_id: responseRow.supplier_id,
        purchase_order_id: poRow.id,
      },
    );

    await client.query("COMMIT");

    res.json({
      message: "Supplier awarded and canonical purchase order draft created",
      rfx_id: rfxId,
      request_id: requestId,
      awarded_response_id: responseId,
      purchase_order: poRow,
      request: requestUpdate.rows[0],
    });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("❌ Failed to award RFX response:", err);
    next(
      err.statusCode || err.status
        ? err
        : createHttpError(
            500,
            "Failed to award supplier and create purchase order draft",
          ),
    );
  } finally {
    client.release();
  }
};

module.exports = {
  listRfxEvents,
  createRfxEvent,
  submitRfxResponse,
  listRfxResponses,
  updateRfxStatus,
  analyzeQuotations,
  awardRfxResponse,
  listValidOfferings,
};
