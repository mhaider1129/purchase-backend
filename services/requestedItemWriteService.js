"use strict";

const createHttpError = require("../utils/httpError");
const {
  IDENTITY_FIELDS,
  normalizeNewRequestItem,
  auditItemMaster,
} = require("./procurementItemIdentityService");

const EDIT_FIELDS = Object.freeze([
  "item_name",
  "brand",
  "quantity",
  "unit_cost",
  "total_cost",
  "available_quantity",
  "intended_use",
  "specs",
  "unit_of_measure",
  "device_info",
  "purchase_type",
  ...IDENTITY_FIELDS,
]);
const pick = (item, fields) =>
  Object.fromEntries(
    fields
      .filter((key) => Object.hasOwn(item, key))
      .map((key) => [key, item[key]]),
  );
const comparable = (key, value) => {
  if (value == null || value === "") return "";
  if (key === "required_date")
    return value instanceof Date
      ? value.toISOString().slice(0, 10)
      : String(value).slice(0, 10);
  return typeof value === "object" ? JSON.stringify(value) : String(value);
};
const CONNECTED_REFERENCES = Object.freeze({
  purchase_order_items: "requested_item_id",
  procurement_awards: "request_item_id",
  rfx_response_items: "requested_item_id",
  goods_receipt_items: "requested_item_id",
  invoice_items: "requested_item_id",
  procurement_item_events: "requested_item_id",
});

async function assertLineNotConsumed(client, id) {
  const relations = (
    await client.query(
      `SELECT name,to_regclass('public.'||name) AS relation FROM unnest($1::text[],$2::text[]) AS refs(name,column_name)
      WHERE EXISTS(SELECT 1 FROM pg_attribute WHERE attrelid=to_regclass('public.'||name)
        AND attname=refs.column_name AND NOT attisdropped)`,
      [Object.keys(CONNECTED_REFERENCES), Object.values(CONNECTED_REFERENCES)],
    )
  ).rows;
  for (const row of relations) {
    const column = CONNECTED_REFERENCES[row.name];
    if (!row.relation || !column) continue;
    const result = await client.query(
      `SELECT 1 FROM public.${row.name} WHERE ${column}=$1 LIMIT 1`,
      [id],
    );
    if (result.rows.length)
      throw Object.assign(
        createHttpError(
          409,
          "This requested item has downstream procurement records; use the governed revision workflow",
        ),
        { code: "REQUEST_ITEM_ALREADY_CONSUMED" },
      );
  }
}

async function insertRequestedItem(
  client,
  requestId,
  raw,
  actor,
  { historical = false } = {},
) {
  // Historical imports stay unclassified. Never infer approval from their age.
  const item = historical
    ? { ...raw, request_mode: null, catalog_status: null }
    : await normalizeNewRequestItem(client, raw, actor);
  const columns = EDIT_FIELDS;
  const values = [requestId, ...columns.map((key) => item[key] ?? null)];
  const result = await client.query(
    `INSERT INTO public.requested_items
    (request_id,${columns.join(",")}) VALUES (${values.map((_, i) => `$${i + 1}`).join(",")}) RETURNING *`,
    values,
  );
  const saved = result.rows[0];
  if (!historical)
    await recordNewIdentity(client, requestId, saved.id, item, actor);
  return saved;
}

async function recordNewIdentity(
  client,
  requestId,
  itemId,
  item,
  actor,
  context = {
    institute_id: actor?.institute_id,
    department_id: actor?.department_id,
  },
) {
  if (item.request_mode === "pending_item_creation") {
    const pending = item.pending_item || {};
    const referral = await client.query(
      `INSERT INTO public.pending_item_requests
      (request_id,requested_item_id,proposed_name,item_type,category,required_specifications,intended_use,
       requested_quantity,requested_uom,justification,requester_id)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id`,
      [
        requestId,
        itemId,
        String(pending.proposed_name || item.item_name).trim(),
        String(pending.item_type || item.item_type || "general_item").trim(),
        pending.category || null,
        pending.required_specifications || {},
        item.intended_use || pending.intended_use || "",
        item.quantity,
        item.unit_of_measure || pending.requested_uom || null,
        item.restriction_justification,
        actor.id,
      ],
    );
    await auditItemMaster(client, {
      entityType: "pending_item_request",
      entityId: referral.rows[0]?.id,
      action: "submitted",
      actorId: actor.id,
      reason: item.restriction_justification,
      requestId,
      requestedItemId: itemId,
      context,
      next: {
        proposed_name: pending.proposed_name || item.item_name,
        ...pick(item, IDENTITY_FIELDS),
      },
    });
  } else if (item.request_mode === "approved_free_text_exception") {
    await auditItemMaster(client, {
      entityType: "requested_item",
      entityId: itemId,
      action: "free_text_exception",
      actorId: actor.id,
      reason: item.restriction_justification,
      requestId,
      requestedItemId: itemId,
      context,
      next: pick(item, IDENTITY_FIELDS),
    });
  }
}

