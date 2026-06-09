CREATE TABLE IF NOT EXISTS public.procurement_item_events (
  id SERIAL PRIMARY KEY,
  request_id INTEGER NOT NULL REFERENCES public.requests(id) ON DELETE CASCADE,
  requested_item_id INTEGER NOT NULL REFERENCES public.requested_items(id) ON DELETE CASCADE,
  procurement_user_id INTEGER NOT NULL REFERENCES public.users(id),
  event_quantity INTEGER NOT NULL,
  previous_purchased_quantity INTEGER NOT NULL DEFAULT 0,
  new_purchased_quantity INTEGER NOT NULL,
  remaining_quantity INTEGER NOT NULL,
  unit_cost NUMERIC(14,2) NULL,
  total_cost NUMERIC(14,2) NULL,
  supplier_id INTEGER NULL REFERENCES public.suppliers(id),
  supplier_name TEXT NULL,
  procurement_note TEXT NULL,
  procurement_date DATE DEFAULT CURRENT_DATE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_procurement_item_events_request_id
  ON public.procurement_item_events(request_id);

CREATE INDEX IF NOT EXISTS idx_procurement_item_events_requested_item_id
  ON public.procurement_item_events(requested_item_id);

CREATE INDEX IF NOT EXISTS idx_procurement_item_events_procurement_user_id
  ON public.procurement_item_events(procurement_user_id);

CREATE INDEX IF NOT EXISTS idx_procurement_item_events_procurement_date
  ON public.procurement_item_events(procurement_date);