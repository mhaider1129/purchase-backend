'use strict';

// The integration suite must never fall back to the application's DATABASE_URL.
function disposableDatabaseUrl(value) {
  let url;
  try { url = new URL(value); } catch (_) { throw new Error('A runner-created disposable PostgreSQL URL is required'); }
  if (!['postgres:', 'postgresql:'].includes(url.protocol)
    || url.hostname !== '127.0.0.1' || !url.port || url.search || url.hash
    || url.username !== 'p2p_test'
    || !/^\/p2p_disposable_[a-f0-9]{16}$/.test(url.pathname)) {
    throw new Error('P2P integration tests require a dedicated loopback disposable database');
  }
  return url.toString();
}

module.exports = { disposableDatabaseUrl };
