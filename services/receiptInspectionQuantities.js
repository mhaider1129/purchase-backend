"use strict";
// JSON field reads preserve compatibility before optional SQL 054 is installed.
const required = (a = "gri") =>
  `COALESCE((to_jsonb(${a})->>'technical_inspection_required')::boolean,false)`;
const accepted = (a = "gri") =>
  `CASE WHEN ${required(a)} THEN COALESCE((to_jsonb(${a})->>'technical_accepted_quantity')::numeric,0) ELSE ${a}.received_quantity-${a}.damaged_quantity-${a}.short_quantity END`;
const capacity = (a = "gri") =>
  `${a}.received_quantity-${a}.damaged_quantity-${a}.short_quantity-CASE WHEN ${required(a)} THEN COALESCE((to_jsonb(${a})->>'technical_rejected_quantity')::numeric,0) ELSE 0 END`;
module.exports = { required, accepted, capacity };
