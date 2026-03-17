# Procure-to-Pay API Examples

Base path: `/api/procure-to-pay`

## 1) Create goods receipt
`POST /requests/:requestId/receipts`
```json
{
  "warehouse_location": "Main Warehouse A",
  "received_at": "2026-03-12T10:30:00Z",
  "discrepancy_notes": "1 unit damaged",
  "items": [
    {
      "requested_item_id": 91,
      "item_name": "Infusion Pump",
      "ordered_quantity": 10,
      "received_quantity": 9,
      "damaged_quantity": 1,
      "short_quantity": 0,
      "unit_price": 1200
    }
  ]
}
```

## 2) List receipts by request
`GET /requests/:requestId/receipts`

## 3) Submit invoice
`POST /requests/:requestId/invoices`
```json
{
  "supplier": "MediSupply LLC",
  "invoice_number": "MS-INV-9044",
  "invoice_date": "2026-03-11",
  "subtotal_amount": 10800,
  "tax_amount": 540,
  "extra_charges": 120,
  "total_amount": 11460,
  "currency": "USD",
  "po_equivalent_number": "POE-3001",
  "receipt_id": 14,
  "attachment_metadata": {
    "file_name": "MS-INV-9044.pdf"
  },
  "items": [
    { "requested_item_id": 91, "description": "Infusion Pump", "quantity": 9, "unit_price": 1200, "line_total": 10800 }
  ]
}
```

## 4) Run invoice match
`POST /requests/:requestId/invoices/:invoiceId/match`
```json
{ "policy": "THREE_WAY" }
```

## 5) Approve override for mismatch
`POST /requests/:requestId/match-results/:matchResultId/override`
```json
{ "reason": "Approved by finance approver due to urgent patient care requirement" }
```

## 6) Create AP voucher
`POST /requests/:requestId/vouchers`
```json
{
  "supplier_invoice_id": 22,
  "total_amount": 11460,
  "currency": "USD",
  "lines": [
    { "account_code": "510100", "description": "Medical Equipment Expense", "debit_amount": 10800, "credit_amount": 0 },
    { "account_code": "210200", "description": "Accounts Payable", "debit_amount": 0, "credit_amount": 11460 }
  ]
}
```

## 7) Verify finance record
`POST /requests/:requestId/verify`
```json
{}
```

## 8) Post to internal ledger state
`POST /requests/:requestId/post-ledger`
```json
{
  "ap_voucher_id": 11,
  "liability_recognized_amount": 11460,
  "posting_reference": "POST-2026-0013"
}
```

## 9) Mark payment pending
`POST /requests/:requestId/payment-pending`
```json
{ "ap_voucher_id": 11, "payment_reference": "PAY-BATCH-44" }
```

## 10) Mark paid
`POST /requests/:requestId/payments/:paymentId/paid`
```json
{ "amount_paid": 11460, "payment_method": "Bank Transfer", "payment_reference": "TRX-992121" }
```

## Run/test checklist
1. Run migration SQL in `purchase-backend/sql/migrations/20260312_procure_to_pay.sql`.
2. Restart backend so route `/api/procure-to-pay/*` is active.
3. Ensure required permissions exist in `permissions` table and assign to users.
4. Open frontend route `/requests/{id}/procure-to-pay`.
5. Test sequence: receipt -> invoice -> match -> override (if mismatch) -> verify -> voucher -> post -> payment pending -> paid.