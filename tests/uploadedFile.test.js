const { getUploadedFile } = require('../utils/uploadedFile');

describe('getUploadedFile', () => {
  it('returns req.file when present', () => {
    const file = { originalname: 'a.pdf' };
    expect(getUploadedFile({ file })).toBe(file);
  });

  it('finds the first preferred field from req.files array', () => {
    const files = [
      { fieldname: 'other', originalname: 'x.txt' },
      { fieldname: 'attachments', originalname: 'b.pdf' },
    ];

    expect(getUploadedFile({ files })?.originalname).toBe('b.pdf');
  });

  it('handles multer fields object shape', () => {
    const req = {
      files: {
        attachment: [{ originalname: 'c.pdf' }],
      },
    };

    expect(getUploadedFile(req)?.originalname).toBe('c.pdf');
  });
});