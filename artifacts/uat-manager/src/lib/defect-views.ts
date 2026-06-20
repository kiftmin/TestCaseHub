export const DEFECT_VIEWS = {
  BUSINESS: {
    active: ["NEW", "TRIAGED", "READY_FOR_VERIFICATION", "IN_VERIFICATION", "PENDING_BIZ_ACCEPTANCE"],
    withDev: ["ASSIGNED", "IN_PROGRESS", "BLOCKED", "RESOLVED_DEV", "REGRESSED"],
    historical: ["CLOSED", "PASSED_BY_AGREEMENT", "PENDING_DEPLOYMENT_APPROVAL"],
  },
  DEVELOPER: {
    actionable: ["ASSIGNED", "IN_PROGRESS", "REGRESSED"],
    blocked: ["BLOCKED"],
    recentlyResolved: ["RESOLVED_DEV"],
  },
} as const;

export const ALL_BUSINESS_STATUSES = [
  ...DEFECT_VIEWS.BUSINESS.active,
  ...DEFECT_VIEWS.BUSINESS.withDev,
  ...DEFECT_VIEWS.BUSINESS.historical,
];

export const ALL_DEVELOPER_STATUSES = [
  ...DEFECT_VIEWS.DEVELOPER.actionable,
  ...DEFECT_VIEWS.DEVELOPER.blocked,
  ...DEFECT_VIEWS.DEVELOPER.recentlyResolved,
];
