import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { GitHubAppEntity } from "@/entities/github-app.entity";
import { ConfigurationEntity } from "@/entities/configuration.entity";
import { ApiMode } from "@/entities/enums";
import { decrypt } from "@/lib/encryption";
import { generateAppJwt } from "@/lib/github-jwt";
import { githubAppInstallSchema } from "@/lib/validations/github-app";
import {
  handleRouteError,
  validateBody,
  isValidationError,
} from "@/lib/api-helpers";
import { seedDefaultAdmin } from "@/lib/auth";
import { getAuthMethod } from "@/lib/auth-config";

export const runtime = "nodejs";

const TARGET_TYPE_MAP: Record<string, ApiMode> = {
  Organization: ApiMode.ORGANISATION,
  Enterprise: ApiMode.ENTERPRISE,
};

export async function POST(request: Request) {
  try {
    const dataSource = await getDb();

    const configRepo = dataSource.getRepository(ConfigurationEntity);
    const existingConfig = await configRepo.findOne({ where: {} });
    if (existingConfig) {
      return NextResponse.json(
        { error: "Configuration already exists" },
        { status: 409 },
      );
    }

    const parsed = await validateBody(request, githubAppInstallSchema);
    if (isValidationError(parsed)) return parsed;

    const { installationId } = parsed.data;

    const appRepo = dataSource.getRepository(GitHubAppEntity);
    const app = await appRepo.findOne({ where: {} });
    if (!app) {
      return NextResponse.json(
        { error: "GitHub App not found. Please create one first." },
        { status: 404 },
      );
    }

    if (app.installationId !== null) {
      return NextResponse.json(
        { error: "GitHub App is already installed" },
        { status: 409 },
      );
    }

    const decryptedKey = decrypt(app.privateKeyEncrypted);
    const jwt = generateAppJwt(app.appId, decryptedKey);

    const ghResponse = await fetch(
      `https://api.github.com/app/installations/${encodeURIComponent(String(installationId))}`,
      {
        headers: {
          Authorization: `Bearer ${jwt}`,
          Accept: "application/vnd.github+json",
        },
      },
    );

    if (!ghResponse.ok) {
      const status = ghResponse.status;
      if (status === 404) {
        return NextResponse.json(
          {
            error:
              "Installation not found. The installation ID may be invalid or expired.",
          },
          { status: 400 },
        );
      }
      if (status === 401 || status === 403) {
        return NextResponse.json(
          {
            error:
              "Failed to authenticate with GitHub. The App credentials may be invalid.",
          },
          { status: 502 },
        );
      }
      return NextResponse.json(
        { error: "Failed to verify installation with GitHub" },
        { status: 502 },
      );
    }

    const installation = await ghResponse.json();

    if (installation.app_id !== app.appId) {
      return NextResponse.json(
        { error: "Installation does not belong to this GitHub App" },
        { status: 400 },
      );
    }

    const apiMode = TARGET_TYPE_MAP[installation.target_type];
    if (!apiMode) {
      return NextResponse.json(
        {
          error: `GitHub App was installed on a ${installation.target_type} account, which is not supported. Please install it on an organisation or enterprise.`,
        },
        { status: 400 },
      );
    }

    const entityName: string = installation.account.login;

    await dataSource.transaction(async (manager) => {
      await manager.getRepository(GitHubAppEntity).update(app.id, {
        installationId,
      });
      await manager.getRepository(ConfigurationEntity).save({
        apiMode,
        entityName,
      });
    });

    if (getAuthMethod() === "credentials") {
      await seedDefaultAdmin();
    }

    return NextResponse.json(
      { entityName, apiMode, installationId },
      { status: 201 },
    );
  } catch (error) {
    return handleRouteError(error, "POST /api/github-app/install", {
      uniqueViolationMessage: "Configuration already exists",
    });
  }
}
