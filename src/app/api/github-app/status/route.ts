import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { GitHubAppEntity } from "@/entities/github-app.entity";
import { ConfigurationEntity } from "@/entities/configuration.entity";
import { decrypt } from "@/lib/encryption";
import { requireAdmin, isAuthFailure } from "@/lib/api-auth";
import { handleRouteError } from "@/lib/api-helpers";
import {
  checkInstallationStatus,
  type ConnectionStatus,
} from "@/lib/github-installation-status";

export const runtime = "nodejs";

type ApiConnectionStatus = ConnectionStatus | "not_installed";

export async function GET() {
  try {
    const auth = await requireAdmin();
    if (isAuthFailure(auth)) return auth;

    const dataSource = await getDb();

    const app = await dataSource
      .getRepository(GitHubAppEntity)
      .findOne({ where: {} });
    if (!app) {
      return NextResponse.json(
        { error: "GitHub App not found" },
        { status: 404 },
      );
    }

    const config = await dataSource
      .getRepository(ConfigurationEntity)
      .findOne({ where: {} });
    if (!config) {
      return NextResponse.json(
        { error: "Configuration not found" },
        { status: 404 },
      );
    }

    let connectionStatus: ApiConnectionStatus;
    let statusMessage: string | undefined;

    if (app.installationId === null) {
      connectionStatus = "not_installed";
      statusMessage =
        "GitHub App is not installed on any organisation. Complete the installation flow.";
    } else {
      const decryptedKey = decrypt(app.privateKeyEncrypted);
      const result = await checkInstallationStatus(
        app.appId,
        decryptedKey,
        app.installationId,
      );
      connectionStatus = result.status;
      statusMessage = result.statusMessage;
    }

    return NextResponse.json({
      appName: app.appName,
      appSlug: app.appSlug,
      htmlUrl: app.htmlUrl,
      entityName: config.entityName,
      apiMode: config.apiMode,
      connectionDate: config.createdAt.toISOString(),
      connectionStatus,
      ...(statusMessage ? { statusMessage } : {}),
    });
  } catch (error) {
    return handleRouteError(error, "GET /api/github-app/status");
  }
}
