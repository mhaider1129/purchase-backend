"use strict";
// Assignment authority survives HR placement only while the matching current
// organizational department-head responsibility is actually held.
module.exports = (user, department, institute) =>
  `(${user}.department_id=${department} OR EXISTS(SELECT 1 FROM organization_positions scope_position JOIN organization_units scope_unit ON scope_unit.id=scope_position.organization_unit_id WHERE scope_position.user_id=${user}.id AND scope_unit.department_id=${department} AND scope_unit.institute_id=${institute} AND scope_unit.is_active AND scope_position.is_active AND scope_position.position_type='DEPARTMENT_HEAD' AND (scope_position.effective_from IS NULL OR scope_position.effective_from<=(now() AT TIME ZONE 'Asia/Baghdad')::date) AND (scope_position.effective_to IS NULL OR scope_position.effective_to>=(now() AT TIME ZONE 'Asia/Baghdad')::date)))`;
