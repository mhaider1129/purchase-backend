"use strict";
// Existing contract approval authority, shared with file authorization.
const ROLE_ALIASES = {
  legal: ["legal"],
  finance: ["finance", "cfo"],
  technical: ["technical", "technician"],
  scm: ["scm"],
  coo_ceo: ["coo", "ceo", "coo_ceo", "coo/ceo"],
};

const normalizeUserRole = (role) =>
  String(role || "")
    .trim()
    .toLowerCase();

const getContractApprovalRoleAliases = (reviewerRole) =>
  ROLE_ALIASES[
    String(reviewerRole || "")
      .trim()
      .toLowerCase()
  ] || [];

const canUserDecideContractStep = (user = {}, approvalStep = {}) => {
  const userId = Number(user?.id);
  const reviewerId = Number(approvalStep?.reviewer_id);
  if (
    Number.isInteger(userId) &&
    userId > 0 &&
    Number.isInteger(reviewerId) &&
    reviewerId > 0
  ) {
    return userId === reviewerId;
  }
  const role = normalizeUserRole(user?.role);
  const allowedRoles = getContractApprovalRoleAliases(
    approvalStep?.reviewer_role,
  );
  return allowedRoles.includes(role);
};

module.exports = {
  ROLE_ALIASES,
  normalizeUserRole,
  getContractApprovalRoleAliases,
  canUserDecideContractStep,
};
