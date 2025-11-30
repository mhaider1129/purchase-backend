jest.mock('../config/db', () => ({
  query: jest.fn(),
}));

const pool = require('../config/db');
const {
  getRoles,
  createRole,
  updateRole,
  deleteRole,
} = require('../controllers/rolesController');

const buildRes = () => {
  const res = {};
  res.status = jest.fn(() => res);
  res.json = jest.fn(() => res);
  res.status = res.status.bind(res);
  res.json = res.json.bind(res);
  res.send = jest.fn(() => res);
  return res;
};

describe('rolesController', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('getRoles', () => {
    it('rejects requests without management permissions', async () => {
      const req = {
        user: {
          hasAnyPermission: jest.fn(() => false),
        },
      };

      const res = buildRes();

      await getRoles(req, res);

      expect(res.status).toHaveBeenCalledWith(403);
      expect(res.json).toHaveBeenCalledWith({
        message: 'You do not have permission to manage roles',
      });
      expect(pool.query).not.toHaveBeenCalled();
    });

    it('returns stored roles when user can manage', async () => {
      const req = {
        user: {
          hasAnyPermission: jest.fn(() => true),
        },
      };

      const res = buildRes();

      pool.query.mockResolvedValueOnce({
        rows: [
          { id: 1, name: 'Admin' },
          { id: 2, name: 'Technician' },
        ],
      });

      await getRoles(req, res);

      expect(pool.query).toHaveBeenCalledWith('SELECT id, name FROM roles ORDER BY name');
      expect(res.json).toHaveBeenCalledWith([
        { id: 1, name: 'Admin' },
        { id: 2, name: 'Technician' },
      ]);
    });
  });

  describe('createRole', () => {
    it('returns forbidden when user cannot manage roles', async () => {
      const req = {
        body: { name: 'Observer' },
        user: {
          hasAnyPermission: jest.fn(() => false),
        },
      };

      const res = buildRes();

      await createRole(req, res);

      expect(res.status).toHaveBeenCalledWith(403);
      expect(pool.query).not.toHaveBeenCalled();
    });

    it('creates a role when authorized', async () => {
      const req = {
        body: { name: 'Observer' },
        user: {
          hasAnyPermission: jest.fn(() => true),
        },
      };

      const res = buildRes();

      pool.query.mockResolvedValueOnce({ rows: [{ id: 9, name: 'Observer' }] });

      await createRole(req, res);

      expect(pool.query).toHaveBeenCalledWith(
        'INSERT INTO roles (name) VALUES ($1) RETURNING id, name',
        ['Observer']
      );
      expect(res.status).toHaveBeenCalledWith(201);
      expect(res.json).toHaveBeenCalledWith({ id: 9, name: 'Observer' });
    });
  });

  describe('updateRole', () => {
    it('denies updates when the user lacks permission', async () => {
      const req = {
        params: { id: '5' },
        body: { name: 'Reader' },
        user: {
          hasAnyPermission: jest.fn(() => false),
        },
      };

      const res = buildRes();

      await updateRole(req, res);

      expect(res.status).toHaveBeenCalledWith(403);
      expect(pool.query).not.toHaveBeenCalled();
    });

    it('updates a role when permitted', async () => {
      const req = {
        params: { id: '3' },
        body: { name: 'Lead Reviewer' },
        user: {
          hasAnyPermission: jest.fn(() => true),
        },
      };

      const res = buildRes();

      pool.query.mockResolvedValueOnce({ rows: [{ id: 3, name: 'Lead Reviewer' }] });

      await updateRole(req, res);

      expect(pool.query).toHaveBeenCalledWith(
        'UPDATE roles SET name = $1 WHERE id = $2 RETURNING id, name',
        ['Lead Reviewer', '3']
      );
      expect(res.json).toHaveBeenCalledWith({ id: 3, name: 'Lead Reviewer' });
    });
  });

  describe('deleteRole', () => {
    it('returns 403 when the requester cannot manage roles', async () => {
      const req = {
        params: { id: '7' },
        user: {
          hasAnyPermission: jest.fn(() => false),
        },
      };

      const res = buildRes();

      await deleteRole(req, res);

      expect(res.status).toHaveBeenCalledWith(403);
      expect(pool.query).not.toHaveBeenCalled();
    });

    it('deletes a role when authorized', async () => {
      const req = {
        params: { id: '7' },
        user: {
          hasAnyPermission: jest.fn(() => true),
        },
      };

      const res = buildRes();

      pool.query.mockResolvedValueOnce({ rowCount: 1 });

      await deleteRole(req, res);

      expect(pool.query).toHaveBeenCalledWith('DELETE FROM roles WHERE id = $1', ['7']);
      expect(res.status).toHaveBeenCalledWith(204);
      expect(res.send).toHaveBeenCalled();
    });
  });
});