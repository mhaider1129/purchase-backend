"use strict";
// Compatibility status labels are distinct from authoritative fulfillment flags.
const projectionSql = (request = "r") =>
  `public.canonical_procurement_completion(${request}.id,${request}.institute_id,NULL)`;
const itemProjectionSql = (item = "ri") =>
  `(SELECT completion_item FROM jsonb_array_elements(public.canonical_procurement_completion(${item}.request_id,(SELECT completion_parent.institute_id FROM requests completion_parent WHERE completion_parent.id=${item}.request_id),${item}.id)->'items') completion_item WHERE completion_item->>'requested_item_id'=${item}.id::text LIMIT 1)`;
const stockItemSql = (item = "ri") =>
  `COALESCE((${itemProjectionSql(item)}->>'stock_resolved')::boolean,false)`;
const fulfilledItemSql = (item = "ri") =>
  `COALESCE((${itemProjectionSql(item)}->>'fulfillment_complete')::boolean,false)`;
const stockResolvedRequestSql = (request = "r") =>
  `(${request}.request_type<>'Warehouse Supply' AND COALESCE((${projectionSql(request)}->>'stock_resolved')::boolean,false))`;
const effectiveRequestStatusSql = (request = "r") => `(CASE
 WHEN lower(trim(${request}.status)) IN ('completed','received','closed','rejected','cancelled','canceled','available in stock','available_in_stock') THEN ${request}.status
 WHEN ${stockResolvedRequestSql(request)} THEN 'Available in Stock'
 WHEN COALESCE((${projectionSql(request)}->>'fulfillment_complete')::boolean,false) THEN 'Completed'
 ELSE ${request}.status END)`;
// Existing operational archive/queue contract. Never use this to authorize fulfillment.
const completedRequestSql = (request = "r") =>
  `lower(trim(${effectiveRequestStatusSql(request)})) IN ('completed','received','available in stock')`;
const fullyFulfilledRequestSql = (request = "r") =>
  `COALESCE((${projectionSql(request)}->>'fulfillment_complete')::boolean,false)`;
module.exports = {
  projectionSql,
  itemProjectionSql,
  stockItemSql,
  fulfilledItemSql,
  stockResolvedRequestSql,
  effectiveRequestStatusSql,
  completedRequestSql,
  fullyFulfilledRequestSql,
};
