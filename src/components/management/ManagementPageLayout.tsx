"use client";

import { useSearchParams, useRouter, usePathname } from "next/navigation";
import { useCallback, useEffect } from "react";
import ConfigurationTabContent from "@/components/management/ConfigurationTabContent";
import UsageImportsPanel from "@/components/management/UsageImportsPanel";
import DepartmentManagementPanel from "@/components/departments/DepartmentManagementPanel";
import TeamManagementPanel from "@/components/teams/TeamManagementPanel";
import UserManagementPanel from "@/components/users/UserManagementPanel";
import AzureUserManagementNotice from "@/components/users/AzureUserManagementNotice";
import SeatListPanel from "@/components/seats/SeatListPanel";
import SeatJobStatusCards from "@/components/seats/SeatJobStatusCards";
import type { AuthMethod } from "@/lib/auth-config";

const TABS = [
  { id: "seats", label: "Seats" },
  { id: "usage-imports", label: "Usage Imports" },
  { id: "departments", label: "Departments" },
  { id: "teams", label: "Project Teams" },
  { id: "users", label: "Users" },
  { id: "configuration", label: "Configuration" },
] as const;

type TabId = (typeof TABS)[number]["id"];

const VALID_TAB_IDS = new Set<string>(TABS.map((t) => t.id));
const DEFAULT_TAB: TabId = "seats";

function resolveTab(param: string | null): TabId {
  if (param && VALID_TAB_IDS.has(param)) {
    return param as TabId;
  }
  return DEFAULT_TAB;
}

export default function ManagementPageLayout({ authMethod }: { authMethod: AuthMethod }) {
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();

  const activeTab = resolveTab(searchParams.get("tab"));

  // Normalize URL: if no tab param is present, add the default tab to ensure
  // NavBar active state and bookmarkability are consistent
  useEffect(() => {
    if (!searchParams.has("tab")) {
      const params = new URLSearchParams(searchParams.toString());
      params.set("tab", DEFAULT_TAB);
      router.replace(`${pathname}?${params.toString()}`);
    }
  }, [searchParams, router, pathname]);

  const handleTabChange = useCallback(
    (tabId: TabId) => {
      const params = new URLSearchParams(searchParams.toString());
      params.set("tab", tabId);
      router.push(`${pathname}?${params.toString()}`);
    },
    [searchParams, router, pathname],
  );

  return (
    <div className="space-y-6">
      <div
        role="tablist"
        aria-label="Management tabs"
        className="flex gap-1 border-b border-gray-200"
      >
        {TABS.map((tab) => {
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              role="tab"
              aria-selected={isActive}
              aria-controls={`tabpanel-${tab.id}`}
              id={`tab-${tab.id}`}
              onClick={() => handleTabChange(tab.id)}
              className={`px-4 py-2 text-sm font-medium rounded-t-md border-b-2 transition-colors cursor-pointer ${
                isActive
                  ? "border-blue-600 text-blue-600 bg-white"
                  : "border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300"
              }`}
            >
              {tab.label}
            </button>
          );
        })}
      </div>

      {activeTab === "configuration" && (
        <div
          role="tabpanel"
          id="tabpanel-configuration"
          aria-labelledby="tab-configuration"
        >
          <ConfigurationTabContent />
        </div>
      )}

      {activeTab === "departments" && (
        <div
          role="tabpanel"
          id="tabpanel-departments"
          aria-labelledby="tab-departments"
        >
          <DepartmentManagementPanel />
        </div>
      )}

      {activeTab === "teams" && (
        <div
          role="tabpanel"
          id="tabpanel-teams"
          aria-labelledby="tab-teams"
        >
          <TeamManagementPanel />
        </div>
      )}

      {activeTab === "users" && (
        <div
          role="tabpanel"
          id="tabpanel-users"
          aria-labelledby="tab-users"
        >
          {authMethod === "azure" ? (
            <AzureUserManagementNotice />
          ) : (
            <UserManagementPanel />
          )}
        </div>
      )}

      {activeTab === "seats" && (
        <div
          role="tabpanel"
          id="tabpanel-seats"
          aria-labelledby="tab-seats"
          className="space-y-6"
        >
          <SeatJobStatusCards />
          <SeatListPanel />
        </div>
      )}

      {activeTab === "usage-imports" && (
        <div
          role="tabpanel"
          id="tabpanel-usage-imports"
          aria-labelledby="tab-usage-imports"
          className="space-y-6"
        >
          <UsageImportsPanel />
        </div>
      )}
    </div>
  );
}
