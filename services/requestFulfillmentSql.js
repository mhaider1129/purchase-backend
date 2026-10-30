'use strict';
// SQL aliases/expressions are supplied by backend code, never request input.
const normalized = expression => `LOWER(TRIM(COALESCE(${expression},'')))`;
const stockStates = "('available in stock','available_in_stock','in stock','in_stock')";
const stockItemSql = (item='ri') => `(${normalized(`${item}.approval_status`)} IN ${stockStates}
  OR ${normalized(`${item}.procurement_status`)} IN ${stockStates}
  OR (${normalized(`${item}.approval_status`)}='rejected' AND EXISTS (
    SELECT 1 FROM public.warehouse_supply_items fulfillment_wsi WHERE fulfillment_wsi.requested_item_id=${item}.id)))`;
const fulfilledItemSql = (item='ri') => `(${stockItemSql(item)}
  OR ${normalized(`${item}.procurement_status`)} IN ('purchased','completed','received','fulfilled')
  OR (COALESCE(${item}.quantity,0)>0 AND GREATEST(COALESCE(${item}.purchased_quantity,0),COALESCE(${item}.received_quantity,0))>=${item}.quantity))`;
const stockResolvedRequestSql = (request='r') => `(EXISTS (SELECT 1 FROM public.requested_items fulfillment_ri WHERE fulfillment_ri.request_id=${request}.id AND ${stockItemSql('fulfillment_ri')})
  AND NOT EXISTS (SELECT 1 FROM public.requested_items fulfillment_ri WHERE fulfillment_ri.request_id=${request}.id AND NOT ${fulfilledItemSql('fulfillment_ri')}))`;
const effectiveRequestStatusSql = (request='r') => `(CASE
  WHEN ${normalized(`${request}.status`)} IN ${stockStates} THEN 'Available in Stock'
  WHEN ${normalized(`${request}.status`)} IN ('completed','received','closed','delivered','rejected','cancelled','canceled') THEN ${request}.status
  WHEN ${stockResolvedRequestSql(request)} THEN CASE
    WHEN NOT EXISTS (SELECT 1 FROM public.requested_items fulfillment_ri WHERE fulfillment_ri.request_id=${request}.id AND NOT ${stockItemSql('fulfillment_ri')}) THEN 'Available in Stock'
    ELSE 'Completed' END
  ELSE ${request}.status END)`;
const completedRequestSql = (request='r') => `LOWER(TRIM(${effectiveRequestStatusSql(request)})) IN ('completed','received','available in stock')`;
module.exports={stockItemSql,fulfilledItemSql,stockResolvedRequestSql,effectiveRequestStatusSql,completedRequestSql};
