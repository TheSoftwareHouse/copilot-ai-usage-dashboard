"use client";

import { useState, useEffect, useCallback } from "react";
import { useAsyncFetch } from "@/lib/hooks/useAsyncFetch";
import TeamUsageTable from "@/components/usage/TeamUsageTable";
import TeamUsageStatsCards from "@/components/usage/TeamUsageStatsCards";
import TeamUsageRankings from "@/components/usage/TeamUsageRankings";
import { isAicReportingMonth } from "@/lib/aic-reporting";

export interface TeamUsageEntry {
  teamId: number;
  teamName: string;
  memberCount: number;
  totalRequests: number;
  totalGrossAmount: number;
  totalCost: number;
  averageRequestsPerMember: number;
  averageGrossAmountPerMember: number;
  usagePercent: number;
}

interface TeamUsageResponse {
  teams: TeamUsageEntry[];
  total: number;
  month: number;
  year: number;
}

interface TeamUsagePanelProps {
  month: number;
  year: number;
}

function readSearchFromUrl(): string {
  if (typeof window === "undefined") return "";
  const params = new URLSearchParams(window.location.search);
  return params.get("search") ?? "";
}

export default function TeamUsagePanel({ month, year }: TeamUsagePanelProps) {
  const isAicMode = isAicReportingMonth(month, year);
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

  const { data, loading, error } = useAsyncFetch<TeamUsageResponse>(
    `/api/usage/teams?month=${month}&year=${year}`,
  );

  // Client-side filtering by team name
  const filteredTeams = data?.teams.filter((team) =>
    search
      ? team.teamName.toLowerCase().includes(search.toLowerCase())
      : true,
  );

  const searchBox = (
    <div>
      <label htmlFor="team-usage-search" className="sr-only">
        Search teams
      </label>
      <input
        id="team-usage-search"
        type="search"
        placeholder="Search teams…"
        value={searchInput}
        onChange={(e) => setSearchInput(e.target.value)}
        className="block w-full rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-900 placeholder-gray-400 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
      />
    </div>
  );

  if (loading) {
    return (
      <div className="space-y-4">
        {!isAicMode && <TeamUsageStatsCards month={month} year={year} />}
        {!isAicMode && <TeamUsageRankings month={month} year={year} />}
        {searchBox}
        <div className="flex items-center justify-center py-12" role="status">
          <p className="text-sm text-gray-500">Loading team usage data…</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="space-y-4">
        {!isAicMode && <TeamUsageStatsCards month={month} year={year} />}
        {!isAicMode && <TeamUsageRankings month={month} year={year} />}
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
        {!isAicMode && <TeamUsageStatsCards month={month} year={year} />}
        {!isAicMode && <TeamUsageRankings month={month} year={year} />}
        {searchBox}
        <div className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
          <p className="text-sm text-gray-500">
            No teams have been defined yet. Create teams in Team Management to see
            aggregated usage.
          </p>
        </div>
      </div>
    );
  }

  if (filteredTeams && filteredTeams.length === 0) {
    return (
      <div className="space-y-4">
        {!isAicMode && <TeamUsageStatsCards month={month} year={year} />}
        {!isAicMode && <TeamUsageRankings month={month} year={year} />}
        {searchBox}
        <div className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
          <p className="text-sm text-gray-500">
            No teams match your search query.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {!isAicMode && <TeamUsageStatsCards month={month} year={year} />}
      {!isAicMode && <TeamUsageRankings month={month} year={year} />}
      {searchBox}
      <TeamUsageTable teams={filteredTeams ?? data.teams} month={month} year={year} />
    </div>
  );
}
