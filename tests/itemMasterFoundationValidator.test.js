const validator = require('../validators/itemMasterFoundationValidator');

describe('item master foundation validation', () => {
  const validGeneric = {
    item_code: ' med-001 ', generic_name: 'Sodium Chloride 0.9%',
    canonical_description: 'Sodium chloride intravenous solution, 0.9%, 500 mL',
    category: 'Medication', item_type: 'medication', base_uom: 'bag', inventory_uom: 'bag',
    specification: { strength: '0.9%', volume_ml: 500 },
  };

  test('normalizes generic identity and creates a stable structured fingerprint', () => {
    const first = validator.genericItem(validGeneric);
    const second = validator.genericItem({ ...validGeneric, item_code: 'MED-002' });
    expect(first.item_code).toBe('MED-001');
    expect(first.base_uom).toBe('BAG');
    expect(first.structured_fingerprint).toBe(second.structured_fingerprint);
  });

  test('forces proprietary items to proprietary interchangeability', () => {
    const item = validator.genericItem({ ...validGeneric, is_proprietary: true, interchangeability_policy: 'fully_interchangeable' });
    expect(item.interchangeability_policy).toBe('proprietary');
  });

  test('rejects invalid interchangeability policies', () => {
    expect(() => validator.genericItem({ ...validGeneric, interchangeability_policy: 'looks_similar' }))
      .toThrow('interchangeability_policy is invalid');
  });

  test('validates pending items without creating master data', () => {
    expect(validator.pending({ proposed_name: 'Special catheter', item_type: 'medical_supply', intended_use: 'ICU', justification: 'No equivalent found' }))
      .toMatchObject({ proposed_name: 'Special catheter', requested_quantity: null });
  });
});