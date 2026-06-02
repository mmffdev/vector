"use client";

import { useEffect, useState } from "react";

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
  const [now, setNow] = useState<Date>(() => new Date());

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  function formatNow(d: Date): string {
    const date = d.toLocaleDateString(undefined, {
      weekday: "short",
      day: "numeric",
      month: "short",
      year: "numeric",
    });
    const time = d.toLocaleTimeString(undefined, {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    return `${date} · ${time}`;
  }

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
      <div className="rd-statusbar__Container_Right">
        <div className="rd-statusbar__Container_Right_inner">
          <span className="rd-statusbar__Datetime" aria-live="off">{formatNow(now)}</span>
        </div>
      </div>
    </div>
  );
}
