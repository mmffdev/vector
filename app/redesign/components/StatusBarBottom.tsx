"use client";

type DataPointKey = "blockers" | "stories_clamp" | "tasks";

type DataPoint = {
  key: DataPointKey;
  label: string;
  value: number | string;
};

const DATA_POINTS: DataPoint[] = [
  { key: "blockers",      label: "Blockers",       value: 0 },
  { key: "stories_clamp", label: "Stories (clamp)", value: 0 },
  { key: "tasks",         label: "Tasks",          value: 0 },
];

export default function StatusBarBottom() {
  return (
    <div className="rd-statusbar__Container">
      <ul className="rd-statusbar__Container_Items">
        {DATA_POINTS.map((dp) => (
          <li key={dp.key} className="rd-statusbar__Container_Items_Item">
            <span className="rd-statusbar__Container_Items_Item_label">{dp.label}</span>
            <span className="rd-statusbar__Container_Items_Item_value">{dp.value}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
