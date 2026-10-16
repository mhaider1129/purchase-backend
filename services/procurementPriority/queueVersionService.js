'use strict';
function assertQueueVersions(rows, versions, legacyVersion) {
  const keyed = versions != null;
  const validMap = keyed && typeof versions === 'object' && !Array.isArray(versions)
    && Object.keys(versions).length === rows.length;
  const matches = rows.every(row => {
    const id = String(row.id ?? row.procurement_case_id);
    const supplied = keyed ? (validMap && Object.hasOwn(versions,id) ? versions[id] : null) : legacyVersion;
    return ['string','number'].includes(typeof supplied) && /^\d+$/.test(String(supplied)) && String(row.row_version) === String(supplied);
  });
  if ((keyed && !validMap) || !matches) throw Object.assign(new Error('Priority queue changed; reload and try again'), { statusCode:409,code:'PRIORITY_VERSION_CONFLICT' });
}
module.exports = { assertQueueVersions };
