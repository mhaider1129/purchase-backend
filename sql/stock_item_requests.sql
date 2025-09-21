-- Schema for stock item requests with approval workflow

CREATE TABLE IF NOT EXISTS public.stock_item_requests (
  id BIGSERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  unit TEXT,
  requested_by UUID REFERENCES users(id),
  status TEXT CHECK (status IN ('pending','approved','rejected')) DEFAULT 'pending',
  approved_by UUID REFERENCES users(id),
  inserted_at TIMESTAMPTZ DEFAULT now()
);

-- Trigger to push approved requests into stock_items
CREATE OR REPLACE FUNCTION public.approve_stock_item_request()
RETURNS trigger AS $$
BEGIN
  IF NEW.status = 'approved' AND OLD.status = 'pending' THEN
    INSERT INTO public.stock_items(name, description, unit, created_by)
    VALUES (NEW.name, NEW.description, NEW.unit, NEW.requested_by);
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_approve_stock_item_request
AFTER UPDATE ON public.stock_item_requests
FOR EACH ROW
EXECUTE FUNCTION public.approve_stock_item_request();