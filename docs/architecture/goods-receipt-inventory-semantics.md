# Goods receipt inventory quantity semantics

## Repository evidence

`goods_receipt_items` persists `ordered_quantity`, `received_quantity`,
`damaged_quantity`, and `short_quantity`. It has no `accepted_quantity` or
`rejected_quantity` column. The receipt controller uses the same net quantity for purchase-order
receipt progress, warehouse inventory, and receipt valuation.

## Canonical formula

For a persisted goods-receipt line:

```text
inventory accepted quantity = received_quantity - damaged_quantity - short_quantity
```

`received_quantity` is therefore gross physically reported receipt quantity. Damage and shortage
are separate additive discrepancy deductions. `short_quantity` describes the ordered quantity not
received and is not an additional received quantity. `ordered_quantity` is contextual and is not
added to the inventory quantity. There is no persisted rejected quantity.

The adapter also accepts `accepted_quantity` from an already-normalized internal caller. Because
that value is final, it is posted directly and discrepancies are not deducted a second time. Zero
or negative net quantities do not produce inventory movements.