async function prepareRequestedItemEdits(client, requestId, items, actor) {
  const existing = (
    await client.query(
      "SELECT * FROM public.requested_items WHERE request_id=$1 ORDER BY id FOR UPDATE",
      [requestId],
    )
  ).rows;
  const byId = new Map(existing.map((item) => [Number(item.id), item]));
  const seen = new Set();
  const prepared = [];
  for (const input of items) {
    const rawId = input.id ?? input.item_id;
    if (rawId == null || rawId === "") {
      prepared.push(await normalizeNewRequestItem(client, input, actor));
      continue;
    }
    const id = Number(rawId);
    if (!Number.isInteger(id) || !byId.has(id) || seen.has(id)) {
      throw createHttpError(
        409,
        "Each existing item must have a unique ID belonging to this request",
      );
    }
    seen.add(id);
    const before = byId.get(id);
    const patch = pick(input, EDIT_FIELDS);
    const merged = { ...before, ...patch, id };
    if (
      EDIT_FIELDS.some(
        (key) =>
          Object.hasOwn(input, key) &&
          comparable(key, input[key]) !== comparable(key, before[key]),
      )
    ) {
      await assertLineNotConsumed(client, id);
    }
    const identityChanged = IDENTITY_FIELDS.filter(
      (key) =>
        ![
          "catalog_status",
          "item_name_snapshot",
          "canonical_description_snapshot",
        ].includes(key),
    ).some(
      (key) =>
        Object.hasOwn(input, key) &&
        comparable(key, input[key]) !== comparable(key, before[key]),
    );
    // Ordinary edits preserve legacy NULLs and prior approved exceptions. An
    // explicit identity change must pass the same contract as new demand.
    const item = identityChanged
      ? await normalizeNewRequestItem(client, merged, actor)
      : merged;
    if (!identityChanged)
      for (const key of IDENTITY_FIELDS) item[key] = before[key];
    prepared.push({
      ...pick(item, EDIT_FIELDS),
      id,
      identityChanged,
      ...(identityChanged && item.pending_item
        ? { pending_item: item.pending_item }
        : {}),
    });
  }
  if (existing.some((item) => !seen.has(Number(item.id)))) {
    throw Object.assign(
      createHttpError(
        409,
        "Existing lines cannot be removed or replaced by request editing; retain their IDs and use the controlled item cancellation workflow",
      ),
      { code: "REQUEST_ITEM_REMOVAL_REQUIRES_CONTROLLED_ACTION" },
    );
  }
  return prepared;
}

async function applyRequestedItemEdits(client, requestId, items, actor) {
  const prepared = await prepareRequestedItemEdits(
    client,
    requestId,
    items,
    actor,
  );
  const persisted = [];
  for (const item of prepared) {
    if (!item.id) {
      persisted.push(await insertRequestedItem(client, requestId, item, actor));
      continue;
    }
    persisted.push(item);
    const fields = EDIT_FIELDS;
    await client.query(
      `UPDATE public.requested_items SET ${fields.map((key, i) => `${key}=$${i + 3}`).join(",")}
      WHERE id=$1 AND request_id=$2`,
      [item.id, requestId, ...fields.map((key) => item[key] ?? null)],
    );
    if (item.identityChanged && item.request_mode === "pending_item_creation") {
      const active = await client.query(
        `SELECT id FROM public.pending_item_requests WHERE requested_item_id=$1
        AND status IN ('submitted','review','needs_information') FOR UPDATE`,
        [item.id],
      );
      if (!active.rows.length)
        await recordNewIdentity(client, requestId, item.id, item, actor);
    }
    await auditItemMaster(client, {
      entityType: "requested_item",
      entityId: item.id,
      action: item.identityChanged
        ? "edited.identity_changed"
        : "edited.identity_preserved",
      actorId: actor.id,
      requestId,
      requestedItemId: item.id,
      next: pick(item, IDENTITY_FIELDS),
    });
  }
  return persisted;
}

module.exports = {
  assertLineNotConsumed,
  EDIT_FIELDS,
  insertRequestedItem,
  recordNewIdentity,
  prepareRequestedItemEdits,
  applyRequestedItemEdits,
};
