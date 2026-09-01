const defaultRepository = require('../repositories/organizationRepository');
const defaultAudit = require('./auditService').writeAuditEvent;

const TYPES = ['INSTITUTE', 'EXECUTIVE_OFFICE', 'DIRECTORATE', 'DEPARTMENT', 'SECTION', 'UNIT'];
const POSITION_TYPES = ['UNIT_HEAD', 'EXECUTIVE_HEAD', 'DEPARTMENT_HEAD', 'SECTION_HEAD', 'CUSTOM'];
const UNIQUE_AUTHORITIES = new Set(POSITION_TYPES.filter(type => type !== 'CUSTOM'));
const httpError = (statusCode, message) => Object.assign(new Error(message), { statusCode });
const present = value => value !== undefined;
const effective = (position, today = new Date().toISOString().slice(0, 10)) =>
  position.is_active && (!position.effective_from || position.effective_from <= today) &&
  (!position.effective_to || position.effective_to >= today);

function createOrganizationService(repo = defaultRepository, audit = defaultAudit) {
  const transaction = async work => {
    const client = await repo.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await work(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally { client.release(); }
  };

  const validateLegacyLink = payload => {
    if (payload.departmentId && payload.unitType !== 'DEPARTMENT') throw httpError(400, 'Only a DEPARTMENT unit may link a department');
    if (payload.sectionId && payload.unitType !== 'SECTION') throw httpError(400, 'Only a SECTION unit may link a section');
    if (payload.departmentId && payload.sectionId) throw httpError(400, 'A unit may have only one legacy identity link');
  };

  const validateParent = async (unit, parentId, client) => {
    if (parentId == null) return;
    if (unit && String(unit.id) === String(parentId)) throw httpError(400, 'A unit cannot be its own parent');
    const parent = await repo.get(parentId, client, { lock: true });
    if (!parent) throw httpError(400, 'Parent unit not found');
    if (unit?.institute_id != null && String(parent.institute_id) !== String(unit.institute_id))
      throw httpError(400, 'Parent unit must belong to the same institute');
    if (unit) {
      const descendants = await repo.descendants(unit.id, client);
      if (descendants.some(item => String(item.id) === String(parentId))) throw httpError(400, 'Move would create a circular hierarchy');
    }
  };

  const getAncestorUnits = (id, client) => repo.ancestors(id, client);
  const getDescendantUnits = (id, client) => repo.descendants(id, client);
  const getOrganizationalPath = async (id, client) => [...await repo.ancestors(id, client), await repo.get(id, client)].filter(Boolean);

  const resolvePositionHolder = async (unitId, type, client) => {
    const matches = (await repo.positions(unitId, client)).filter(position => position.position_type === type && effective(position));
    if (matches.length > 1) throw httpError(409, `Ambiguous active ${type} authority for organization unit ${unitId}`);
    return matches[0] || null;
  };

  const resolveExecutiveForUnit = async (id, client) => {
    const chain = [await repo.get(id, client), ...(await repo.ancestors(id, client)).reverse()];
    const executiveUnit = chain.find(unit => unit?.unit_type === 'EXECUTIVE_OFFICE');
    if (!executiveUnit) return null;
    const position = await resolvePositionHolder(executiveUnit.id, 'EXECUTIVE_HEAD', client) ||
      await resolvePositionHolder(executiveUnit.id, 'UNIT_HEAD', client);
    return position ? { unitId: executiveUnit.id, unitName: executiveUnit.name, position: position.position_name,
      userId: position.user_id, userName: position.user_name } : null;
  };

  const getTree = async filters => {
    const rows = await repo.list(filters);
    const nodes = new Map(rows.map(row => [String(row.id), { ...row, children: [] }]));
    const roots = [];
    for (const node of nodes.values()) (nodes.get(String(node.parent_unit_id))?.children || roots).push(node);
    return roots;
  };

  const getUnit = async (id, client) => {
    const unit = await repo.get(id, client);
    if (!unit) throw httpError(404, 'Organization unit not found');
    const [children, positions, path, executiveOwner] = await Promise.all([
      repo.list({ parent: id }, client), repo.positions(id, client), getOrganizationalPath(id, client), resolveExecutiveForUnit(id, client)
    ]);
    const heads = positions.filter(position => position.is_unit_head && effective(position));
    if (heads.length > 1) throw httpError(409, `Ambiguous active UNIT_HEAD authority for organization unit ${id}`);
    return { ...unit, children, positions, path: path.map(item => item.name), ancestors: path.slice(0, -1),
      executiveOwner, unitHead: heads[0] || null };
  };

  const createUnit = payload => transaction(async client => {
    if (!payload.name || !TYPES.includes(payload.unitType)) throw httpError(400, 'name and valid unitType are required');
    if (!payload.instituteId) throw httpError(400, 'instituteId is required');
    validateLegacyLink(payload);
    await validateParent({ institute_id: payload.instituteId }, payload.parentUnitId, client);
    const result = await client.query(`INSERT INTO organization_units(institute_id,name,code,unit_type,parent_unit_id,department_id,section_id,classification,is_active,sort_order,created_by,updated_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,COALESCE($9,true),COALESCE($10,0),$11,$11) RETURNING *`,
      [payload.instituteId, payload.name, payload.code || null, payload.unitType, payload.parentUnitId || null,
        payload.departmentId || null, payload.sectionId || null, payload.classification || null, payload.isActive, payload.sortOrder, payload.actorId]);
    await audit({ client, entityType: 'organization_unit', entityId: result.rows[0].id, action: 'ORGANIZATION_UNIT_CREATED', actorUserId: payload.actorId, afterData: result.rows[0] });
    return result.rows[0];
  });

  const updateUnit = (id, payload) => transaction(async client => {
    const before = await repo.get(id, client, { lock: true });
    if (!before) throw httpError(404, 'Organization unit not found');
    if (present(payload.parentUnitId)) throw httpError(400, 'Use the explicit move operation to change a parent');
    if (present(payload.unitType) && payload.unitType !== before.unit_type) throw httpError(400, 'unitType is immutable after creation');
    const result = await client.query(`UPDATE organization_units SET name=COALESCE($2,name),code=COALESCE($3,code),classification=CASE WHEN $4 THEN $5 ELSE classification END,is_active=COALESCE($6,is_active),sort_order=COALESCE($7,sort_order),updated_by=$8,updated_at=now() WHERE id=$1 RETURNING *`,
      [id, payload.name, payload.code, present(payload.classification), payload.classification || null, payload.isActive, payload.sortOrder, payload.actorId]);
    const action = payload.isActive === false ? 'ORGANIZATION_UNIT_ARCHIVED' : 'ORGANIZATION_UNIT_UPDATED';
    await audit({ client, entityType: 'organization_unit', entityId: id, action, actorUserId: payload.actorId, beforeData: before, afterData: result.rows[0] });
    return result.rows[0];
  });

  const moveUnit = (id, parentUnitId, actorId) => transaction(async client => {
    const before = await repo.get(id, client, { lock: true });
    if (!before) throw httpError(404, 'Organization unit not found');
    await validateParent(before, parentUnitId, client);
    const result = await client.query('UPDATE organization_units SET parent_unit_id=$2,updated_by=$3,updated_at=now() WHERE id=$1 RETURNING *', [id, parentUnitId || null, actorId]);
    await audit({ client, entityType: 'organization_unit', entityId: id, action: 'ORGANIZATION_UNIT_MOVED', actorUserId: actorId,
      beforeData: { ...before, parent_unit_id: before.parent_unit_id }, afterData: { ...result.rows[0], parent_unit_id: parentUnitId || null } });
    return result.rows[0];
  });

  const archiveUnit = (id, actorId) => updateUnit(id, { isActive: false, actorId });

  const savePosition = (unitId, payload, id) => transaction(async client => {
    let before = null;
    if (id) {
      before = (await client.query('SELECT * FROM organization_positions WHERE id=$1 FOR UPDATE', [id])).rows[0];
      if (!before) throw httpError(404, 'Position not found');
      unitId = before.organization_unit_id;
    }
    const type = payload.positionType || before?.position_type;
    if (!POSITION_TYPES.includes(type)) throw httpError(400, 'Invalid positionType');
    const active = payload.isActive ?? before?.is_active ?? true;
    const isHead = payload.isUnitHead ?? before?.is_unit_head ?? false;
    if (active && (UNIQUE_AUTHORITIES.has(type) || isHead)) {
      const conflicts = (await repo.positions(unitId, client)).filter(p => p.id != id && p.is_active && (p.position_type === type || (isHead && p.is_unit_head)));
      if (conflicts.length) throw httpError(409, 'This unit already has an active unique authority; archive it before assigning another');
    }
    let result;
    if (id) result = await client.query(`UPDATE organization_positions SET position_type=COALESCE($2,position_type),position_name=COALESCE($3,position_name),user_id=CASE WHEN $4 THEN $5 ELSE user_id END,is_unit_head=COALESCE($6,is_unit_head),is_active=COALESCE($7,is_active),effective_from=CASE WHEN $8 THEN $9 ELSE effective_from END,effective_to=CASE WHEN $10 THEN $11 ELSE effective_to END,updated_by=$12,updated_at=now() WHERE id=$1 RETURNING *`,
      [id, payload.positionType, payload.positionName, present(payload.userId), payload.userId || null, payload.isUnitHead, payload.isActive, present(payload.effectiveFrom), payload.effectiveFrom || null, present(payload.effectiveTo), payload.effectiveTo || null, payload.actorId]);
    else result = await client.query(`INSERT INTO organization_positions(organization_unit_id,position_type,position_name,user_id,is_unit_head,is_active,effective_from,effective_to,created_by,updated_by) VALUES($1,$2,$3,$4,COALESCE($5,false),COALESCE($6,true),$7,$8,$9,$9) RETURNING *`,
      [unitId, type, payload.positionName, payload.userId || null, payload.isUnitHead, payload.isActive, payload.effectiveFrom || null, payload.effectiveTo || null, payload.actorId]);
    const action = !id ? 'ORGANIZATION_POSITION_ASSIGNED' : payload.isActive === false ? 'ORGANIZATION_POSITION_REMOVED' : 'ORGANIZATION_POSITION_CHANGED';
    await audit({ client, entityType: 'organization_position', entityId: result.rows[0].id, action, actorUserId: payload.actorId, beforeData: before, afterData: result.rows[0] });
    return result.rows[0];
  });

  const linkedUnit = async (field, id) => (await repo.list({})).find(unit => String(unit[field]) === String(id));
  return {
    getTree, tree: getTree, getUnit, detail: getUnit, getAncestorUnits, getDescendantUnits, getOrganizationalPath,
    createUnit, create: createUnit, updateUnit, update: updateUnit, moveUnit, archiveUnit, archive: archiveUnit,
    createPosition: (unitId, payload) => savePosition(unitId, payload), updatePosition: (id, payload) => savePosition(null, payload, id),
    archivePosition: (id, actorId) => savePosition(null, { isActive: false, actorId }, id), savePosition,
    resolvePositionHolder,
    resolveDepartmentHead: async id => { const unit = await linkedUnit('department_id', id); return unit ? resolvePositionHolder(unit.id, 'DEPARTMENT_HEAD') : null; },
    resolveSectionHead: async id => { const unit = await linkedUnit('section_id', id); return unit ? resolvePositionHolder(unit.id, 'SECTION_HEAD') : null; },
    resolveExecutiveOwner: async id => { const unit = await linkedUnit('department_id', id); return unit ? resolveExecutiveForUnit(unit.id) : null; },
    repo
  };
}
module.exports = { createOrganizationService, TYPES, POSITION_TYPES, effective };