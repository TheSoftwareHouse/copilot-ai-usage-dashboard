import "reflect-metadata";
import { DataSource } from "typeorm";
import { allEntities, parseConnectionString } from "../src/lib/data-source.shared";
import { InitConfiguration1772221226048 } from "../migrations/1772221226048-InitConfiguration";
import { AddSingletonKey1772223293780 } from "../migrations/1772223293780-AddSingletonKey";
import { CreateJobExecution1772225809783 } from "../migrations/1772225809783-CreateJobExecution";
import { CreateAuthTables1772229363813 } from "../migrations/1772229363813-CreateAuthTables";
import { DropRedundantSessionTokenIndex1772231511094 } from "../migrations/1772231511094-DropRedundantSessionTokenIndex";
import { CreateCopilotSeat1772266160629 } from "../migrations/1772266160629-CreateCopilotSeat";
import { CreateCopilotUsage1772277589638 } from "../migrations/1772277589638-CreateCopilotUsage";
import { CreateDashboardMonthlySummary1772284213080 } from "../migrations/1772284213080-CreateDashboardMonthlySummary";
import { AddPremiumRequestMetrics1772286855609 } from "../migrations/1772286855609-AddPremiumRequestMetrics";
import { AddSeatBaseCost1772290000000 } from "../migrations/1772290000000-AddSeatBaseCost";
import { AddMonthRecollectionJobType1772300000000 } from "../migrations/1772300000000-AddMonthRecollectionJobType";
import { CreateTeamTables1772400000000 } from "../migrations/1772400000000-CreateTeamTables";
import { CreateDepartmentTable1772500000000 } from "../migrations/1772500000000-CreateDepartmentTable";
import { AddTeamSoftDelete1772600000000 } from "../migrations/1772600000000-AddTeamSoftDelete";
import { AddDepartmentNameUnique1772700000000 } from "../migrations/1772700000000-AddDepartmentNameUnique";
import { AddPremiumRequestsPerSeat1772800000000 } from "../migrations/1772800000000-AddPremiumRequestsPerSeat";
import { AddTeamCarryForwardJobType1772900000000 } from "../migrations/1772900000000-AddTeamCarryForwardJobType";
import { AddRefreshTokenToSession1772950000000 } from "../migrations/1772950000000-AddRefreshTokenToSession";
import { CreateGitHubApp1773000000000 } from "../migrations/1773000000000-CreateGitHubApp";
import { AddInstallationIdToGitHubApp1773100000000 } from "../migrations/1773100000000-AddInstallationIdToGitHubApp";
import { AddUserRole1773200000000 } from "../migrations/1773200000000-AddUserRole";
import { AddTelemetryApiKey1773300000000 } from "../migrations/1773300000000-AddTelemetryApiKey";
import { CreateTelemetryEvent1773400000000 } from "../migrations/1773400000000-CreateTelemetryEvent";
import { AddTelemetryGithubUsername1773500000000 } from "../migrations/1773500000000-AddTelemetryGithubUsername";
import { AddNormConfiguration1773600000000 } from "../migrations/1773600000000-AddNormConfiguration";
import { CreateImportHistory1773650000000 } from "../migrations/1773650000000-CreateImportHistory";
import { ExpandDeviationThresholdPrecision1773700000000 } from "../migrations/1773700000000-ExpandDeviationThresholdPrecision";
import { ExpandDeviationThresholdPrecisionTo500001773800000000 } from "../migrations/1773800000000-ExpandDeviationThresholdPrecisionTo50000";
import { SetStaticAicThresholdDefaults1773900000000 } from "../migrations/1773900000000-SetStaticAicThresholdDefaults";
import { AddTeamMemberAllocationPercentage1774000000000 } from "../migrations/1774000000000-AddTeamMemberAllocationPercentage";
import { AddCopilotUsageSource1774100000000 } from "../migrations/1774100000000-AddCopilotUsageSource";
import { AddUsageCollectionJobExecutionStates1774200000000 } from "../migrations/1774200000000-AddUsageCollectionJobExecutionStates";
import { RenameAiCreditsAndArchivePremiumAllowance1774300000000 } from "../migrations/1774300000000-RenameAiCreditsAndArchivePremiumAllowance";
import { RemoveTelemetry1774400000000 } from "../migrations/1774400000000-RemoveTelemetry";

