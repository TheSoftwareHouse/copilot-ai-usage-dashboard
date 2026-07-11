export const AIC_REPORTING_CUTOVER_YEAR = 2026;
export const AIC_REPORTING_CUTOVER_MONTH = 5;

export type DashboardMetricMode = "aic";

export function isAicReportingMonth(month: number, year: number): boolean {
  return (
    year > AIC_REPORTING_CUTOVER_YEAR ||
    (year === AIC_REPORTING_CUTOVER_YEAR && month >= AIC_REPORTING_CUTOVER_MONTH)
  );
}

export function getDashboardMetricMode(): DashboardMetricMode {
  return "aic";
}