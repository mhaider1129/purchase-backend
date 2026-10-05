'use strict';
const { disposableDatabaseUrl } = require('../integration/disposableDatabase');

test('accepts only the dedicated runner-created loopback database', () => {
  expect(disposableDatabaseUrl('postgresql://p2p_test:test@127.0.0.1:55432/p2p_disposable_0123456789abcdef'))
    .toContain('127.0.0.1:55432/p2p_disposable_0123456789abcdef');
});

test.each([
  undefined, '', 'invalid',
  'postgresql://p2p_test:test@development.supabase.co:5432/p2p_disposable_0123456789abcdef',
  'postgresql://p2p_test:test@127.0.0.1:5432/postgres',
  'postgresql://postgres:test@127.0.0.1:5432/p2p_disposable_0123456789abcdef',
  'postgresql://p2p_test:test@127.0.0.1:5432/p2p_disposable_0123456789abcdef?host=development.supabase.co',
])('rejects shared, redirected or missing database targets (%s)', value => {
  expect(() => disposableDatabaseUrl(value)).toThrow();
});
