# Invoice match tolerance policy

No authoritative tolerance configuration exists. Phase 4C uses **exact matching** for price, cumulative ordered/accepted quantity, and cumulative value with scaled decimal arithmetic. Callers cannot select weaker policy or submit tolerance values; no implicit 2%, 5%, or absolute allowance exists.

Exceptions progress only through `finance.override-mismatch`, with explicit reason, actor, timestamp, decision, and preserved original variances. Future tolerance support requires an approved, versioned configuration recorded on every immutable match result.