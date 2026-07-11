"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import MonthFilter from "@/components/dashboard/MonthFilter";
import Modal from "@/components/shared/Modal";
import AddMembersForm from "@/components/teams/AddMembersForm";
import BackfillHistoryForm from "@/components/teams/BackfillHistoryForm";
import { useAvailableMonths } from "@/lib/hooks/useAvailableMonths";
import { MONTH_NAMES } from "@/lib/constants";
import { formatName } from "@/lib/format-helpers";

interface MemberRecord {
  seatId: number;
  githubUsername: string;
  firstName: string | null;
  lastName: string | null;
  status: string;
  allocationPercentage: number;
}

interface TeamMembersPanelProps {
  teamId: number;
  teamName: string;
  onClose: () => void;
}

const now = new Date();
const currentMonth = now.getUTCMonth() + 1;
const currentYear = now.getUTCFullYear();

export default function TeamMembersPanel({
  teamId,
  teamName,
  onClose,
}: TeamMembersPanelProps) {
  const { availableMonths, loadingMonths } = useAvailableMonths();
  const [month, setMonth] = useState(currentMonth);
  const [year, setYear] = useState(currentYear);
  const [members, setMembers] = useState<MemberRecord[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [activeMode, setActiveMode] = useState<"add" | "backfill" | null>(null);
  const [confirmRemoveSeatId, setConfirmRemoveSeatId] = useState<number | null>(null);
  const [isRemoving, setIsRemoving] = useState(false);
  const [removeError, setRemoveError] = useState<string | null>(null);
  const [removeMode, setRemoveMode] = useState<null | "choose" | "purge-confirm">(null);
  const [purgeImpactMonths, setPurgeImpactMonths] = useState<number | null>(null);
  const [isPurgeImpactLoading, setIsPurgeImpactLoading] = useState(false);
  const [isPurging, setIsPurging] = useState(false);
  const [editingSeatId, setEditingSeatId] = useState<number | null>(null);
  const [editingAllocation, setEditingAllocation] = useState("100");
  const [allocationUpdateError, setAllocationUpdateError] = useState<string | null>(null);
  const [allocationWarning, setAllocationWarning] = useState<string | null>(null);
  const [isSavingAllocation, setIsSavingAllocation] = useState(false);

  const fetchMembers = useCallback(async () => {
    setIsLoading(true);
    setFetchError(null);
    try {
      const response = await fetch(`/api/teams/${teamId}/members?month=${month}&year=${year}`);
      if (!response.ok) {
        throw new Error("Failed to fetch members");
      }
      const data = await response.json();
      setMembers(data.members);
      setMonth(data.month);
      setYear(data.year);
    } catch {
      setFetchError("Failed to load team members. Please try again.");
    } finally {
      setIsLoading(false);
    }
  }, [teamId, month, year]);

  const refreshMembersSilently = useCallback(async () => {
    try {
      const response = await fetch(`/api/teams/${teamId}/members?month=${month}&year=${year}`);
      if (!response.ok) return;
      const data = await response.json();
      setMembers(data.members);
      setMonth(data.month);
      setYear(data.year);
    } catch {
      // Keep the current snapshot if the background refresh fails.
    }
  }, [teamId, month, year]);

  useEffect(() => {
    fetchMembers();
  }, [fetchMembers]);

  const existingMemberSeatIds = useMemo(
    () => members.map((member) => member.seatId),
    [members],
  );

  const monthLabel = `${MONTH_NAMES[month - 1]} ${year}`;

  function cancelRemoveFlow() {
    setConfirmRemoveSeatId(null);
    setRemoveMode(null);
    setPurgeImpactMonths(null);
    setIsPurgeImpactLoading(false);
  }

  async function handleRemove(seatId: number, mode: "retire" | "purge" = "retire") {
    setRemoveError(null);
    setIsRemoving(mode !== "purge");
    setIsPurging(mode === "purge");
    try {
      const response = await fetch(`/api/teams/${teamId}/members`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ seatIds: [seatId], month, year, mode }),
      });

      if (response.ok) {
        cancelRemoveFlow();
        await fetchMembers();
        return;
      }

      setRemoveError("Failed to remove member. Please try again.");
      cancelRemoveFlow();
    } catch {
      setRemoveError("Network error. Please check your connection and try again.");
      cancelRemoveFlow();
    } finally {
      setIsRemoving(false);
      setIsPurging(false);
    }
  }

  async function handlePurgeClick(seatId: number) {
    setRemoveMode("purge-confirm");
    setIsPurgeImpactLoading(true);
    setPurgeImpactMonths(null);
    setRemoveError(null);
    try {
      const response = await fetch(`/api/teams/${teamId}/members/purge-impact?seatId=${seatId}`);
      if (response.ok) {
        const data = await response.json();
        setPurgeImpactMonths(data.months);
      } else {
        setRemoveError("Failed to load purge impact. Please try again.");
        setRemoveMode("choose");
      }
    } catch {
      setRemoveError("Network error. Please check your connection and try again.");
      setRemoveMode("choose");
    } finally {
      setIsPurgeImpactLoading(false);
    }
  }

  async function handleAllocationSave(seatId: number) {
    const allocationPercentage = Number(editingAllocation);
    if (!Number.isInteger(allocationPercentage) || allocationPercentage < 1 || allocationPercentage > 100) {
      setAllocationUpdateError("Allocation percentage must be between 1 and 100.");
      return;
    }

    setAllocationUpdateError(null);
    setAllocationWarning(null);
    setIsSavingAllocation(true);
    try {
      const response = await fetch(`/api/teams/${teamId}/members/${seatId}/allocation`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ month, year, allocationPercentage }),
      });

      if (!response.ok) {
        const data = await response.json().catch(() => null);
        setAllocationUpdateError(data?.error ?? "Failed to update allocation. Please try again.");
        return;
      }

      const data = await response.json();
      if (data.allocationWarning) {
        setAllocationWarning(
          `Warning: total allocation for this seat in ${monthLabel} is ${data.allocationWarning.totalAllocationPercentage}%.`,
        );
      }
      setEditingSeatId(null);
      setEditingAllocation("100");
      await fetchMembers();
    } catch {
      setAllocationUpdateError("Network error. Please check your connection and try again.");
    } finally {
      setIsSavingAllocation(false);
    }
  }

  function handleMembersAdded(allocationWarnings: { seatId: number; totalAllocationPercentage: number }[]) {
    setActiveMode(null);
    if (allocationWarnings.length > 0) {
      setAllocationWarning(
        `Warning: total allocation for ${allocationWarnings.length} seat${allocationWarnings.length === 1 ? "" : "s"} exceeds 100% in ${monthLabel}.`,
      );
    }
    fetchMembers();
  }

  function handleMembersBackfilled() {
    refreshMembersSilently();
  }

  if (isLoading) {
    return (
      <Modal isOpen={true} onClose={onClose} title={`Members of ${teamName}`} size="large">
        <p className="text-sm text-gray-500">Loading members…</p>
      </Modal>
    );
  }

  if (fetchError) {
    return (
      <Modal isOpen={true} onClose={onClose} title={`Members of ${teamName}`} size="large">
        <div role="alert" className="rounded-md border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          {fetchError}
        </div>
        <div className="mt-4 flex gap-3">
          <button
            type="button"
            onClick={fetchMembers}
            className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
          >
            Retry
          </button>
        </div>
      </Modal>
    );
  }

  return (
    <Modal isOpen={true} onClose={onClose} title={`Members of ${teamName}`} size="large">
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-sm font-medium text-gray-700">Viewing {monthLabel}</p>
          <p className="text-xs text-gray-500">Add, remove, and edit allocation for this selected month only.</p>
        </div>
        <MonthFilter
          availableMonths={availableMonths}
          selectedMonth={month}
          selectedYear={year}
          onChange={(newMonth, newYear) => {
            setActiveMode(null);
            setEditingSeatId(null);
            setConfirmRemoveSeatId(null);
            setAllocationWarning(null);
            setMonth(newMonth);
            setYear(newYear);
          }}
          disabled={loadingMonths}
        />
      </div>

      <div className="mb-4 flex gap-3">
        <button
          type="button"
          onClick={() => setActiveMode(activeMode === "add" ? null : "add")}
          className={`rounded-md px-4 py-2 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 ${
            activeMode === "add"
              ? "bg-blue-600 text-white hover:bg-blue-700"
              : "border border-gray-300 text-gray-700 hover:bg-gray-50"
          }`}
        >
          Add Members
        </button>
        <button
          type="button"
          onClick={() => setActiveMode(activeMode === "backfill" ? null : "backfill")}
          className={`rounded-md px-4 py-2 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 ${
            activeMode === "backfill"
              ? "bg-blue-600 text-white hover:bg-blue-700"
              : "border border-gray-300 text-gray-700 hover:bg-gray-50"
          }`}
        >
          Backfill History
        </button>
      </div>

      {activeMode === "add" && (
        <AddMembersForm
          teamId={teamId}
          month={month}
          year={year}
          existingMemberSeatIds={existingMemberSeatIds}
          onMembersAdded={handleMembersAdded}
        />
      )}

      {activeMode === "backfill" && (
        <BackfillHistoryForm
          teamId={teamId}
          onMembersBackfilled={handleMembersBackfilled}
        />
      )}

      {allocationWarning && (
        <div role="alert" className="mb-4 rounded-md border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
          {allocationWarning}
        </div>
      )}

      {allocationUpdateError && (
        <div role="alert" className="mb-4 rounded-md border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          {allocationUpdateError}
        </div>
      )}

      {removeError && (
        <div role="alert" className="mb-4 rounded-md border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          {removeError}
        </div>
      )}

      {members.length === 0 ? (
        <div className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
          <p className="text-sm text-gray-500">This team has no members for {monthLabel}.</p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm">
          <table className="min-w-full divide-y divide-gray-200">
            <caption className="sr-only">Team members</caption>
            <thead className="bg-gray-50">
              <tr>
                <th scope="col" className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">GitHub Username</th>
                <th scope="col" className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">Name</th>
                <th scope="col" className="px-6 py-3 text-right text-xs font-medium uppercase tracking-wider text-gray-500">Allocation %</th>
                <th scope="col" className="px-6 py-3 text-right text-xs font-medium uppercase tracking-wider text-gray-500">Actions</th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {members.map((member) => (
                <tr key={member.seatId}>
                  <td className="px-6 py-4 text-sm text-gray-900">{member.githubUsername}</td>
                  <td className="px-6 py-4 text-sm text-gray-500">{formatName(member.firstName, member.lastName)}</td>
                  <td className="px-6 py-4 text-right text-sm text-gray-700">
                    {editingSeatId === member.seatId ? (
                      <input
                        type="number"
                        min={1}
                        max={100}
                        aria-label={`Allocation percentage for ${member.githubUsername}`}
                        value={editingAllocation}
                        onChange={(event) => setEditingAllocation(event.target.value)}
                        className="w-20 rounded-md border border-gray-300 px-2 py-1 text-right text-sm text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                      />
                    ) : (
                      <span className={member.allocationPercentage < 100 ? "font-semibold text-amber-700" : ""}>
                        {member.allocationPercentage}%
                      </span>
                    )}
                  </td>
                  <td className="px-6 py-4 text-right">
                    {confirmRemoveSeatId === member.seatId ? (
                      <span className="inline-flex flex-wrap items-center justify-end gap-2">
                        {removeMode === "purge-confirm" ? (
                          <>
                            {isPurgeImpactLoading ? (
                              <span className="text-sm text-gray-500">Loading impact…</span>
                            ) : (
                              <span className="text-sm text-gray-600">This will remove {member.githubUsername} from {purgeImpactMonths ?? 0} month{purgeImpactMonths === 1 ? "" : "s"} of team history.</span>
                            )}
                            <button
                              type="button"
                              onClick={() => handleRemove(member.seatId, "purge")}
                              disabled={isPurging || isPurgeImpactLoading}
                              className="text-sm font-medium text-red-600 hover:text-red-800 disabled:cursor-not-allowed disabled:opacity-50"
                            >
                              {isPurging ? "Purging…" : "Confirm Purge"}
                            </button>
                            <button
                              type="button"
                              onClick={cancelRemoveFlow}
                              className="text-sm font-medium text-gray-600 hover:text-gray-800"
                            >
                              Cancel
                            </button>
                          </>
                        ) : (
                          <>
                            <button
                              type="button"
                              onClick={() => handleRemove(member.seatId, "retire")}
                              disabled={isRemoving}
                              className="text-sm font-medium text-yellow-700 hover:text-yellow-900 disabled:cursor-not-allowed disabled:opacity-50"
                            >
                              {isRemoving ? "Removing…" : "Retire"}
                            </button>
                            <span className="text-xs text-gray-400">selected month only</span>
                            <span className="text-gray-300">|</span>
                            <button
                              type="button"
                              onClick={() => handlePurgeClick(member.seatId)}
                              disabled={isRemoving}
                              className="text-sm font-medium text-red-600 hover:text-red-800 disabled:cursor-not-allowed disabled:opacity-50"
                            >
                              Purge
                            </button>
                            <span className="text-xs text-gray-400">all months</span>
                            <span className="text-gray-300">|</span>
                            <button
                              type="button"
                              onClick={cancelRemoveFlow}
                              className="text-sm font-medium text-gray-600 hover:text-gray-800"
                            >
                              Cancel
                            </button>
                          </>
                        )}
                      </span>
                    ) : editingSeatId === member.seatId ? (
                      <span className="inline-flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => handleAllocationSave(member.seatId)}
                          disabled={isSavingAllocation}
                          className="text-sm font-medium text-blue-600 hover:text-blue-800 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          {isSavingAllocation ? "Saving…" : "Save"}
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setEditingSeatId(null);
                            setEditingAllocation("100");
                            setAllocationUpdateError(null);
                          }}
                          className="text-sm font-medium text-gray-600 hover:text-gray-800"
                        >
                          Cancel
                        </button>
                      </span>
                    ) : (
                      <span className="inline-flex flex-wrap items-center justify-end gap-2">
                        <button
                          type="button"
                          onClick={() => {
                            setEditingSeatId(member.seatId);
                            setEditingAllocation(String(member.allocationPercentage));
                            setAllocationUpdateError(null);
                            setAllocationWarning(null);
                          }}
                          className="text-sm font-medium text-blue-600 hover:text-blue-800"
                        >
                          Edit Allocation
                        </button>
                        <span className="text-gray-300">|</span>
                        <button
                          type="button"
                          onClick={() => {
                            setConfirmRemoveSeatId(member.seatId);
                            setRemoveMode("choose");
                            setRemoveError(null);
                            setPurgeImpactMonths(null);
                          }}
                          className="text-sm font-medium text-red-600 hover:text-red-800"
                        >
                          Remove
                        </button>
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Modal>
  );
}
