# Inventory allocation policy

Outbound allocation is FEFO: earliest expiry first, `NULL` expiry last, then balance ID. Only positive AVAILABLE balances with unreserved quantity are issuable. Explicit batch, lot, serial and expiry selections constrain candidates. A serial-controlled item must have an exact serial selection; however, the present item master has no reliable canonical serial/batch/expiry policy fields, so code must not infer control from a populated serial alone. Adding explicit tracking-policy master data is deferred.

All coordinators lock in this order: (1) business document, (2) warehouse, (3) item, (4) canonical balance rows ordered by expiry and ID. Transfers and status changes preserve allocation snapshots rather than coalescing tracking identities.