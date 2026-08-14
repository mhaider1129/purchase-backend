-- Permission definitions only; role assignment remains governed separately.
INSERT INTO permissions (code, name, description)
VALUES
 ('item-master.approve','Approve generic items','Activate governed Generic Items after validation and duplicate review.'),
 ('item-master.references-maintain','Maintain item references','Create and deactivate canonical Category, Manufacturer and UOM references.')
ON CONFLICT (code) DO UPDATE SET name=EXCLUDED.name,description=EXCLUDED.description;