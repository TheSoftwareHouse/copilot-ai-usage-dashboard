"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { useAsyncFetch } from "@/lib/hooks/useAsyncFetch";
import DepartmentUsageChart from "@/components/usage/DepartmentUsageChart";
import DepartmentUsageTable from "@/components/usage/DepartmentUsageTable";
import DepartmentUsageStatsCards from "@/components/usage/DepartmentUsageStatsCards";
import { isAicReportingMonth } from "@/lib/aic-reporting";

export interface DepartmentUsageEntry {
  departmentId: number;
  departmentName: string;
  memberCount: number;
  totalRequests: number;
  totalGrossAmount: number;
  averageRequestsPerMember: number;
  usagePercent: number;
}

interface DepartmentUsageResponse {
  departments: DepartmentUsageEntry[];
  total: number;
  month: number;
  year: number;
}

interface DepartmentUsagePanelProps {
  month: number;
  year: number;
}

function readSearchFromUrl(): string {
  if (typeof window === "undefined") return "";
  const params = new URLSearchParams(window.location.search);
  return params.get("search") ?? "";
}

export default function DepartmentUsagePanel({
  month,
  year,
}: DepartmentUsagePanelProps) {
  const isAicMode = isAicReportingMonth(month, year);
  const router = useRouter();
  const [searchInput, setSearchInput] = useState(() => readSearchFromUrl());
  const [search, setSearch] = useState(() => readSearchFromUrl());

  // Debounce search input → search (300 ms)
  useEffect(() => {
    const timer = setTimeout(() => {
      setSearch(searchInput);
    }, 300);
    return () => clearTimeout(timer);
  }, [searchInput]);

  // Persist search query in URL
  const updateSearchUrl = useCallback((value: string) => {
    const url = new URL(window.location.href);
    if (value) {
      url.searchParams.set("search", value);
    } else {
      url.searchParams.delete("search");
    }
    window.history.replaceState(null, "", url.toString());
  }, []);

  useEffect(() => {
    updateSearchUrl(search);
  }, [search, updateSearchUrl]);

  const { data, loading, error } = useAsyncFetch<DepartmentUsageResponse>(
    `/api/usage/departments?month=${month}&year=${year}`,
  );

  // Client-side filtering by department name
  const filteredDepartments = data?.departments.filter((dept) =>
    search
      ? dept.departmentName.toLowerCase().includes(search.toLowerCase())
      : true,
  );

  const searchBox = (
    <div>
      <label htmlFor="department-usage-search" className="sr-only">
        Search departments
      </label>
      <input
        id="department-usage-search"
        type="search"
        placeholder="Search departments…"
        value={searchInput}
        onChange={(e) => setSearchInput(e.target.value)}
        className="block w-full rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-900 placeholder-gray-400 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
      />
    </div>
  );

  if (loading) {
    return (
      <div className="space-y-4">
        {!isAicMode && <DepartmentUsageStatsCards month={month} year={year} />}
        {searchBox}
        <div className="flex items-center justify-center py-12" role="status">
          <p className="text-sm text-gray-500">
            Loading department usage data…
          </p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="space-y-4">
        {!isAicMode && <DepartmentUsageStatsCards month={month} year={year} />}
        {searchBox}
        <div
          className="rounded-lg border border-red-200 bg-red-50 p-6"
          role="alert"
        >
          <p className="text-sm text-red-700">{error}</p>
        </div>
      </div>
    );
  }

  if (!data || data.total === 0) {
    return (
      <div className="space-y-4">
        {!isAicMode && <DepartmentUsageStatsCards month={month} year={year} />}
        {searchBox}
        <div className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
          <p className="text-sm text-gray-500">
            No departments have been defined yet. Create departments in Settings
            to see aggregated usage.
          </p>
        </div>
      </div>
    );
  }

  if (filteredDepartments && filteredDepartments.length === 0) {
    return (
      <div className="space-y-4">
        {!isAicMode && <DepartmentUsageStatsCards month={month} year={year} />}
        {searchBox}
        <div className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
          <p className="text-sm text-gray-500">
            No departments match your search query.
          </p>
        </div>
      </div>
    );
  }

  const departments = filteredDepartments ?? data.departments;

  return (
    <div className="space-y-4">
      {!isAicMode && <DepartmentUsageStatsCards month={month} year={year} />}
      {searchBox}
      {!isAicMode && (
        <DepartmentUsageChart
          departments={departments}
          onBarClick={(departmentId) =>
            router.push(
              `/usage/departments/${departmentId}?month=${month}&year=${year}`,
            )
          }
        />
      )}
      <DepartmentUsageTable
        departments={departments}
        month={month}
        year={year}
      />
    </div>
  );
}
