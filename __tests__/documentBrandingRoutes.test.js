jest.mock('../config/db', () => ({ query: jest.fn() }));

const {
  canManage,
  validImageData,
} = require('../routes/documentBranding');

describe('document branding route validation', () => {
  it('allows system managers to update the global branding', () => {
    expect(canManage({ role: 'admin' })).toBe(true);
    expect(canManage({ role: 'SCM' })).toBe(true);
    expect(canManage({ role: 'Requester' })).toBe(false);
    expect(
      canManage({ hasPermission: (permission) => permission === 'departments.manage' })
    ).toBe(true);
  });

  it('accepts only empty values or base64 image data', () => {
    expect(validImageData('')).toBe(true);
    expect(validImageData('data:image/png;base64,AAAA')).toBe(true);
    expect(validImageData('https://example.com/logo.png')).toBe(false);
    expect(validImageData('data:text/html;base64,AAAA')).toBe(false);
  });
});