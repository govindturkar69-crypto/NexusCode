import { Area, AreaChart, Bar, BarChart, CartesianGrid, Legend, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { cssVar } from "../../styles/tokens";
import { useTheme } from "../../theme/useTheme";

// The analytics page's charts. Their own module so Recharts loads only with them.
// Each chart is drawn for sighted users; the page gives every one a title, a
// one-line summary and a data table, so the numbers never live only in pixels.

const shortDate = (iso) => {
  const [, m, d] = iso.split("-");
  return `${Number(d)}/${Number(m)}`;
};

function colors() {
  return {
    grid: cssVar("--color-border", "#2a313c"),
    text: cssVar("--color-text-muted", "#8b95a2"),
    accent: cssVar("--color-accent", "#58a6ff"),
    success: cssVar("--color-success", "#3fb950"),
    warning: cssVar("--color-warning", "#d29922"),
    tooltip: { background: cssVar("--color-surface-raised"), border: `1px solid ${cssVar("--color-border")}`, borderRadius: 8, color: cssVar("--color-text") },
  };
}

const axis = (c) => ({ stroke: c.grid, tick: { fill: c.text, fontSize: 12 }, tickLine: false });

export function BurnChart({ data }) {
  useTheme(); // re-render on theme change: colours are read as values
  const c = colors();
  return (
    <ResponsiveContainer width="100%" height={260}>
      <AreaChart data={data} margin={{ top: 8, right: 12, left: -16, bottom: 0 }} accessibilityLayer>
        <CartesianGrid stroke={c.grid} strokeDasharray="3 3" vertical={false} />
        <XAxis dataKey="date" tickFormatter={shortDate} {...axis(c)} minTickGap={16} />
        <YAxis allowDecimals={false} {...axis(c)} />
        <Tooltip contentStyle={c.tooltip} labelFormatter={shortDate} />
        <Legend wrapperStyle={{ color: c.text, fontSize: 12 }} />
        <Area type="monotone" dataKey="scope" name="Scope" stroke={c.accent} fill={c.accent} fillOpacity={0.12} strokeWidth={2} isAnimationActive={false} />
        <Area type="monotone" dataKey="completed" name="Completed" stroke={c.success} fill={c.success} fillOpacity={0.2} strokeWidth={2} isAnimationActive={false} />
        <Line type="monotone" dataKey="remaining" name="Remaining" stroke={c.warning} strokeWidth={2} dot={false} isAnimationActive={false} />
      </AreaChart>
    </ResponsiveContainer>
  );
}

export function ThroughputChart({ data }) {
  useTheme();
  const c = colors();
  const rows = data.map((b) => ({ ...b, label: b.days === 7 ? `${shortDate(b.start)}–${shortDate(b.end)}` : `${shortDate(b.start)}–${shortDate(b.end)} (${b.days}d)` }));
  return (
    <ResponsiveContainer width="100%" height={220}>
      <BarChart data={rows} margin={{ top: 8, right: 12, left: -16, bottom: 0 }} accessibilityLayer>
        <CartesianGrid stroke={c.grid} strokeDasharray="3 3" vertical={false} />
        <XAxis dataKey="label" {...axis(c)} />
        <YAxis allowDecimals={false} {...axis(c)} />
        <Tooltip contentStyle={c.tooltip} cursor={{ fill: c.grid, opacity: 0.4 }} />
        <Bar dataKey="completed" name="Tasks finished" fill={c.success} radius={[4, 4, 0, 0]} isAnimationActive={false} />
      </BarChart>
    </ResponsiveContainer>
  );
}

export function ActivityChart({ data }) {
  useTheme();
  const c = colors();
  return (
    <ResponsiveContainer width="100%" height={200}>
      <BarChart data={data} margin={{ top: 8, right: 12, left: -16, bottom: 0 }} accessibilityLayer>
        <CartesianGrid stroke={c.grid} strokeDasharray="3 3" vertical={false} />
        <XAxis dataKey="date" tickFormatter={shortDate} {...axis(c)} minTickGap={16} />
        <YAxis allowDecimals={false} {...axis(c)} />
        <Tooltip contentStyle={c.tooltip} labelFormatter={shortDate} cursor={{ fill: c.grid, opacity: 0.4 }} />
        <Bar dataKey="events" name="Events" fill={c.accent} radius={[3, 3, 0, 0]} isAnimationActive={false} />
      </BarChart>
    </ResponsiveContainer>
  );
}
