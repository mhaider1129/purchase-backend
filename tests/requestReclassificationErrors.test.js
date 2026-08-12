const { translateReclassificationError } = require('../services/requestReclassificationService');

describe('request reclassification database errors', () => {
  test.each(['42P01', '42703'])('reports missing migration objects for PostgreSQL error %s', code => {
    const databaseError = Object.assign(new Error('database object is missing'), { code });

    const translated = translateReclassificationError(databaseError);

    expect(translated).toMatchObject({
      statusCode: 503,
      code: 'REQUEST_RECLASSIFICATION_SCHEMA_UNAVAILABLE',
      cause: databaseError,
    });
    expect(translated.message).toContain('database migration');
  });

  test('preserves unrelated errors', () => {
    const error = Object.assign(new Error('connection failed'), { code: '08006' });

    expect(translateReclassificationError(error)).toBe(error);
  });
});