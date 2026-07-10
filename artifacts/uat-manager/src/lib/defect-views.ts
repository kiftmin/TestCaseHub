// Reflects the 10-state simplified defect lifecycle.
// BLOCKED is now an is_blocked flag, not a status.
// IN_VERIFICATION and PENDING_DEPLOYMENT_APPROVAL have been removed.

export const DEFECT_VIEWS = {
  BUSINESS: {
    active: ["NEW", "TRIAGED", "READY_FOR_VERIFICATION", "PENDING_BIZ_ACCEPTANCE"],
    withDev: ["ASSIGNED", "IN_PROGRESS", "RESOLVED_DEV", "REGRESSED"],
    historical: ["CLOSED", "PASSED_BY_AGREEMENT"],
  },
  DEVELOPER: {
    actionable: ["ASSIGNED", "IN_PROGRESS", "REGRESSED"],
    recentlyResolved: ["RESOLVED_DEV"],
    awaitingHandoff: ["QA_PASSED"],
  },
} as const;

export const ALL_BUSINESS_STATUSES = [
  ...DEFECT_VIEWS.BUSINESS.active,
  ...DEFECT_VIEWS.BUSINESS.withDev,
  ...DEFECT_VIEWS.BUSINESS.historical,
];

export const ALL_DEVELOPER_STATUSES = [
  ...DEFECT_VIEWS.DEVELOPER.actionable,
  ...DEFECT_VIEWS.DEVELOPER.recentlyResolved,
  ...DEFECT_VIEWS.DEVELOPER.awaitingHandoff,
];
