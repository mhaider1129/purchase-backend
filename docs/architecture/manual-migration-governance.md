# Manual migration governance

Numbered manual migrations are an execution record, not a rolling description of the desired schema.

**Do not modify numbered migrations after production execution. Create a new forward migration.** Pending migrations may be corrected or strengthened during review, up to the point at which they are executed. Once executed in production, their contents are immutable.

## Current project assumption

Based on the deployment state confirmed for this review, migrations 001 through 006 are deployed, 007 is diagnostic only, and 008, 009, and 010 are pending manual execution. This is an operational assumption rather than an automated database discovery; update this statement when an operator confirms a later deployment. Never infer production state by connecting from a test or development workflow.

Regression tests protect the known deployed boundary by asserting that migration 006 does not acquire the Goods Receipt `conversion_factor` change owned by pending migration 009. SQL 010 separately fails closed when its namespace is already populated, distinguishing a complete application from a partial or drifted schema.