// Accordion.jsx — table-row accordion built on the standard .tbl page-table styling.
// This is a COMPONENT. Expand any row to reveal a full-width sunken panel
// inline with the table — holds nested tables, text, forms, timelines, anything.
const { useState } = React;

/**
 * <AccordionTable columns={...} defaultOpen={id}>
 *   <AccordionRow id="..." cells={[...]}>
 *     {/* any content goes here, rendered in a colspan row underneath *\/}
 *   </AccordionRow>
 * </AccordionTable>
 *
 * - Reuses the .tbl class so it visually matches every other Vector table.
 * - Adds a leading chevron column.
 * - Active row tints to --surface-sunken; chevron rotates 90°.
 * - Expanded content is a full-width <td colSpan=...> with sunken bg + 24px padding.
 */
function AccordionTable({ columns, children, defaultOpen = null }) {
  const [openId, setOpenId] = useState(defaultOpen);
  const rows = React.Children.toArray(children);
  const colSpan = columns.length + 1;

  return (
    <div className="table-wrap">
      <table className="tbl">
        <thead>
          <tr>
            <th style={{ width: 36, padding: 0 }}></th>
            {columns.map((c, i) => (
              <th
                key={i}
                className={c.align === "right" ? "num" : ""}
                style={{ width: c.width }}
              >
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => {
            const id = row.props.id ?? i;
            const isOpen = openId === id;
            return (
              <React.Fragment key={id}>
                <tr
                  className={`acc-row ${isOpen ? "is-open" : ""}`}
                  onClick={() => setOpenId(isOpen ? null : id)}
                >
                  <td style={{ padding: 0, textAlign: "center", color: "var(--ink-muted)" }}>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ transition: "transform .15s ease", transform: isOpen ? "rotate(90deg)" : "none", verticalAlign: "middle" }}>
                      <polyline points="9 6 15 12 9 18" />
                    </svg>
                  </td>
                  {row.props.cells.map((cell, j) => (
                    <td key={j} className={columns[j]?.align === "right" ? "num" : ""}>
                      {cell}
                    </td>
                  ))}
                </tr>
                {isOpen && (
                  <tr className="acc-panel-row">
                    <td colSpan={colSpan} style={{ padding: 0, height: "auto" }}>
                      <div className="acc-panel">{row.props.children}</div>
                    </td>
                  </tr>
                )}
              </React.Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function AccordionRow({ children }) { return children; } // marker only

window.AccordionTable = AccordionTable;
window.AccordionRow = AccordionRow;
