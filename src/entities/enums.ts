export enum ApiMode {
  ORGANISATION = "organisation",
  ENTERPRISE = "enterprise",
}

export enum JobType {
  SEAT_SYNC = "seat_sync",
  // Retained for historical job_execution reads only. No active creation paths.
  USAGE_COLLECTION = "usage_collection",
  // Retained for historical job_execution reads only. No active creation paths.
  MONTH_RECOLLECTION = "month_recollection",
  TEAM_CARRY_FORWARD = "team_carry_forward",
}

export enum JobStatus {
  SUCCESS = "success",
  FAILURE = "failure",
  PARTIAL_FAILURE = "partial_failure",
  BLOCKED = "blocked",
  NO_OP = "no_op",
  RUNNING = "running",
}

export enum CopilotUsageSource {
  CSV_IMPORT = "csv_import",
  GITHUB_API = "github_api",
}

export enum SeatStatus {
  ACTIVE = "active",
  INACTIVE = "inactive",
}

export enum UserRole {
  ADMIN = "admin",
  USER = "user",
}
