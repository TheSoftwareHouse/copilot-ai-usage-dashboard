import { DataSource } from "typeorm";
import { ConfigurationEntity } from "@/entities/configuration.entity";
import { CopilotSeatEntity } from "@/entities/copilot-seat.entity";
import { CopilotUsageEntity } from "@/entities/copilot-usage.entity";
import { JobExecutionEntity } from "@/entities/job-execution.entity";
import { UserEntity } from "@/entities/user.entity";
import { SessionEntity } from "@/entities/session.entity";
import { DashboardMonthlySummaryEntity } from "@/entities/dashboard-monthly-summary.entity";
import { TeamEntity } from "@/entities/team.entity";
import { TeamMemberSnapshotEntity } from "@/entities/team-member-snapshot.entity";
import { DepartmentEntity } from "@/entities/department.entity";
import { GitHubAppEntity } from "@/entities/github-app.entity";
import { TelemetryEventEntity } from "@/entities/telemetry-event.entity";

let testDataSource: DataSource | undefined;

/**
 * Get a DataSource connected to the test database.
 * Uses the same DATABASE_URL from the environment (pointing to the test DB).
 */
export async function getTestDataSource(): Promise<DataSource> {
  if (testDataSource?.isInitialized) {
    return testDataSource;
  }

  const databaseUrl =
    process.env.DATABASE_URL ||
    "postgres://postgres:postgres@localhost:5432/copilot_dashboard_test";

  const parsed = new URL(databaseUrl);

  testDataSource = new DataSource({
    type: "postgres",
    host: parsed.hostname,
    port: parseInt(parsed.port || "5432", 10),
    username: decodeURIComponent(parsed.username),
    password: decodeURIComponent(parsed.password),
    database: parsed.pathname.replace("/", ""),
    entities: [ConfigurationEntity, CopilotSeatEntity, CopilotUsageEntity, JobExecutionEntity, UserEntity, SessionEntity, DashboardMonthlySummaryEntity, TeamEntity, TeamMemberSnapshotEntity, DepartmentEntity, GitHubAppEntity, TelemetryEventEntity],
    synchronize: true,
    logging: false,
  });

  await testDataSource.initialize();
  return testDataSource;
}

/**
 * Clear all data from session, app_user, configuration, and job_execution tables.
 * Tables are cleared in FK dependency order (session before app_user).
 */
export async function cleanDatabase(ds: DataSource): Promise<void> {
  const sessionRepository = ds.getRepository(SessionEntity);
  await sessionRepository.clear();
  const userRepository = ds.getRepository(UserEntity);
  await userRepository.clear();
  await ds.query('TRUNCATE TABLE telemetry_event, team_member_snapshot, team, department, copilot_usage, copilot_seat CASCADE');
  const summaryRepository = ds.getRepository(DashboardMonthlySummaryEntity);
  await summaryRepository.clear();
  const configRepository = ds.getRepository(ConfigurationEntity);
  await configRepository.clear();
  const jobRepository = ds.getRepository(JobExecutionEntity);
  await jobRepository.clear();
  const githubAppRepository = ds.getRepository(GitHubAppEntity);
  await githubAppRepository.clear();
}

/**
 * Destroy the test data source connection.
 */
export async function destroyTestDataSource(): Promise<void> {
  if (testDataSource?.isInitialized) {
    await testDataSource.destroy();
    testDataSource = undefined;
  }
}
