const { serializeAttachment } = require('../utils/attachmentPaths');

describe('serializeAttachment', () => {
  test('returns a download path relative to the configured API base', () => {
    expect(
      serializeAttachment({
        id: 62,
        file_name: 'invoice.pdf',
        file_path: 'uploads/invoice.pdf',
      }).download_url,
    ).toBe('/attachments/62/download');
  });
});