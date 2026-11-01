-- MANUAL DATABASE MIGRATION REQUIRED. Review and apply manually in Development
-- first. No automated role or user grants; existing financial writers unchanged.
BEGIN;
INSERT INTO public.permissions(code,name,description)
VALUES ('finance.budget.manage','Manage financial budgets',
 'Configure budget envelopes within the actor institute; no posting, payment or cross-institute authority.')
ON CONFLICT(code) DO NOTHING;
COMMIT;
-- Grant this capability only through reviewed existing permission management.
-- Budget viewers continue to require procure-to-pay.lifecycle.view.
-- This file does not change Approval Engine V2 or LIVE_ROUTING_ENABLED.
