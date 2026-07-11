import { DataSource, EntityManager } from "typeorm";
import { AppDataSource } from "@/lib/data-source.cli";
import { parseConnectionString } from "@/lib/data-source.shared";
import { refreshDashboardMetrics } from "@/lib/dashboard-metrics";
import { CopilotSeatEntity, type CopilotSeat } from "@/entities/copilot-seat.entity";
import { CopilotUsageEntity, type UsageItem } from "@/entities/copilot-usage.entity";
import { TeamEntity } from "@/entities/team.entity";
import {
  TeamMemberSnapshotEntity,
  type TeamMemberSnapshot,
} from "@/entities/team-member-snapshot.entity";
import { DepartmentEntity } from "@/entities/department.entity";
import { DashboardMonthlySummaryEntity } from "@/entities/dashboard-monthly-summary.entity";
import { CopilotUsageSource, SeatStatus } from "@/entities/enums";

const SEED_PREFIX = "demo-mj26";
const CONFIRMATION_TOKEN = "may-july-2026";
const REQUIRED_CONFIRMATION_ENV = "CONFIRM_REPORTING_DATA_REPLACEMENT";
const TARGET_MONTHS = [5, 6, 7] as const;
const TARGET_YEAR = 2026;
const SEAT_COUNT = 36;
const DEPARTMENT_COUNT = 4;
const TEAM_COUNT = 6;
const SEATS_PER_DEPARTMENT = 9;
const PRIMARY_ALLOCATION = 70;
const SECONDARY_ALLOCATION = 30;
const MIN_DAILY_SEAT_AIC = 2000;
const MAX_DAILY_SEAT_AIC = 6000;

const ADJECTIVES = [
  "amber",
  "brisk",
  "cinder",
  "drift",
  "ember",
  "flint",
  "glint",
  "harbor",
  "ivy",
  "jade",
  "kite",
  "linen",
  "mango",
  "nova",
  "opal",
  "poppy",
  "quartz",
  "ripple",
  "sable",
  "thistle",
  "umber",
  "velvet",
  "willow",
  "yonder",
  "zinc",
];

const NOUNS = [
  "anchor",
  "beacon",
  "comet",
  "delta",
  "ember",
  "fjord",
  "grove",
  "harvest",
  "island",
  "juniper",
  "keystone",
  "lagoon",
  "meadow",
  "nectar",
  "orbit",
  "prairie",
  "quill",
  "ridge",
  "summit",
  "tidal",
  "upland",
  "vista",
  "wharf",
  "yard",
  "zephyr",
];

const MODELS = [
  { model: "Claude Sonnet 4.5", unitPrice: 0.09 },
  { model: "GPT-4o", unitPrice: 0.07 },
  { model: "Gemini 2.5 Pro", unitPrice: 0.08 },
  { model: "Claude Opus 4.1", unitPrice: 0.12 },
] as const;

interface GuardConfig {
  databaseUrl: string;
  allowDemoSeed: boolean;
  confirmation: string | undefined;
}

interface DatePoint {
  day: number;
  month: number;
  year: number;
}

interface PlannedDepartment {
  name: string;
}

interface PlannedTeam {
  name: string;
}

interface PlannedSeat {
  username: string;
  githubUserId: number;
  firstName: string;
  lastName: string;
  departmentName: string;
  primaryTeamName: string;
  secondaryTeamName: string;
}

interface PlannedUsageRow {
  seatUsername: string;
  day: number;
  month: number;
  year: number;
  usageItems: UsageItem[];
}

interface DemoPlan {
  departments: PlannedDepartment[];
  teams: PlannedTeam[];
  seats: PlannedSeat[];
  snapshots: Array<
    Omit<TeamMemberSnapshot, "id" | "createdAt" | "teamId" | "seatId"> & {
      teamName: string;
      seatUsername: string;
    }
  >;
  usageRows: PlannedUsageRow[];
  dates: DatePoint[];
}

interface SeedResult {
  departmentCount: number;
  teamCount: number;
  seatCount: number;
  snapshotCount: number;
  usageRowCount: number;
  summaryCount: number;
  startDate: string;
  endDate: string;
}

