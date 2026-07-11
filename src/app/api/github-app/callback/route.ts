import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { GitHubAppEntity } from "@/entities/github-app.entity";
import { encrypt } from "@/lib/encryption";
import { githubAppCallbackSchema } from "@/lib/validations/github-app";
import { handleRouteError, validateBody, isValidationError } from "@/lib/api-helpers";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const dataSource = await getDb();
    const repository = dataSource.getRepository(GitHubAppEntity);

    const existing = await repository.findOne({ where: {} });
    if (existing) {
      return NextResponse.json(
        { error: "GitHub App already exists" },
        { status: 409 },
      );
    }

    const parsed = await validateBody(request, githubAppCallbackSchema);
    if (isValidationError(parsed)) return parsed;

    const { code } = parsed.data;

    const githubResponse = await fetch(
      `https://api.github.com/app-manifests/${encodeURIComponent(code)}/conversions`,
      {
        method: "POST",
        headers: {
          Accept: "application/vnd.github+json",
        },
      },
    );

    if (!githubResponse.ok) {
      const status = githubResponse.status;
      if (status === 404) {
        return NextResponse.json(
          { error: "Code expired or already used. Please try again." },
          { status: 400 },
        );
      }
      if (status === 422) {
        return NextResponse.json(
          {
            error:
              "GitHub App name already exists. Please retry — a new name will be generated automatically.",
          },
          { status: 422 },
        );
      }
      return NextResponse.json(
        { error: "Failed to exchange code with GitHub" },
        { status: 502 },
      );
    }

    const data = await githubResponse.json();

    const app = repository.create({
      appId: data.id,
      appSlug: data.slug,
      appName: data.name,
      privateKeyEncrypted: encrypt(data.pem),
      webhookSecretEncrypted: encrypt(data.webhook_secret),
      clientId: data.client_id,
      clientSecretEncrypted: encrypt(data.client_secret),
      htmlUrl: data.html_url,
      ownerId: data.owner.id,
      ownerLogin: data.owner.login,
    });
    const saved = await repository.save(app);

    return NextResponse.json(
      {
        appName: saved.appName,
        appSlug: saved.appSlug,
        htmlUrl: saved.htmlUrl,
      },
      { status: 201 },
    );
  } catch (error) {
    return handleRouteError(error, "POST /api/github-app/callback", {
      uniqueViolationMessage: "GitHub App already exists",
    });
  }
}
