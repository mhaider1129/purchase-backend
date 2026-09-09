const values = Object.freeze({
  tagType: ['RFID_UHF', 'RFID_HF', 'QR', 'BARCODE', 'OTHER'],
  tagStatus: ['PENDING_ENCODING', 'ACTIVE', 'DAMAGED', 'LOST', 'RETIRED', 'REPLACED'],
  readerType: ['HANDHELD', 'FIXED'], sourceType: ['HANDHELD', 'FIXED', 'IMPORT', 'TEST'],
  eventType: ['ASSET_SEEN', 'LOCATION_VERIFIED', 'PORTAL_ENTRY', 'PORTAL_EXIT', 'AUTHORIZED_MOVEMENT', 'UNAUTHORIZED_MOVEMENT', 'UNKNOWN_TAG'],
  direction: ['ENTERING', 'EXITING', 'UNKNOWN'], authorizationStatus: ['AUTHORIZED', 'UNAUTHORIZED', 'NOT_APPLICABLE', 'UNKNOWN'],
  processingStatus: ['PENDING', 'PROCESSING', 'PROCESSED', 'FAILED', 'IGNORED'], exceptionStatus: ['OPEN', 'ACKNOWLEDGED', 'RESOLVED'],
});
const normalizeEpc = value => {
  const normalized = String(value || '').replace(/\s+/g, '').toUpperCase();
  if (!/^[A-Z0-9][A-Z0-9:._-]{3,127}$/.test(normalized)) { const error = new Error('EPC must be 4-128 supported identifier characters'); error.statusCode = 400; throw error; }
  return normalized;
};
module.exports = { values, normalizeEpc };