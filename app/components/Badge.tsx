"use client";

import Link from "next/link";
import type { ReactNode } from "react";

export type BadgeKind = "status" | "count" | "letter" | "tag";

export type BadgeTone =
  | "success"
  | "warning"
  | "danger"
  | "info"
  | "neutral"
  | "brand";

export type BadgeSpec = {
  kind: BadgeKind;
  tone?: BadgeTone;
  state?: string;
  label?: string;
  value?: number;
  domain?: string;
  domainValue?: string;
  iconRef?: string;
  title?: string;
  href?: string;
  size?: "sm" | "md";
};

export type BadgeProps = BadgeSpec & {
  icon?: ReactNode;
  className?: string;
  onClick?: () => void;
};

const STATUS_TONES: Record<string, BadgeTone> = {
  active: "success",
  enabled: "success",
  ok: "success",
  healthy: "success",
  inactive: "neutral",
  disabled: "neutral",
  archived: "neutral",
  pending: "warning",
  warning: "warning",
  degraded: "warning",
  failed: "danger",
  error: "danger",
  blocked: "danger",
  info: "info",
};

const DOMAIN_TONES: Record<string, Record<string, BadgeTone>> = {
  "work-item-type": {
    epic: "info",
    story: "brand",
    task: "neutral",
    defect: "danger",
    risk: "warning", // PLA-0052 — visually distinct from defect's danger red
  },
  env: {
    dev: "info",
    staging: "warning",
    production: "danger",
  },
};

function resolveTone(props: BadgeProps): BadgeTone {
  if (props.tone) return props.tone;
  if (props.kind === "status" && props.state) {
    return STATUS_TONES[props.state.toLowerCase()] ?? "neutral";
  }
  if (props.kind === "letter" && props.domain && props.domainValue) {
    const map = DOMAIN_TONES[props.domain];
    if (map) return map[props.domainValue.toLowerCase()] ?? "neutral";
  }
  return "neutral";
}

function resolveLabel(props: BadgeProps): string {
  if (props.label) return props.label;
  if (props.kind === "status" && props.state) {
    return props.state.charAt(0).toUpperCase() + props.state.slice(1);
  }
  if (props.kind === "count" && typeof props.value === "number") {
    return props.value > 9 ? "9+" : String(props.value);
  }
  if (props.kind === "letter" && props.domainValue) {
    return props.domainValue.slice(0, 2).toUpperCase();
  }
  return "";
}

export default function Badge(props: BadgeProps) {
  const tone = resolveTone(props);
  const label = resolveLabel(props);
  const size = props.size ?? "sm";

  if (props.kind === "count" && typeof props.value === "number" && props.value <= 0) {
    return null;
  }

  const classes = [
    "pill",
    `pill--${tone}`,
    props.kind === "count" ? "pill--count" : null,
    props.kind === "letter" ? "pill--letter" : null,
    size === "md" ? "pill--md" : null,
    props.className,
  ]
    .filter(Boolean)
    .join(" ");

  const content = (
    <>
      {props.icon ? <span className="pill__icon" aria-hidden="true">{props.icon}</span> : null}
      {label ? <span className="pill__label">{label}</span> : null}
    </>
  );

  if (props.href) {
    return (
      <Link href={props.href} className={classes} title={props.title}>
        {content}
      </Link>
    );
  }

  if (props.onClick) {
    return (
      <button type="button" className={classes} title={props.title} onClick={props.onClick}>
        {content}
      </button>
    );
  }

  return (
    <span className={classes} title={props.title}>
      {content}
    </span>
  );
}
