function getUploadedFile(req, preferredFields = ['file', 'attachment', 'attachments']) {
  if (req?.file) {
    return req.file;
  }

  const files = req?.files;
  if (!files) {
    return null;
  }

  if (Array.isArray(files)) {
    for (const field of preferredFields) {
      const matched = files.find(file => file?.fieldname === field);
      if (matched) {
        return matched;
      }
    }
    return files[0] || null;
  }

  for (const field of preferredFields) {
    const entries = files[field];
    if (Array.isArray(entries) && entries.length > 0) {
      return entries[0];
    }
  }

  const firstEntry = Object.values(files).find(entry => Array.isArray(entry) && entry.length > 0);
  return firstEntry ? firstEntry[0] : null;
}


function describeUploadPayload(req) {
  const describe = file => ({
    fieldname: file?.fieldname || null,
    originalname: file?.originalname || null,
    mimetype: file?.mimetype || null,
    size: typeof file?.size === 'number' ? file.size : null,
  });

  if (req?.file) {
    return { shape: 'req.file', files: [describe(req.file)] };
  }

  if (Array.isArray(req?.files)) {
    return { shape: 'req.files[]', files: req.files.map(describe) };
  }

  if (req?.files && typeof req.files === 'object') {
    const entries = Object.entries(req.files).flatMap(([field, files]) =>
      Array.isArray(files) ? files.map(file => ({ ...describe(file), field })) : []
    );
    return { shape: 'req.files{}', files: entries };
  }

  return { shape: 'none', files: [] };
}

module.exports = {
  getUploadedFile,
  describeUploadPayload,
};