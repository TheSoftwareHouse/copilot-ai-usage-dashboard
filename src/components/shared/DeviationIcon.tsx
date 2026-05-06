"use client";

interface DeviationIconProps {
  level: "warning" | "alert";
  tooltipText: string;
}

export const DEVIATION_COLORS = {
  warning: { fill: "#f97316", text: "Warning" },
  alert: { fill: "#ef4444", text: "Alert" },
} as const;

export default function DeviationIcon({ level, tooltipText }: DeviationIconProps) {
  return (
    <span
      role="img"
      aria-label={tooltipText}
      title={tooltipText}
      className="inline-flex items-center justify-center rounded-full text-white text-xs font-bold"
      style={{
        width: 16,
        height: 16,
        backgroundColor: DEVIATION_COLORS[level].fill,
        fontSize: 10,
        lineHeight: 1,
      }}
    >
      !
    </span>
  );
}
