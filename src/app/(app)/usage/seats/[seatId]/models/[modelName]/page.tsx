import SeatModelDailyDetailPanel from "@/components/usage/SeatModelDailyDetailPanel";

export const metadata = {
  title: "Seat Model Daily Usage — Copilot Dashboard",
};

export const dynamic = "force-dynamic";

interface SeatModelDailyDetailPageProps {
  params: Promise<{ seatId: string; modelName: string }>;
  searchParams: Promise<{ month?: string; year?: string }>;
}

function decodeRouteModelName(modelName: string): string {
  try {
    return decodeURIComponent(modelName);
  } catch {
    // Keep raw value so downstream validation and API error handling stay in control.
    return modelName;
  }
}

export default async function SeatModelDailyDetailPage({
  params,
  searchParams,
}: SeatModelDailyDetailPageProps) {
  const { seatId: seatIdParam, modelName: modelNameParam } = await params;
  const { month: monthParam, year: yearParam } = await searchParams;

  const seatId = parseInt(seatIdParam, 10);

  const now = new Date();
  const defaultMonth = now.getUTCMonth() + 1;
  const defaultYear = now.getUTCFullYear();

  const parsedMonth = parseInt(monthParam ?? "", 10);
  const parsedYear = parseInt(yearParam ?? "", 10);

  const month =
    Number.isFinite(parsedMonth) && Number.isInteger(parsedMonth) && parsedMonth >= 1 && parsedMonth <= 12
      ? parsedMonth
      : defaultMonth;
  const year =
    Number.isFinite(parsedYear) && Number.isInteger(parsedYear) && parsedYear >= 2020
      ? parsedYear
      : defaultYear;

  const modelName = decodeRouteModelName(modelNameParam);

  return (
    <main className="min-h-screen bg-gray-50 px-4 py-12">
      <div className="mx-auto max-w-5xl">
        <SeatModelDailyDetailPanel
          seatId={seatId}
          modelName={modelName}
          initialMonth={month}
          initialYear={year}
        />
      </div>
    </main>
  );
}
