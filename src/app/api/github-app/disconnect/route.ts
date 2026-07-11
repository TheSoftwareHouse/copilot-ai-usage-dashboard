import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { GitHubAppEntity } from "@/entities/github-app.entity";
import { ConfigurationEntity } from "@/entities/configuration.entity";
import { requireAdmin, isAuthFailure } from "@/lib/api-auth";
import { handleRouteError } from "@/lib/api-helpers";
import { decrypt } from "@/lib/encryption";
import { generateAppJwt } from "@/lib/github-jwt";

export const runtime = "nodejs";

export async function POST() {
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

    if (app.installationId === null) {
      return NextResponse.json(
        { error: "No organisation is currently connected" },
        { status: 404 },
      );
    }

    let githubUninstalled = false;
    try {
      const privateKeyPem = decrypt(app.privateKeyEncrypted);
      const jwt = generateAppJwt(app.appId, privateKeyPem);
      const url = `https://api.github.com/app/installations/${encodeURIComponent(String(app.installationId))}`;
      const response = await fetch(url, {
        method: "DELETE",
        headers: {
          Accept: "application/vnd.github+json",
          Authorization: `Bearer ${jwt}`,
          "X-GitHub-Api-Version": "2022-11-28",
        },
      });
      if (response.status === 204 || response.status === 404) {
        githubUninstalled = true;
      }
    } catch (err) {
      console.warn("[disconnect] Best-effort GitHub uninstall failed:", err instanceof Error ? err.message : "unknown error");
    }

    await dataSource.transaction(async (manager) => {
      await manager
        .getRepository(GitHubAppEntity)
        .update({ id: app.id }, { installationId: null });
      await manager
        .createQueryBuilder()
        .delete()
        .from(ConfigurationEntity)
        .execute();
    });

    return NextResponse.json({
      message: "Organisation disconnected successfully",
      githubUninstalled,
    });
  } catch (error) {
    return handleRouteError(error, "POST /api/github-app/disconnect");
  }
}
