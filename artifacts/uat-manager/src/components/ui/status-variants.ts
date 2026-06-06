export type StatusVariant =
  | "neutral"
  | "info"
  | "warning"
  | "success"
  | "error"
  | "purple";

export const runStatusVariant: Record<string, StatusVariant> = {
  scheduled: "info",
  in_progress: "warning",
  completed: "success",
};

export const scenarioStatusVariant: Record<string, StatusVariant> = {
  pending: "neutral",
  in_progress: "warning",
  passed: "success",
  failed: "error",
  passed_by_agreement: "purple",
};

export const caseStatusVariant: Record<string, StatusVariant> = {
  "Not Started": "neutral",
  "In Progress": "warning",
  Pass: "success",
  Fail: "error",
};

export const progressStatusVariant: Record<string, StatusVariant> = {
  "Not Started": "neutral",
  "In Progress": "warning",
  Completed: "success",
};
