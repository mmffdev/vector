"use client";

import { ReactNode, useContext, useEffect, useId, useRef } from "react";
import { PageHeaderContext } from "@/app/contexts/PageHeaderContext";
import type { BorderProp } from "@/app/components/Panel";

interface PageHeadingProps {
  level?:     1 | 2 | 3 | 4;
  title:      ReactNode;
  subtitle?:  ReactNode;
  // Visual props retained for call-site compatibility — PageHeading now
  // renders nothing inline and hoists title/subtitle into the top-bar via
  // PageHeaderContext, so these are silently ignored.
  className?: string;
  margin?:    [string?, string?, string?, string?];
  padding?:   [string?, string?, string?, string?];
  border?:    BorderProp;
  background?: string;
  radius?:    { top?: string; right?: string; bottom?: string; left?: string };
}

export default function PageHeading({ title, subtitle }: PageHeadingProps) {
  const headerCtx = useContext(PageHeaderContext);
  const id = useId();
  const titleStr = typeof title === "string" ? title : String(title ?? "");
  const subtitleStr = typeof subtitle === "string" ? subtitle : subtitle ? String(subtitle) : undefined;

  // Stash push/pop in a ref so the effect deps only react to the actual
  // {title, subtitle} payload — not to the new context value object that
  // PageHeaderContext emits on every push (which would otherwise loop:
  // push → context state change → new ctx value → effect re-runs → push).
  const ctxRef = useRef(headerCtx);
  ctxRef.current = headerCtx;

  useEffect(() => {
    const ctx = ctxRef.current;
    if (!ctx) return;
    ctx.push(id, { title: titleStr, subtitle: subtitleStr });
    return () => ctxRef.current?.pop(id);
  }, [id, titleStr, subtitleStr]);

  return null;
}
