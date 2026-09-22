jest.mock('../config/db', () => ({ query: jest.fn() }));

const pool = require('../config/db');
const { updateDepartment, updateSection } = require('../controllers/departmentsController');

const response = () => {
  const res = {};
  res.status = jest.fn(() => res);
  res.json = jest.fn(() => res);
  return res;
};

describe('department management updates', () => {
  beforeEach(() => jest.clearAllMocks());

  test('updates a department inside the current institute', async () => {
    pool.query.mockResolvedValue({ rows: [{ id: 4, name: 'Clinical Operations', type: 'Medical' }] });
    const req = {
      params: { id: '4' },
      body: { name: ' Clinical Operations ', type: 'medical' },
      user: { institute_id: 12, hasPermission: jest.fn(() => true) },
    };
    const res = response();

    await updateDepartment(req, res);

    expect(pool.query).toHaveBeenCalledWith(expect.stringContaining('institute_id = $4'), [
      'Clinical Operations', 'Medical', 4, 12,
    ]);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ name: 'Clinical Operations' }));
  });

  test('updates a section only through a department in the current institute', async () => {
    pool.query.mockResolvedValue({ rows: [{ id: 8, department_id: 4, name: 'Diagnostics' }] });
    const req = {
      params: { id: '4', sectionId: '8' },
      body: { name: ' Diagnostics ' },
      user: { institute_id: 12, hasPermission: jest.fn(() => true) },
    };
    const res = response();

    await updateSection(req, res);

    expect(pool.query).toHaveBeenCalledWith(expect.stringContaining('d.institute_id = $4'), [
      'Diagnostics', 8, 4, 12,
    ]);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ name: 'Diagnostics' }));
  });

  test('rejects edits without department management permission', async () => {
    const req = { params: { id: '4' }, body: {}, user: { hasPermission: jest.fn(() => false) } };
    const res = response();

    await updateDepartment(req, res);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(pool.query).not.toHaveBeenCalled();
  });
});