const MAX_RETRIES = 5;
const RETRY_INTERVAL_MS = 3000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function runMigrations(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error("[migrations] DATABASE_URL environment variable is not set");
    process.exit(1);
  }

  const connectionConfig = parseConnectionString(databaseUrl);

  const dataSource = new DataSource({
    type: "postgres",
    host: connectionConfig.host,
    port: connectionConfig.port,
    username: connectionConfig.username,
    password: connectionConfig.password,
    database: connectionConfig.database,
    entities: allEntities,
    migrations: [
      InitConfiguration1772221226048,
      AddSingletonKey1772223293780,
      CreateJobExecution1772225809783,
      CreateAuthTables1772229363813,
      DropRedundantSessionTokenIndex1772231511094,
      CreateCopilotSeat1772266160629,
      CreateCopilotUsage1772277589638,
      CreateDashboardMonthlySummary1772284213080,
      AddPremiumRequestMetrics1772286855609,
      AddSeatBaseCost1772290000000,
      AddMonthRecollectionJobType1772300000000,
      CreateTeamTables1772400000000,
      CreateDepartmentTable1772500000000,
      AddTeamSoftDelete1772600000000,
      AddDepartmentNameUnique1772700000000,
      AddPremiumRequestsPerSeat1772800000000,
      AddTeamCarryForwardJobType1772900000000,
      AddRefreshTokenToSession1772950000000,
      CreateGitHubApp1773000000000,
      AddInstallationIdToGitHubApp1773100000000,
      AddUserRole1773200000000,
      AddTelemetryApiKey1773300000000,
      CreateTelemetryEvent1773400000000,
      AddTelemetryGithubUsername1773500000000,
      AddNormConfiguration1773600000000,
      CreateImportHistory1773650000000,
      ExpandDeviationThresholdPrecision1773700000000,
      ExpandDeviationThresholdPrecisionTo500001773800000000,
      SetStaticAicThresholdDefaults1773900000000,
      AddTeamMemberAllocationPercentage1774000000000,
      AddCopilotUsageSource1774100000000,
      AddUsageCollectionJobExecutionStates1774200000000,
      RenameAiCreditsAndArchivePremiumAllowance1774300000000,
      RemoveTelemetry1774400000000,
    ],
    synchronize: false,
    logging: false,
  });

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      console.log(
        `[migrations] Connecting to database (attempt ${attempt}/${MAX_RETRIES})...`
      );
      await dataSource.initialize();
      console.log("[migrations] Database connection established");
      break;
    } catch (error) {
      const message =
        error instanceof Error ? error.message : String(error);
      console.error(
        `[migrations] Connection attempt ${attempt}/${MAX_RETRIES} failed: ${message}`
      );
      if (attempt === MAX_RETRIES) {
        console.error(
          "[migrations] All connection attempts exhausted. Exiting."
        );
        process.exit(1);
      }
      console.log(
        `[migrations] Retrying in ${RETRY_INTERVAL_MS / 1000}s...`
      );
      await sleep(RETRY_INTERVAL_MS);
    }
  }

  try {
    const pendingMigrations = await dataSource.showMigrations();
    if (!pendingMigrations) {
      console.log("[migrations] Database schema is up-to-date. No pending migrations.");
    } else {
      console.log("[migrations] Running pending migrations...");
      const executedMigrations = await dataSource.runMigrations();
      console.log(
        `[migrations] Successfully applied ${executedMigrations.length} migration(s):`
      );
      for (const migration of executedMigrations) {
        console.log(`  - ${migration.name}`);
      }
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[migrations] Migration execution failed: ${message}`);
    process.exit(1);
  } finally {
    await dataSource.destroy();
    console.log("[migrations] Database connection closed");
  }
}

runMigrations().then(() => {
  console.log("[migrations] Done");
  process.exit(0);
});
