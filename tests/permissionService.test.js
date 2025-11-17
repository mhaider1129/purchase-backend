jest.mock('../config/db', () => ({
  query: jest.fn(),
  connect: jest.fn(),
}));

const pool = require('../config/db');
const {
  getDefaultPermissionsForRole,
  applyDefaultRolePermissions,
} = require('../utils/permissionService');

describe('permissionService defaults', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('getDefaultPermissionsForRole', () => {
    it('returns normalized defaults for known roles', () => {
      const scmDefaults = getDefaultPermissionsForRole('SCM');
      expect(scmDefaults).toContain('requests.view-all');
      expect(scmDefaults.every(code => code === code.toLowerCase())).toBe(true);

      const unknownDefaults = getDefaultPermissionsForRole('unknown-role');
      expect(unknownDefaults).toEqual([]);
    });
  });

  describe('applyDefaultRolePermissions', () => {
    it('returns no-defaults when role has no defaults', async () => {
      const result = await applyDefaultRolePermissions(5, 'unknown-role');
      expect(result).toEqual({ applied: false, reason: 'no-defaults', missing: [] });
      expect(pool.connect).not.toHaveBeenCalled();
    });

    it('skips applying when permissions already exist', async () => {
      const client = { query: jest.fn() };
      client.query.mockResolvedValueOnce({ rowCount: 1 });

      const result = await applyDefaultRolePermissions(7, 'SCM', {
        client,
        skipIfExists: true,
      });

      expect(client.query).toHaveBeenCalledWith(
        'SELECT 1 FROM user_permissions WHERE user_id = $1 LIMIT 1',
        [7]
      );
      expect(result).toEqual({ applied: false, reason: 'existing-permissions', missing: [] });
      expect(client.query).toHaveBeenCalledTimes(1);
    });

    it('applies defaults when requested with replaceExisting', async () => {
      const client = { query: jest.fn() };
      const deleteResult = Promise.resolve({ rowCount: 1 });
      const selectResult = Promise.resolve({
        rows: [
          { id: 11, code: 'requests.view-incomplete' },
          { id: 12, code: 'requests.view-audit' },
        ],
      });
      const insertResult = Promise.resolve({ rowCount: 2 });

      client.query
        .mockReturnValueOnce(deleteResult)
        .mockReturnValueOnce(selectResult)
        .mockReturnValueOnce(insertResult);

      const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});

      const result = await applyDefaultRolePermissions(9, 'audit', {
        client,
        replaceExisting: true,
      });

      expect(client.query).toHaveBeenNthCalledWith(1, 'DELETE FROM user_permissions WHERE user_id = $1', [9]);
      expect(client.query).toHaveBeenNthCalledWith(
        2,
        expect.stringContaining('SELECT id, LOWER(code) AS code FROM permissions WHERE LOWER(code) = ANY($1::TEXT[])'),
        [['requests.view-incomplete', 'requests.view-audit']]
      );
      expect(client.query).toHaveBeenNthCalledWith(
        3,
        expect.stringContaining('INSERT INTO user_permissions (user_id, permission_id)'),
        [9, [11, 12]]
      );

      expect(result).toEqual({ applied: true, reason: 'applied', missing: [] });
      expect(warnSpy).not.toHaveBeenCalled();
      warnSpy.mockRestore();
    });
  });
});