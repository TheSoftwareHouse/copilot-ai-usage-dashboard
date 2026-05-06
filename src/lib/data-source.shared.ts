import { ConfigurationEntity } from "../entities/configuration.entity";
import { CopilotSeatEntity } from "../entities/copilot-seat.entity";
import { CopilotUsageEntity } from "../entities/copilot-usage.entity";
import { JobExecutionEntity } from "../entities/job-execution.entity";
import { UserEntity } from "../entities/user.entity";
import { SessionEntity } from "../entities/session.entity";
import { DashboardMonthlySummaryEntity } from "../entities/dashboard-monthly-summary.entity";
import { TeamEntity } from "../entities/team.entity";
import { TeamMemberSnapshotEntity } from "../entities/team-member-snapshot.entity";
import { DepartmentEntity } from "../entities/department.entity";
import { GitHubAppEntity } from "../entities/github-app.entity";
import { TelemetryEventEntity } from "../entities/telemetry-event.entity";

export const allEntities = [
  ConfigurationEntity,
  CopilotSeatEntity,
  CopilotUsageEntity,
  JobExecutionEntity,
  UserEntity,
  SessionEntity,
  DashboardMonthlySummaryEntity,
  TeamEntity,
  TeamMemberSnapshotEntity,
  DepartmentEntity,
  GitHubAppEntity,
  TelemetryEventEntity,
];

export function parseConnectionString(url: string) {
  const parsed = new URL(url);
  return {
    host: parsed.hostname,
    port: parseInt(parsed.port || "5432", 10),
    username: decodeURIComponent(parsed.username),
    password: decodeURIComponent(parsed.password),
    database: parsed.pathname.replace("/", ""),
  };
}
