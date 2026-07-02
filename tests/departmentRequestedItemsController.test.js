const { buildWhereClause, groupRows } = require('../controllers/departmentRequestedItemsController');

describe('departmentRequestedItemsController helpers', () => {
  test('SCM can build an unrestricted open-items filter', () => {
    const result = buildWhereClause({ department_id: '4', section_id: '8' }, { role: 'SCM' });

    expect(result.forbidden).toBeUndefined();
    expect(result.whereSql).toContain('r.department_id');
    expect(result.whereSql).toContain('r.section_id');
    expect(result.whereSql).toContain('ri.procurement_status');
    expect(result.whereSql).toContain('GREATEST');
  });

  test('HOD scope is limited to their department', () => {
    const result = buildWhereClause({}, { role: 'HOD', department_id: 12 });

    expect(result.whereSql).toContain('r.department_id = $1');
    expect(result.values[0]).toBe(12);
  });

  test('Requester scope is limited to their department and section', () => {
    const result = buildWhereClause({}, { role: 'Requester', department_id: 12, section_id: 3 });

    expect(result.whereSql).toContain('r.department_id = $1');
    expect(result.whereSql).toContain('r.section_id = $2');
    expect(result.values.slice(0, 2)).toEqual([12, 3]);
  });

  test('Requester scope supports multiple assigned sections', () => {
    const result = buildWhereClause({}, {
      role: 'Requester',
      department_id: 12,
      section_id: 3,
      assigned_section_ids: [3, 4, 5],
    });

    expect(result.whereSql).toContain('r.section_id = ANY($2::int[])');
    expect(result.values.slice(0, 2)).toEqual([12, [3, 4, 5]]);
  });

  test('unsupported roles are forbidden', () => {
    const result = buildWhereClause({}, { role: 'Finance' });

    expect(result.forbidden).toBe(true);
  });

  test('groupRows returns department aggregates with counts', () => {
    const rows = [
      { item_id: 1, department_id: 10, department_name: 'Laboratory', overdue_flag: true, emergency_flag: false, partially_procured_flag: true, request_date: '2026-06-01' },
      { item_id: 2, department_id: 10, department_name: 'Laboratory', overdue_flag: false, emergency_flag: true, partially_procured_flag: false, request_date: '2026-06-05' },
    ];

    const grouped = groupRows(rows, 'department');

    expect(grouped).toHaveLength(1);
    expect(grouped[0].open_items_count).toBe(2);
    expect(grouped[0].overdue_count).toBe(1);
    expect(grouped[0].emergency_count).toBe(1);
    expect(grouped[0].partially_procured_count).toBe(1);
  });
});