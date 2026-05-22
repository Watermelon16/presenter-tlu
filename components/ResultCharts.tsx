"use client";

import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Cell,
  ResponsiveContainer,
  Tooltip,
  LabelList,
  ReferenceLine,
} from "recharts";

/**
 * Charts chuyên nghiệp cho kết quả poll + rating.
 * Dùng recharts. Theme có 2 mode: "light" (cho lecturer inline) và "dark" (overlay chiếu).
 */

type Theme = "light" | "dark";

const COLORS = {
  light: {
    bar: "#10b981",         // emerald-500
    barCorrect: "#059669",  // emerald-600
    barWrong: "#94a3b8",    // slate-400
    axis: "#71717a",        // zinc-500
    grid: "#e4e4e7",        // zinc-200
    label: "#27272a",       // zinc-800
    accent: "#f59e0b",      // amber-500
  },
  dark: {
    bar: "#34d399",         // emerald-400
    barCorrect: "#10b981",  // emerald-500
    barWrong: "#64748b",    // slate-500
    axis: "#d4d4d8",        // zinc-300
    grid: "#3f3f46",        // zinc-700
    label: "#fafafa",       // zinc-50
    accent: "#fbbf24",      // amber-400
  },
};

// =================================================================
// POLL CHART — horizontal bar với % + ✓ đáp án đúng (nếu reveal)
// =================================================================

type PollOption = {
  id: string;
  text: string;
  voteCount: number;
};

interface PollChartProps {
  options: PollOption[];
  totalVotes: number;
  correctIds?: string[];        // nếu là quiz + đã reveal → highlight đúng
  showCorrect?: boolean;        // chỉ highlight khi true (chống leak)
  theme?: Theme;
  height?: number;
}

