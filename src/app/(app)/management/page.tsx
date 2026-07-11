import { Suspense } from "react";
import { redirect } from "next/navigation";
import ManagementPageLayout from "@/components/management/ManagementPageLayout";
import { getSession } from "@/lib/auth";
import { getAuthMethod } from "@/lib/auth-config";
import { UserRole } from "@/entities/enums";

export const metadata = {
  title: "Management — Copilot Dashboard",
};

export const dynamic = "force-dynamic";

export default async function ManagementPage() {
  const session = await getSession();
  if (session?.user.role !== UserRole.ADMIN) {
    redirect("/dashboard");
  }

  const authMethod = getAuthMethod();

  return (
    <main className="min-h-screen bg-gray-50 px-4 py-12">
      <div className="mx-auto max-w-5xl">
        <h1 className="text-2xl font-bold text-gray-900">Management</h1>
        <p className="mt-2 text-sm text-gray-600">
          Configure the application, manage Usage Imports, departments, teams,
          users, and seats from a single place.
        </p>

        <div className="mt-8">
          <Suspense
            fallback={
              <div className="py-8 text-center text-sm text-gray-500">
                Loading…
              </div>
            }
          >
            <ManagementPageLayout authMethod={authMethod} />
          </Suspense>
        </div>
      </div>
    </main>
  );
}