function normalizeHost(host: string): string {
  return host.toLowerCase();
}

function isLoopbackHost(host: string): boolean {
  const normalized = normalizeHost(host);
  return normalized === "localhost" || normalized === "127.0.0.1" || normalized === "::1";
}

function isAllowedDbName(databaseName: string): boolean {
  const normalized = databaseName.toLowerCase();
  return normalized.includes("local") || normalized.includes("demo") || normalized.includes("test");
}

function parseGuardConfig(env: NodeJS.ProcessEnv): GuardConfig {
  const databaseUrl = env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("DATABASE_URL environment variable is required.");
  }

  return {
    databaseUrl,
    allowDemoSeed: env.ALLOW_DEMO_SEED === "1",
    confirmation: env[REQUIRED_CONFIRMATION_ENV],
  };
}

function validateTargetSafety(config: GuardConfig): { host: string; database: string } {
  if (config.confirmation !== CONFIRMATION_TOKEN) {
    throw new Error(
      `Refusing reporting replacement: ${REQUIRED_CONFIRMATION_ENV} must equal '${CONFIRMATION_TOKEN}'.`,
    );
  }

  const parsed = parseConnectionString(config.databaseUrl);
  if (!isLoopbackHost(parsed.host)) {
    throw new Error(
      `Refusing reporting replacement: non-loopback host '${parsed.host}' is not allowed.`,
    );
  }

  if (!isAllowedDbName(parsed.database) && !config.allowDemoSeed) {
    throw new Error(
      `Refusing reporting replacement: database '${parsed.database}' must include local, demo, or test. Set ALLOW_DEMO_SEED=1 only to bypass the database-name rule on loopback targets.`,
    );
  }

  return { host: parsed.host, database: parsed.database };
}

