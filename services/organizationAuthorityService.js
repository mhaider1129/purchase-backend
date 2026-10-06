const defaultRepository = require('../repositories/organizationRepository');

const dateOnly = value => value instanceof Date ? value.toISOString().slice(0, 10) : value ? String(value).slice(0, 10) : null;
const isCurrentPosition = (position, today = new Date().toISOString().slice(0, 10)) =>
  position.is_active === true &&
  (!position.effective_from || dateOnly(position.effective_from) <= dateOnly(today)) &&
  (!position.effective_to || dateOnly(position.effective_to) >= dateOnly(today));

const unassigned = extra => ({ status: 'UNASSIGNED', ...extra });
const ambiguous = extra => ({ status: 'AMBIGUOUS', ...extra });
const serializePosition = (position, extra = {}) => ({
  status: 'RESOLVED',
  positionId: position.id,
  organizationUnitId: position.organization_unit_id,
  positionType: position.position_type,
  positionName: position.position_name,
  userId: position.user_id,
  userName: position.user_name,
  isUnitHead: position.is_unit_head,
  isActive: position.is_active,
  effectiveFrom: position.effective_from,
  effectiveTo: position.effective_to,
  ...extra
});

function createOrganizationAuthorityService(repo = defaultRepository) {
  const scopedUnit = async (unitId, instituteId, client) => {
    const unit = await repo.get(unitId, client);
    return instituteId && unit && unit.is_active !== false && String(unit.institute_id) === String(instituteId) ? unit : null;
  };

  const resolveMatches = (matches, extra = {}) => {
    if (!matches.length) return unassigned(extra);
    if (matches.length > 1) return ambiguous({ ...extra, positionIds: matches.map(position => position.id) });
    const position = matches[0];
    if (position.user_id == null) return serializePosition(position, { ...extra, status: 'POSITION_UNSTAFFED', userId: null, userName: null });
    if (position.user_is_active === false || position.user_is_active === null) return unassigned(extra);
    return serializePosition(position, extra);
  };

  const currentPositions = async (unitId, instituteId, client, at) => {
    if (!await scopedUnit(unitId, instituteId, client)) return [];
    return (await repo.positions(unitId, client, instituteId)).filter(position => isCurrentPosition(position, at));
  };

  const resolveUnitHead = async (unitId, instituteId, client, at) =>
    resolveMatches((await currentPositions(unitId, instituteId, client, at)).filter(position => position.is_unit_head === true), { organizationUnitId: unitId });

  const resolveTypedPosition = async (unitId, positionType, instituteId, client, at) =>
    resolveMatches((await currentPositions(unitId, instituteId, client, at)).filter(position => position.position_type === positionType), { organizationUnitId: unitId });

  const resolveExecutiveOwner = async (unitId, instituteId, client, at) => {
    const unit = await scopedUnit(unitId, instituteId, client);
    if (!unit) return unassigned({ organizationUnitId: null });
    const ancestors = await repo.ancestors(unitId, client);
    if (ancestors.some(item => item.is_active === false || String(item.institute_id) !== String(instituteId))) return unassigned({ organizationUnitId: null });
    const executiveUnit = [unit, ...ancestors.slice().reverse()].find(item => item.unit_type === 'EXECUTIVE_OFFICE');
    if (!executiveUnit) return unassigned({ organizationUnitId: null });
    return resolveMatches(
      (await currentPositions(executiveUnit.id, instituteId, client, at)).filter(position => position.position_type === 'EXECUTIVE_HEAD'),
      { organizationUnitId: executiveUnit.id, organizationUnitName: executiveUnit.name }
    );
  };

  return { currentPositions, resolveUnitHead, resolveTypedPosition, resolveExecutiveOwner, isCurrentPosition };
}

module.exports = { createOrganizationAuthorityService, isCurrentPosition, serializePosition };
