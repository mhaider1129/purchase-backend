const values = Object.freeze({
  assetClass: ['CAPITAL', 'CONTROLLED'],
  acquisitionMethod: ['PURCHASE', 'DONATION', 'TRANSFER_IN', 'LEASE', 'LOAN', 'LEGACY', 'OTHER'],
  ownershipType: ['INSTITUTE_OWNED', 'LEASED', 'SUPPLIER_OWNED', 'LOANED', 'DONATED', 'OTHER'],
  condition: ['NEW', 'GOOD', 'FAIR', 'DAMAGED', 'UNDER_REPAIR', 'UNSERVICEABLE', 'UNKNOWN'],
  operationalStatus: ['IN_SERVICE', 'IN_STORAGE', 'UNDER_MAINTENANCE', 'OUT_OF_SERVICE', 'MISSING', 'RETIRED', 'DISPOSED'],
  reconciliationStatus: ['VERIFIED', 'UNVERIFIED', 'MISMATCH', 'MISSING', 'UNKNOWN'],
  creationSource: ['PROCUREMENT', 'LEGACY_RECOVERY', 'IMPORT', 'MANUAL', 'SYSTEM'],
  locationType: ['CAMPUS', 'BUILDING', 'FLOOR', 'DEPARTMENT_AREA', 'SECTION_AREA', 'ROOM', 'STORE', 'WORKSHOP', 'EXTERNAL', 'OTHER'],
  movementType: ['PERMANENT_TRANSFER', 'TEMPORARY_LOAN', 'MAINTENANCE_TRANSFER', 'EXTERNAL_MAINTENANCE', 'RETURN', 'STORAGE_TRANSFER', 'DISPOSAL_TRANSFER', 'LOCATION_CORRECTION'],
  movementStatus: ['DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'IN_TRANSIT', 'RECEIVED', 'RETURNED', 'CANCELLED', 'REJECTED'],
});

const transitions = Object.freeze({
  DRAFT: ['PENDING_APPROVAL', 'CANCELLED'], PENDING_APPROVAL: ['APPROVED', 'REJECTED', 'CANCELLED'],
  APPROVED: ['IN_TRANSIT', 'CANCELLED'], IN_TRANSIT: ['RECEIVED'], RECEIVED: ['RETURNED'], RETURNED: [], CANCELLED: [], REJECTED: [],
});

const assertOption = (group, value, required = true) => {
  if (!value && !required) return null;
  if (!values[group]?.includes(value)) { const error = new Error(`Invalid ${group}`); error.statusCode = 400; throw error; }
  return value;
};

module.exports = { values, transitions, assertOption };