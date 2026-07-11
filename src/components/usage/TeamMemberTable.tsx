"use client";

import { useState, useMemo } from "react";
import Link from "next/link";
import { formatCurrency, formatName } from "@/lib/format-helpers";
import SortableTableHeader from "@/components/shared/SortableTableHeader";

type SortField = "githubUsername" | "name" | "totalRequests" | "totalGrossAmount";

interface TeamMember {
  seatId: number;
  githubUsername: string;
  firstName: string | null;
  lastName: string | null;
  totalRequests: number;
  allocatedRequests?: number;
  totalGrossAmount: number;
  allocationPercentage?: number;
}

interface TeamMemberTableProps {
  members: TeamMember[];
  month?: number;
  year?: number;
  showAllocationColumns?: boolean;
}

export default function TeamMemberTable({ members, month, year, showAllocationColumns = false }: TeamMemberTableProps) {
  const navigable = month != null && year != null;

  const [sortBy, setSortBy] = useState<SortField>("totalRequests");
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">("desc");

  function handleSortClick(field: string) {
    if (sortBy === field) {
      setSortOrder((prev) => (prev === "asc" ? "desc" : "asc"));
    } else {
      setSortBy(field as SortField);
      setSortOrder("asc");
    }
  }

  const sortedMembers = useMemo(() => {
    return [...members].sort((a, b) => {
      const dir = sortOrder === "asc" ? 1 : -1;
      if (sortBy === "githubUsername") {
        return dir * a.githubUsername.localeCompare(b.githubUsername);
      }
      if (sortBy === "name") {
        const aName = `${a.firstName ?? ""}${a.lastName ?? ""}`;
        const bName = `${b.firstName ?? ""}${b.lastName ?? ""}`;
        const aIsNull = !a.firstName && !a.lastName;
        const bIsNull = !b.firstName && !b.lastName;
        if (aIsNull && bIsNull) return 0;
        if (aIsNull) return 1;
        if (bIsNull) return -1;
        return dir * aName.localeCompare(bName);
      }
      return dir * (a[sortBy] - b[sortBy]);
    });
  }, [members, sortBy, sortOrder]);

  return (
    <div className="rounded-lg border border-gray-200 bg-white shadow-sm overflow-x-auto">
      <table className="w-full text-left text-sm">
        <thead>
          <tr className="border-b border-gray-200 bg-gray-50">
            <SortableTableHeader label="GitHub Username" field="githubUsername" currentSortBy={sortBy} currentSortOrder={sortOrder} onSort={handleSortClick} />
            <SortableTableHeader label="Name" field="name" currentSortBy={sortBy} currentSortOrder={sortOrder} onSort={handleSortClick} />
            <SortableTableHeader label="AIC Units" field="totalRequests" currentSortBy={sortBy} currentSortOrder={sortOrder} onSort={handleSortClick} align="right" />
            {showAllocationColumns && (
              <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                Allocation %
              </th>
            )}
            {showAllocationColumns && (
              <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                Allocated Usage
              </th>
            )}
            <SortableTableHeader label="Gross Spending" field="totalGrossAmount" currentSortBy={sortBy} currentSortOrder={sortOrder} onSort={handleSortClick} align="right" />
          </tr>
        </thead>
        <tbody>
          {sortedMembers.map((member) => {
            const href = navigable
              ? `/usage/seats/${member.seatId}?month=${month}&year=${year}`
              : undefined;

            return (
              <tr
                key={member.seatId}
                className={`border-b border-gray-100 last:border-0${navigable ? " hover:bg-gray-50 cursor-pointer" : ""}`}
              >
                <td className="px-6 py-3 text-gray-900 font-medium">
                  {href ? (
                    <Link href={href} className="block w-full">
                      <span className="inline-flex items-center gap-2">
                        {member.githubUsername}
                      </span>
                    </Link>
                  ) : (
                    <span className="inline-flex items-center gap-2">
                      {member.githubUsername}
                    </span>
                  )}
                </td>
                <td className="px-6 py-3 text-gray-700">
                  {href ? (
                    <Link href={href} className="block w-full">
                      {formatName(member.firstName, member.lastName)}
                    </Link>
                  ) : (
                    formatName(member.firstName, member.lastName)
                  )}
                </td>
                <td className="px-6 py-3 text-right text-gray-700">
                  {href ? (
                    <Link href={href} className="block w-full">
                      {member.totalRequests.toLocaleString()}
                    </Link>
                  ) : (
                    member.totalRequests.toLocaleString()
                  )}
                </td>
                {showAllocationColumns && (
                  <td className="px-6 py-3 text-right text-gray-700">
                    {member.allocationPercentage != null ? `${member.allocationPercentage}%` : "100%"}
                  </td>
                )}
                {showAllocationColumns && (
                  <td className="px-6 py-3 text-right text-gray-700">
                    {(member.allocatedRequests ?? member.totalRequests).toLocaleString(undefined, {
                      minimumFractionDigits: 1,
                      maximumFractionDigits: 1,
                    })}
                  </td>
                )}
                <td className="px-6 py-3 text-right text-gray-700">
                  {href ? (
                    <Link href={href} className="block w-full">
                      {formatCurrency(member.totalGrossAmount)}
                    </Link>
                  ) : (
                    formatCurrency(member.totalGrossAmount)
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