export function PollBarChart({
  options,
  totalVotes,
  correctIds,
  showCorrect = false,
  theme = "light",
  height = 280,
}: PollChartProps) {
  const palette = COLORS[theme];
  const data = options.map((o, i) => {
    const pct = totalVotes > 0 ? (o.voteCount / totalVotes) * 100 : 0;
    const isCorrect = !!(correctIds && correctIds.includes(o.id));
    return {
      name: `${String.fromCharCode(65 + i)}. ${o.text}`.slice(0, 60),
      shortName: String.fromCharCode(65 + i),
      voteCount: o.voteCount,
      pct,
      isCorrect,
    };
  });

  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart layout="vertical" data={data} margin={{ top: 8, right: 50, bottom: 8, left: 8 }}>
        <XAxis
          type="number"
          domain={[0, "dataMax"]}
          tick={{ fill: palette.axis, fontSize: 12 }}
          axisLine={{ stroke: palette.grid }}
          tickLine={false}
        />
        <YAxis
          type="category"
          dataKey="name"
          tick={{ fill: palette.label, fontSize: 14 }}
          axisLine={false}
          tickLine={false}
          width={Math.min(220, Math.max(120, ...data.map((d) => d.name.length * 7)))}
        />
        <Tooltip
          cursor={{ fill: theme === "dark" ? "rgba(255,255,255,0.05)" : "rgba(0,0,0,0.05)" }}
          contentStyle={{
            background: theme === "dark" ? "#18181b" : "#fff",
            border: `1px solid ${palette.grid}`,
            borderRadius: 8,
            color: palette.label,
            fontSize: 13,
          }}
          formatter={(value: unknown, _name: unknown, item: { payload?: { pct?: number } }) => {
            const pct = item.payload?.pct ?? 0;
            return [`${value} vote (${pct.toFixed(1)}%)`, "Lượt"];
          }}
        />
        <Bar dataKey="voteCount" radius={[0, 8, 8, 0]}>
          {data.map((d, i) => {
            const fill = showCorrect && d.isCorrect
              ? palette.barCorrect
              : showCorrect && correctIds && correctIds.length > 0
                ? palette.barWrong
                : palette.bar;
            return <Cell key={i} fill={fill} />;
          })}
          <LabelList
            dataKey="pct"
            position="right"
            formatter={(value: unknown) => `${(typeof value === "number" ? value : 0).toFixed(0)}%`}
            style={{ fill: palette.label, fontSize: 13, fontWeight: 600 }}
          />
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

// =================================================================
// RATING CHART — bar distribution + đường trung bình
// =================================================================

interface RatingChartProps {
  responses: number[];          // mỗi response = 1 rating value
  min: number;
  max: number;
  labels?: Record<number, string>; // optional label per point
  theme?: Theme;
  height?: number;
}

export function RatingBarChart({
  responses,
  min,
  max,
  labels,
  theme = "light",
  height = 260,
}: RatingChartProps) {
  const palette = COLORS[theme];

  // Build distribution
  const data: { point: number; label: string; count: number; pct: number }[] = [];
  for (let p = min; p <= max; p++) {
    const count = responses.filter((r) => r === p).length;
    const pct = responses.length > 0 ? (count / responses.length) * 100 : 0;
    const label = labels?.[p] ? `${p} · ${labels[p]}` : String(p);
    data.push({ point: p, label, count, pct });
  }

  const avg = responses.length > 0
    ? responses.reduce((a, b) => a + b, 0) / responses.length
    : null;

  return (
    <div className="space-y-2">
      {avg !== null && (
        <div className="flex items-baseline gap-2 px-1">
          <span
            className="text-3xl font-bold tabular-nums"
            style={{ color: palette.accent }}
          >
            {avg.toFixed(1)}
          </span>
          <span className="text-sm" style={{ color: palette.axis }}>
            / {max} · {responses.length} lượt
          </span>
        </div>
      )}
      <ResponsiveContainer width="100%" height={height}>
        <BarChart data={data} margin={{ top: 16, right: 16, bottom: 24, left: 16 }}>
          <XAxis
            dataKey="label"
            tick={{ fill: palette.axis, fontSize: 12 }}
            axisLine={{ stroke: palette.grid }}
            tickLine={false}
            interval={0}
          />
          <YAxis
            tick={{ fill: palette.axis, fontSize: 11 }}
            axisLine={false}
            tickLine={false}
            allowDecimals={false}
          />
          <Tooltip
            cursor={{ fill: theme === "dark" ? "rgba(255,255,255,0.05)" : "rgba(0,0,0,0.05)" }}
            contentStyle={{
              background: theme === "dark" ? "#18181b" : "#fff",
              border: `1px solid ${palette.grid}`,
              borderRadius: 8,
              color: palette.label,
              fontSize: 13,
            }}
            formatter={(value: unknown, _name: unknown, item: { payload?: { pct?: number } }) => {
              const pct = item.payload?.pct ?? 0;
              return [`${value} lượt (${pct.toFixed(1)}%)`, "Số người"];
            }}
          />
          <Bar dataKey="count" radius={[8, 8, 0, 0]} fill={palette.bar}>
            <LabelList
              dataKey="count"
              position="top"
              style={{ fill: palette.label, fontSize: 12, fontWeight: 600 }}
            />
          </Bar>
          {avg !== null && (
            <ReferenceLine
              x={labels?.[Math.round(avg)] ? `${Math.round(avg)} · ${labels[Math.round(avg)]}` : String(Math.round(avg))}
              stroke={palette.accent}
              strokeDasharray="4 4"
              label={{
                value: `TB ${avg.toFixed(1)}`,
                position: "top",
                fill: palette.accent,
                fontSize: 11,
                fontWeight: 600,
              }}
            />
          )}
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

// =================================================================
// WORDCLOUD STATS — top words horizontal bar (alternative tới text cloud)
// =================================================================

interface WordcloudBarsProps {
  words: { text: string; count: number }[];
  maxItems?: number;
  theme?: Theme;
  height?: number;
}

export function WordcloudBars({
  words,
  maxItems = 10,
  theme = "light",
  height = 280,
}: WordcloudBarsProps) {
  const palette = COLORS[theme];
  const data = words.slice(0, maxItems).map((w) => ({
    name: w.text,
    count: w.count,
  }));

  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart layout="vertical" data={data} margin={{ top: 8, right: 40, bottom: 8, left: 8 }}>
        <XAxis
          type="number"
          domain={[0, "dataMax"]}
          tick={{ fill: palette.axis, fontSize: 12 }}
          axisLine={{ stroke: palette.grid }}
          tickLine={false}
        />
        <YAxis
          type="category"
          dataKey="name"
          tick={{ fill: palette.label, fontSize: 13 }}
          axisLine={false}
          tickLine={false}
          width={Math.min(160, Math.max(80, ...data.map((d) => d.name.length * 8)))}
        />
        <Tooltip
          contentStyle={{
            background: theme === "dark" ? "#18181b" : "#fff",
            border: `1px solid ${palette.grid}`,
            borderRadius: 8,
            color: palette.label,
            fontSize: 13,
          }}
        />
        <Bar dataKey="count" radius={[0, 8, 8, 0]} fill={palette.bar}>
          <LabelList
            dataKey="count"
            position="right"
            style={{ fill: palette.label, fontSize: 12, fontWeight: 600 }}
          />
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}