function mulberry32(seed: number): () => number {
  let value = seed >>> 0;
  return () => {
    value += 0x6d2b79f5;
    let t = Math.imul(value ^ (value >>> 15), 1 | value);
    t ^= t + Math.imul(t ^ (t >>> 7), 61 | t);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function round4(value: number): number {
  return Math.round(value * 10000) / 10000;
}

function toTitleCase(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function shuffleInPlace<T>(items: T[], rng: () => number): void {
  for (let i = items.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    const temp = items[i];
    items[i] = items[j];
    items[j] = temp;
  }
}

function buildReportingDates(): DatePoint[] {
  const results: DatePoint[] = [];
  for (const month of TARGET_MONTHS) {
    const daysInMonth = new Date(TARGET_YEAR, month, 0).getDate();
    for (let day = 1; day <= daysInMonth; day += 1) {
      results.push({
        day,
        month,
        year: TARGET_YEAR,
      });
    }
  }
  return results;
}

function uniqueWordPairs(count: number, rng: () => number): Array<{ adjective: string; noun: string }> {
  const combinations: Array<{ adjective: string; noun: string }> = [];
  for (const adjective of ADJECTIVES) {
    for (const noun of NOUNS) {
      combinations.push({ adjective, noun });
    }
  }
  shuffleInPlace(combinations, rng);

  if (count > combinations.length) {
    throw new Error("Not enough synthetic word combinations to build the demo plan.");
  }

  return combinations.slice(0, count);
}

function integerInRange(min: number, max: number, rng: () => number): number {
  return min + Math.floor(rng() * (max - min + 1));
}

function buildUsageItems(totalQuantity: number, rowIndex: number, rng: () => number): UsageItem[] {
  const modelA = MODELS[rowIndex % MODELS.length];
  const modelB = MODELS[(rowIndex + 1) % MODELS.length];
  const modelC = MODELS[(rowIndex + 2) % MODELS.length];

  const splitA = 0.35 + rng() * 0.25;
  const splitB = 0.2 + rng() * 0.25;

  let quantityA = Math.floor(totalQuantity * splitA);
  quantityA = Math.min(Math.max(1, quantityA), totalQuantity - 2);

  const remainingAfterA = totalQuantity - quantityA;
  let quantityB = Math.floor(totalQuantity * splitB);
  quantityB = Math.min(Math.max(1, quantityB), remainingAfterA - 1);

  const quantityC = totalQuantity - quantityA - quantityB;

  const items: UsageItem[] = [
    {
      product: "Copilot",
      sku: "Copilot Premium Request",
      model: modelA.model,
      unitType: "requests",
      pricePerUnit: modelA.unitPrice,
      grossQuantity: quantityA,
      grossAmount: round4(quantityA * modelA.unitPrice),
      discountQuantity: 0,
      discountAmount: 0,
      netQuantity: quantityA,
      netAmount: round4(quantityA * modelA.unitPrice),
    },
    {
      product: "Copilot",
      sku: "Copilot Premium Request",
      model: modelB.model,
      unitType: "requests",
      pricePerUnit: modelB.unitPrice,
      grossQuantity: quantityB,
      grossAmount: round4(quantityB * modelB.unitPrice),
      discountQuantity: 0,
      discountAmount: 0,
      netQuantity: quantityB,
      netAmount: round4(quantityB * modelB.unitPrice),
    },
    {
      product: "Copilot",
      sku: "Copilot Premium Request",
      model: modelC.model,
      unitType: "requests",
      pricePerUnit: modelC.unitPrice,
      grossQuantity: quantityC,
      grossAmount: round4(quantityC * modelC.unitPrice),
      discountQuantity: 0,
      discountAmount: 0,
      netQuantity: quantityC,
      netAmount: round4(quantityC * modelC.unitPrice),
    },
  ];

  return items;
}

function buildDemoPlan(seed = 20260711): DemoPlan {
  const rng = mulberry32(seed);
  const dates = buildReportingDates();
  const departmentPairs = uniqueWordPairs(DEPARTMENT_COUNT, rng);
  const teamPairs = uniqueWordPairs(TEAM_COUNT, rng);
  const seatPairs = uniqueWordPairs(SEAT_COUNT, rng);

  const departments: PlannedDepartment[] = departmentPairs.map(({ adjective, noun }) => ({
    name: `${SEED_PREFIX}-dept-${adjective}-${noun}`,
  }));

  const teams: PlannedTeam[] = teamPairs.map(({ adjective, noun }) => ({
    name: `${SEED_PREFIX}-project-${adjective}-${noun}`,
  }));

  const seats: PlannedSeat[] = seatPairs.map(({ adjective, noun }, index) => ({
    username: `${SEED_PREFIX}-${adjective}-${noun}-${String(index + 1).padStart(2, "0")}`,
    githubUserId: 860000 + index * 97 + integerInRange(1, 50, rng),
    firstName: toTitleCase(adjective),
    lastName: toTitleCase(noun),
    departmentName: "",
    primaryTeamName: "",
    secondaryTeamName: "",
  }));

  const seatIndexes = Array.from({ length: SEAT_COUNT }, (_, index) => index);
  shuffleInPlace(seatIndexes, rng);

  for (let index = 0; index < seatIndexes.length; index += 1) {
    const seat = seats[seatIndexes[index]];
    const departmentIndex = Math.floor(index / SEATS_PER_DEPARTMENT);
    seat.departmentName = departments[departmentIndex].name;
  }

  const primaryBuckets = Array.from({ length: TEAM_COUNT }, () => [] as number[]);
  const teamAssignmentOrder = [...seatIndexes];
  for (let index = 0; index < teamAssignmentOrder.length; index += 1) {
    const teamIndex = Math.floor(index / 6);
    primaryBuckets[teamIndex].push(teamAssignmentOrder[index]);
  }

  for (let teamIndex = 0; teamIndex < TEAM_COUNT; teamIndex += 1) {
    for (const seatIndex of primaryBuckets[teamIndex]) {
      seats[seatIndex].primaryTeamName = teams[teamIndex].name;
    }
  }

  for (const seat of seats) {
    const primaryIndex = teams.findIndex((team) => team.name === seat.primaryTeamName);
    const offset = 1 + integerInRange(0, TEAM_COUNT - 2, rng);
    const secondaryIndex = (primaryIndex + offset) % TEAM_COUNT;
    seat.secondaryTeamName = teams[secondaryIndex].name;
  }

  const snapshots: DemoPlan["snapshots"] = [];
  for (const month of TARGET_MONTHS) {
    for (const seat of seats) {
      snapshots.push({
        seatUsername: seat.username,
        teamName: seat.primaryTeamName,
        month,
        year: TARGET_YEAR,
        allocationPercentage: PRIMARY_ALLOCATION,
      });
      snapshots.push({
        seatUsername: seat.username,
        teamName: seat.secondaryTeamName,
        month,
        year: TARGET_YEAR,
        allocationPercentage: SECONDARY_ALLOCATION,
      });
    }
  }

  const usageRows: PlannedUsageRow[] = [];
  let rowIndex = 0;
  for (const date of dates) {
    for (const seat of seats) {
      const totalQuantity = integerInRange(MIN_DAILY_SEAT_AIC, MAX_DAILY_SEAT_AIC, rng);
      usageRows.push({
        seatUsername: seat.username,
        day: date.day,
        month: date.month,
        year: date.year,
        usageItems: buildUsageItems(totalQuantity, rowIndex, rng),
      });
      rowIndex += 1;
    }
  }

  return {
    departments,
    teams,
    seats,
    snapshots,
    usageRows,
    dates,
  };
}

function rowAicQuantity(row: PlannedUsageRow): number {
  return row.usageItems.reduce((total, item) => total + item.grossQuantity, 0);
}

function ensurePlanInvariants(plan: DemoPlan): void {
  if (plan.seats.length !== SEAT_COUNT) {
    throw new Error(`Expected ${SEAT_COUNT} seats, received ${plan.seats.length}.`);
  }

  if (plan.departments.length !== DEPARTMENT_COUNT) {
    throw new Error(`Expected ${DEPARTMENT_COUNT} departments, received ${plan.departments.length}.`);
  }

  if (plan.teams.length !== TEAM_COUNT) {
    throw new Error(`Expected ${TEAM_COUNT} teams, received ${plan.teams.length}.`);
  }

  if (plan.dates.length !== 92) {
    throw new Error(`Expected 92 dates from May to July 2026, received ${plan.dates.length}.`);
  }

  const departmentCounts = new Map<string, number>();
  const primaryCounts = new Map<string, number>();
  const usageByDate = new Map<string, { count: number; quantity: number }>();
  const usageByMonth = new Map<number, number>();
  const snapshotsPerSeatMonth = new Map<string, number>();

  for (const department of plan.departments) {
    departmentCounts.set(department.name, 0);
  }

  for (const team of plan.teams) {
    primaryCounts.set(team.name, 0);
  }

  for (const seat of plan.seats) {
    departmentCounts.set(seat.departmentName, (departmentCounts.get(seat.departmentName) ?? 0) + 1);
    primaryCounts.set(seat.primaryTeamName, (primaryCounts.get(seat.primaryTeamName) ?? 0) + 1);
  }

  for (const count of departmentCounts.values()) {
    if (count !== SEATS_PER_DEPARTMENT) {
      throw new Error("Department balance invariant failed: each department must have exactly 9 seats.");
    }
  }

  for (const count of primaryCounts.values()) {
    if (count !== 6) {
      throw new Error("Primary team invariant failed: each team must have exactly 6 primary seats.");
    }
  }

  for (const snapshot of plan.snapshots) {
    const seatMonthKey = `${snapshot.seatUsername}-${snapshot.month}-${snapshot.year}`;
    snapshotsPerSeatMonth.set(
      seatMonthKey,
      (snapshotsPerSeatMonth.get(seatMonthKey) ?? 0) + snapshot.allocationPercentage,
    );
  }

  for (const allocationTotal of snapshotsPerSeatMonth.values()) {
    if (allocationTotal !== 100) {
      throw new Error("Allocation invariant failed: each seat must total 100 per month.");
    }
  }

  for (const row of plan.usageRows) {
    const rowQuantity = rowAicQuantity(row);
    if (rowQuantity < MIN_DAILY_SEAT_AIC || rowQuantity > MAX_DAILY_SEAT_AIC) {
      throw new Error("Usage invariant failed: each seat/day raw AIC must be in 2,000-6,000.");
    }

    for (const item of row.usageItems) {
      if (!Number.isInteger(item.grossQuantity)) {
        throw new Error("Usage invariant failed: grossQuantity must be integer.");
      }
      if (item.netQuantity !== item.grossQuantity || item.netAmount !== item.grossAmount) {
        throw new Error("Usage invariant failed: net and gross values must match.");
      }
    }

    const dateKey = `${row.year}-${String(row.month).padStart(2, "0")}-${String(row.day).padStart(2, "0")}`;
    const current = usageByDate.get(dateKey) ?? { count: 0, quantity: 0 };
    usageByDate.set(dateKey, {
      count: current.count + 1,
      quantity: current.quantity + rowQuantity,
    });

    usageByMonth.set(row.month, (usageByMonth.get(row.month) ?? 0) + 1);
  }

  if (plan.usageRows.length !== 3312) {
    throw new Error(`Usage invariant failed: expected 3312 rows, received ${plan.usageRows.length}.`);
  }

  for (const month of TARGET_MONTHS) {
    const expectedRows = month === 6 ? 1080 : 1116;
    if ((usageByMonth.get(month) ?? 0) !== expectedRows) {
      throw new Error(`Usage invariant failed: month ${month} must have ${expectedRows} rows.`);
    }
  }

  for (const stats of usageByDate.values()) {
    if (stats.count !== SEAT_COUNT) {
      throw new Error("Usage invariant failed: each date must have 36 rows.");
    }
    if (stats.quantity < 72000 || stats.quantity > 216000) {
      throw new Error("Usage invariant failed: each date aggregate must be in 72,000-216,000.");
    }
  }
}

async function deleteReportingTables(manager: EntityManager): Promise<void> {
  await manager.createQueryBuilder().delete().from(CopilotUsageEntity).execute();
  await manager.createQueryBuilder().delete().from(TeamMemberSnapshotEntity).execute();
  await manager.createQueryBuilder().delete().from(DashboardMonthlySummaryEntity).execute();
  await manager.createQueryBuilder().delete().from(CopilotSeatEntity).execute();
  await manager.createQueryBuilder().delete().from(TeamEntity).execute();
  await manager.createQueryBuilder().delete().from(DepartmentEntity).execute();
}

async function insertPlan(manager: EntityManager, plan: DemoPlan): Promise<Omit<SeedResult, "summaryCount" | "startDate" | "endDate">> {
  const departments = await manager.getRepository(DepartmentEntity).save(
    plan.departments.map((department) => ({ name: department.name })),
  );

  const teams = await manager.getRepository(TeamEntity).save(
    plan.teams.map((team) => ({ name: team.name })),
  );

  const departmentIdByName = new Map(departments.map((row) => [row.name, row.id]));
  const teamIdByName = new Map(teams.map((row) => [row.name, row.id]));

  const seatsToInsert: Array<Partial<CopilotSeat>> = plan.seats.map((seat) => {
    const departmentId = departmentIdByName.get(seat.departmentName);
    if (!departmentId) {
      throw new Error(`Missing inserted department '${seat.departmentName}'.`);
    }

    return {
      githubUsername: seat.username,
      githubUserId: seat.githubUserId,
      status: SeatStatus.ACTIVE,
      firstName: seat.firstName,
      lastName: seat.lastName,
      department: seat.departmentName,
      departmentId,
    };
  });

  const insertedSeats = await manager.getRepository(CopilotSeatEntity).save(seatsToInsert);
  const seatIdByUsername = new Map(insertedSeats.map((row) => [row.githubUsername, row.id]));

  const snapshotsToInsert = plan.snapshots.map((snapshot) => {
    const teamId = teamIdByName.get(snapshot.teamName);
    const seatId = seatIdByUsername.get(snapshot.seatUsername);
    if (!teamId || !seatId) {
      throw new Error("Missing inserted seat/team while inserting snapshots.");
    }

    return {
      teamId,
      seatId,
      month: snapshot.month,
      year: snapshot.year,
      allocationPercentage: snapshot.allocationPercentage,
    };
  });

  await manager.getRepository(TeamMemberSnapshotEntity).save(snapshotsToInsert);

  const usageRowsToInsert = plan.usageRows.map((row) => {
    const seatId = seatIdByUsername.get(row.seatUsername);
    if (!seatId) {
      throw new Error(`Missing inserted seat '${row.seatUsername}' while inserting usage.`);
    }

    return {
      seatId,
      day: row.day,
      month: row.month,
      year: row.year,
      source: CopilotUsageSource.CSV_IMPORT,
      usageItems: row.usageItems,
    };
  });

  await manager.getRepository(CopilotUsageEntity).save(usageRowsToInsert);

  return {
    departmentCount: departments.length,
    teamCount: teams.length,
    seatCount: insertedSeats.length,
    snapshotCount: snapshotsToInsert.length,
    usageRowCount: usageRowsToInsert.length,
  };
}

async function runSeedWithManager(manager: EntityManager): Promise<SeedResult> {
  const plan = buildDemoPlan();
  ensurePlanInvariants(plan);

  await deleteReportingTables(manager);

  if (process.env.DEMO_SEED_FAIL_AFTER_CLEANUP === "1") {
    throw new Error("Injected failure after cleanup for rollback verification.");
  }

  const inserted = await insertPlan(manager, plan);

  for (const month of TARGET_MONTHS) {
    await refreshDashboardMetrics(month, TARGET_YEAR, manager);
  }

  const summaryCount = await manager
    .getRepository(DashboardMonthlySummaryEntity)
    .count({ where: TARGET_MONTHS.map((month) => ({ month, year: TARGET_YEAR })) });

  return {
    ...inserted,
    summaryCount,
    startDate: "2026-05-01",
    endDate: "2026-07-31",
  };
}

export async function seedDemoMayJuly2026(
  databaseUrlFromEnv = process.env.DATABASE_URL,
  options?: { dataSource?: DataSource },
): Promise<SeedResult> {
  const guardConfig = parseGuardConfig({
    ...process.env,
    DATABASE_URL: databaseUrlFromEnv,
  });
  const safeTarget = validateTargetSafety(guardConfig);

  console.log(
    `Replacing reporting data on loopback target host='${safeTarget.host}', db='${safeTarget.database}'.`,
  );

  const dataSource = options?.dataSource ?? AppDataSource;
  const ownsLifecycle = !options?.dataSource;

  if (ownsLifecycle && !dataSource.isInitialized) {
    await dataSource.initialize();
  }

  try {
    const result = await dataSource.transaction(async (manager) => runSeedWithManager(manager));
    console.log(
      `Reporting replacement complete: seats=${result.seatCount}, departments=${result.departmentCount}, teams=${result.teamCount}, snapshots=${result.snapshotCount}, usageRows=${result.usageRowCount}, summaries=${result.summaryCount}, range=${result.startDate}..${result.endDate}, perSeatAic=${MIN_DAILY_SEAT_AIC}-${MAX_DAILY_SEAT_AIC}.`,
    );
    return result;
  } finally {
    if (ownsLifecycle && dataSource.isInitialized) {
      await dataSource.destroy();
    }
  }
}

export const demoSeedInternals = {
  SEED_PREFIX,
  CONFIRMATION_TOKEN,
  REQUIRED_CONFIRMATION_ENV,
  TARGET_MONTHS,
  TARGET_YEAR,
  MIN_DAILY_SEAT_AIC,
  MAX_DAILY_SEAT_AIC,
  buildDemoPlan,
  ensurePlanInvariants,
  parseGuardConfig,
  validateTargetSafety,
  runSeedWithManager,
};

if (require.main === module) {
  seedDemoMayJuly2026()
    .then(() => {
      process.exit(0);
    })
    .catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`Demo reporting replacement failed: ${message}`);
      process.exit(1);
    });
}
