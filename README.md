# Copilot AI Usage Dashboard

**Take control of your GitHub Copilot spending.** Copilot AI Usage Dashboard gives engineering leaders full visibility into how their organization uses GitHub Copilot — across seats, teams, and departments — so they can optimize adoption and manage AI Credits (AIC) costs before they spiral.

Built with [Copilot Collections](https://copilot-collections.tsh.io) by [The Software House](https://tsh.io).

---

<p align="center">
  <img src="images/dashboard.png" width="32%" />
  <img src="images/seats.png" width="32%" />
  <img src="images/department.png" width="32%" />
</p>

## 🤔 The Problem

GitHub Copilot is a powerful tool, but organizations adopting it at scale face real challenges:

- 💸 **No spending visibility** — GitHub provides limited insight into per-user and per-team AI Credits usage costs. You see the bill, not the breakdown.
- 🪑 **Inactive seats burn money** — Seats assigned to users who rarely (or never) use Copilot keep costing the same as active ones. Identifying them manually is tedious.
- 👥 **No team-level accountability** — Engineering managers can't see how their team's usage compares to others, making it impossible to justify costs or encourage adoption.
- 🚨 **AIC cost spikes** — Usage can jump quickly for specific seats or teams, and without clear breakdowns those spikes often surface only when the invoice arrives.
- 📉 **Historical tracking is missing** — Team compositions change month-over-month, but there's no built-in way to track usage trends over time as people move between teams.

<p align="center">
  <img src="images/seats.png" width="49%" />
  <img src="images/sync.png" width="49%" />
</p>

## ✨ Key Features

### 📊 Dashboard & Analytics
- **Monthly usage overview** with total seats, active seats, spending, and AIC metrics at a glance
- **Per-user breakdown** — see exactly how many AIC units each person used and what it cost
- **AIC totals tracking** — monitor imported AIC units and gross AIC spending over time
- **Model-level cost breakdown** — understand spending per AI model (Claude Sonnet, GPT-4o, etc.)
- **Most & least active users** — instantly spot top contributors and inactive seats
- **Spending breakdown** — separate seat license costs from AIC usage spending
- **Monthly snapshots** — team compositions are tracked per month so historical comparisons remain accurate even when people move between teams

### ⚙️ Automated Data Collection
- **Background jobs** run on a configurable schedule (default: daily at midnight UTC)
- **Team carry-forward** copies team member allocations into the new month for consistent historical reporting
- **Seat sync** pulls the latest seat list from GitHub

### 💺 Organisation Management
- **Teams** — group seats into teams, track usage per team, and compare across teams
- **Departments** — organize seats into departments for higher-level reporting
- **Usage Imports** — import AIC usage CSV exports through the management interface
- **Editable metadata** — assign first name, last name, and department to each seat

### 🔐 Security & Authentication
- **Two authentication modes**: built-in credentials or Azure Entra ID (Azure AD) via OAuth 2.0 PKCE
- **GitHub App integration** — no long-lived tokens. Credentials are stored encrypted in the database using AES-256
- **Setup wizard** — guided first-run flow creates the GitHub App, installs it on your organization, and configures everything through the UI

---

## 🔧 Configuration

### Environment Variables

#### Required

| Variable | Description |
|----------|-------------|
| `DATABASE_URL` | PostgreSQL connection string (e.g. `postgres://user:pass@host:5432/dbname`) |
| `ENCRYPTION_KEY` | 64-char hex string for encrypting GitHub App credentials. Generate with `openssl rand -hex 32` |
| `APP_BASE_URL` | Public URL of the application (e.g. `https://copilot-dashboard.yourcompany.com`) |
| `DEFAULT_ADMIN_USERNAME` | Username for the initial local credentials-mode admin account. Not needed for Azure mode, where access is managed through Azure AD. |
| `DEFAULT_ADMIN_PASSWORD` | Password for the initial local credentials-mode admin account. Not needed for Azure mode, where access is managed through Azure AD. |

#### Authentication

| Variable | Description | Default |
|----------|-------------|---------|
| `AUTH_METHOD` | `credentials` (built-in login) or `azure` (Azure Entra ID SSO) | `credentials` |
| `SESSION_TIMEOUT_HOURS` | Session expiry in hours | `24` |

When using Azure Entra ID (`AUTH_METHOD=azure`):

| Variable | Description |
|----------|-------------|
| `AZURE_TENANT_ID` | Azure AD tenant ID |
| `AZURE_CLIENT_ID` | Azure AD application (client) ID |
| `AZURE_REDIRECT_URI` | OAuth callback URL (e.g. `https://copilot-dashboard.yourcompany.com/api/auth/callback`) |

#### Data Sync

| Variable | Description | Default |
|----------|-------------|---------|
| `SYNC_CRON_SCHEDULE` | Preferred cron expression for background sync jobs. If no schedule variable is set, instrumentation uses `0 0 * * *` (daily at midnight UTC). | `0 0 * * *` |
| `SYNC_INTERVAL_HOURS` / `SEAT_SYNC_INTERVAL_HOURS` | Legacy compatibility variables. Instrumentation converts a whole-number interval to a cron schedule when `SYNC_CRON_SCHEDULE` is not set. | — |
| `SEAT_SYNC_ENABLED` | Enable automatic seat synchronization | `true` |
| `USAGE_COLLECTION_ENABLED` | Enable automatic usage data collection. Usage collection runs after a successful seat sync, or when seat sync is disabled. | `true` |
| `SEAT_SYNC_RUN_ON_STARTUP` | Trigger the full sequential sync cycle after startup: team carry-forward, seat sync when enabled, then usage collection when enabled | `false` |
| `USAGE_COLLECTION_RUN_ON_STARTUP` | Trigger the full sequential sync cycle after startup: team carry-forward, seat sync when enabled, then usage collection when enabled | `false` |

`SYNC_CRON_SCHEDULE` takes precedence over the legacy interval variables. Docker Compose currently supplies `SEAT_SYNC_INTERVAL_HOURS=1` by default, so set `SYNC_CRON_SCHEDULE` explicitly when using Compose if you want the daily default.

> **Note:** No GitHub token environment variable is required — GitHub App credentials are stored encrypted in the database and configured through the setup wizard.

### 🐙 GitHub App Setup

The dashboard connects to GitHub through a GitHub App (not a personal access token). On first launch, the setup wizard walks you through:

1. **Create the GitHub App** — the app generates a manifest and redirects you to GitHub to create it
2. **Install on your organization** — select which organization (or enterprise) to monitor
3. **Automatic configuration** — the app detects your setup (org vs. enterprise) and starts syncing

No manual token management needed. The private key is encrypted at rest in the database.

---

## 🚀 Installation

### 🐳 Docker (Recommended)

The fastest way to get running. The Docker image includes automatic database migrations on startup.

**1. Create a `.env` file:**

```env
DATABASE_URL=postgresql://postgres:postgres@postgres:5432/copilot_dashboard
ENCRYPTION_KEY=          # Generate with: openssl rand -hex 32
APP_BASE_URL=http://localhost:3000
DEFAULT_ADMIN_USERNAME=admin
DEFAULT_ADMIN_PASSWORD=changeme
```

**2. Start the application:**

```bash
docker compose up
```

This starts PostgreSQL, the application, and Adminer at `http://localhost:8080`. The image runs database migrations before starting Next.js, launches the dashboard on `http://localhost:3000`, and exposes a health check at `http://localhost:3000/api/health`.

**3. Complete the setup wizard** — open the app in your browser, log in with your admin credentials, and follow the guided GitHub App setup.

### 🛠️ Development Setup

```bash
# Install dependencies
npm install

# Start PostgreSQL
docker compose up postgres -d

# Run database migrations
npm run typeorm:migrate

# Start development server
npm run dev
```

Use `npm run typeorm:generate` to generate a migration and `npm run typeorm:revert` to revert the latest migration.

### Available Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Start Next.js dev server |
| `npm run build` | Production build |
| `npm run start` | Start the production server |
| `npm run lint` | ESLint |
| `npm run test` | Run unit/integration tests |
| `npm run test:watch` | Run tests in watch mode |
| `npm run test:e2e` | Run E2E tests (credentials mode) |
| `npm run typeorm` | Run the TypeORM CLI wrapper |
| `npm run typeorm:generate` | Generate a TypeORM migration |
| `npm run typeorm:migrate` | Run pending TypeORM migrations |
| `npm run typeorm:revert` | Revert the latest TypeORM migration |
| `npm run seed:demo:may-july-2026` | Replace reporting data with deterministic synthetic demo data for May-July 2026 |
| `npx tsc --noEmit` | Type checking (no package script is defined) |
| `npm run test:e2e -- --config playwright.azure.config.ts` | Run E2E tests (Azure mode) |

### May-July 2026 Demo Seed (Local Only)

Use the command below to destructively replace reporting data with a deterministic synthetic corpus for May 1 through July 31, 2026:

```bash
CONFIRM_REPORTING_DATA_REPLACEMENT=may-july-2026 npm run seed:demo:may-july-2026
```

Safety and scope rules:

- Missing or incorrect `CONFIRM_REPORTING_DATA_REPLACEMENT` fails before mutation.
- The command always refuses non-loopback hosts. Only `localhost`, `127.0.0.1`, and `::1` are accepted.
- The database name must include `local`, `demo`, or `test`.
- `ALLOW_DEMO_SEED=1` bypasses only the database-name rule. It cannot bypass loopback-host validation or confirmation.
- The command deletes all rows from exactly these reporting tables in this order: `copilot_usage`, `team_member_snapshot`, `dashboard_monthly_summary`, `copilot_seat`, `team`, `department`.
- The command preserves these protected tables: `configuration`, `app_user`, `session`, `github_app`, `job_execution`, `import_history`.
- Seed shape is fixed: 36 seats, 4 departments (9 seats each), 6 teams, and one usage row per seat/date from May 1 to July 31 (92 dates, 3,312 rows total; May 1,116 rows, June 1,080 rows, July 1,116 rows).
- Raw AIC bounds are fixed: each seat/day totals 2,000-6,000 AIC; with 36 seats, each date aggregate is 72,000-216,000 AIC.
- On any failure before commit, the transaction rolls back to the prior reporting state.
- After a successful commit, prior reporting data is intentionally replaced; recovery requires restoring a backup taken before running the command.

---

## 🧱 Tech Stack

- **Next.js 16** (App Router, React 19, standalone output)
- **PostgreSQL 16** with TypeORM
- **Tailwind CSS 4**
- **Recharts** for data visualization
- **Arctic** for Azure Entra ID OAuth
- **node-cron** for background job scheduling

---

## 📄 License

[MIT](LICENSE)
