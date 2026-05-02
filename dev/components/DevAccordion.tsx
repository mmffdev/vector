"use client";

import { ReactNode, useEffect, useRef, useState } from "react";

export function DevAccordion({ children }: { children: ReactNode }) {
  return <div className="accordion">{children}</div>;
}

type DevAccordionItemProps = {
  header: ReactNode;
  children: ReactNode | (() => ReactNode);
  accent?: "fail" | null;
  defaultOpen?: boolean;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  onFirstOpen?: () => void;
  className?: string;
};

export function DevAccordionItem({
  header,
  children,
  accent = null,
  defaultOpen = false,
  open: controlledOpen,
  onOpenChange,
  onFirstOpen,
  className = "",
}: DevAccordionItemProps) {
  const [uncontrolledOpen, setUncontrolledOpen] = useState(defaultOpen);
  const open = controlledOpen ?? uncontrolledOpen;
  const firstOpenFired = useRef(false);

  useEffect(() => {
    if (open && !firstOpenFired.current) {
      firstOpenFired.current = true;
      onFirstOpen?.();
    }
  }, [open, onFirstOpen]);

  function toggle() {
    const next = !open;
    if (next && !firstOpenFired.current) {
      firstOpenFired.current = true;
      onFirstOpen?.();
    }
    if (controlledOpen === undefined) setUncontrolledOpen(next);
    onOpenChange?.(next);
  }

  const accentClass = accent === "fail" ? " dev-accordion-item--fail" : "";
  const extra = className ? ` ${className}` : "";

  return (
    <div className={`accordion__item${accentClass}${extra}`}>
      <button className="accordion__toggle" onClick={toggle}>
        {header}
        <span className={`accordion__chevron${open ? "" : " accordion__chevron--closed"}`} />
      </button>
      {open && (
        <div className="accordion__body">
          {typeof children === "function" ? children() : children}
        </div>
      )}
    </div>
  );
}

type ToolbarFilter<K extends string> = { key: K; label: string; count: number };

type DevAccordionToolbarProps<K extends string> = {
  filters?: ToolbarFilter<K>[];
  activeFilter?: K;
  onFilterChange?: (key: K) => void;
  page: number;
  totalPages: number;
  onPageChange: (page: number) => void;
};

export function DevAccordionToolbar<K extends string>({
  filters,
  activeFilter,
  onFilterChange,
  page,
  totalPages,
  onPageChange,
}: DevAccordionToolbarProps<K>) {
  return (
    <div className="dev-accordion-toolbar">
      {filters && filters.length > 0 && (
        <div className="dev-accordion-toolbar__filters">
          {filters.map(f => (
            <button
              key={f.key}
              className={`dev-accordion-toolbar__filter${activeFilter === f.key ? " dev-accordion-toolbar__filter--active" : ""}`}
              onClick={() => onFilterChange?.(f.key)}
            >
              {f.label}
              <span className="dev-accordion-toolbar__count">{f.count}</span>
            </button>
          ))}
        </div>
      )}
      <div className="dev-accordion-toolbar__pagination">
        <button
          className="dev-accordion-toolbar__page-btn"
          onClick={() => onPageChange(Math.max(1, page - 1))}
          disabled={page <= 1}
          aria-label="Previous page"
        >‹</button>
        <span className="dev-accordion-toolbar__page-info">{page} / {totalPages}</span>
        <button
          className="dev-accordion-toolbar__page-btn"
          onClick={() => onPageChange(Math.min(totalPages, page + 1))}
          disabled={page >= totalPages}
          aria-label="Next page"
        >›</button>
      </div>
    </div>
  );
}
