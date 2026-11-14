import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip, Legend } from "recharts";
import { cssVar } from "../../styles/tokens";
import { useTheme } from "../../theme/useTheme";

// The Dashboard's donut. Its own module so Recharts (~330 kB) loads only when a
// chart is actually drawn, after the totals are already on screen.
function TaskStatusChart({ byStatus }) {
  // Re-render on a theme change: the chart reads colours as literal values
  useTheme();
  const data = [
    { name: "To Do", value: byStatus.todo, color: cssVar("--color-text-subtle", "#8b949e") },
    { name: "In Progress", value: byStatus.in_progress, color: cssVar("--color-accent", "#58a6ff") },
    { name: "Done", value: byStatus.done, color: cssVar("--color-success", "#7ee787") },
  ];
  return (
    <ResponsiveContainer width="100%" height={300}>
      <PieChart>
        <Pie
          data={data}
          dataKey="value"
          nameKey="name"
          cx="50%"
          cy="50%"
          innerRadius={62}
          outerRadius={100}
          paddingAngle={2}
          stroke={cssVar("--color-surface", "#151b23")}
          label={({ name, value }) => (value > 0 ? `${name}: ${value}` : "")}
        >
          {data.map((entry) => (
            <Cell key={entry.name} fill={entry.color} />
          ))}
        </Pie>
        <Tooltip contentStyle={{ background: cssVar("--color-surface-raised"), border: `1px solid ${cssVar("--color-border")}`, borderRadius: 8, color: cssVar("--color-text") }} />
        <Legend />
      </PieChart>
    </ResponsiveContainer>
  );
}

export default TaskStatusChart;
