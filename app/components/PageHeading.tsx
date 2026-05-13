"use client";

import React, { ReactNode } from "react";
import { buildBorderStyle, type BorderProp } from "@/app/components/Panel";

interface PageHeadingProps {
  level?:     1 | 2 | 3 | 4;
  title:      ReactNode;
  subtitle?:  ReactNode;
  className?: string;
  margin?:    [string?, string?, string?, string?];
  padding?:   [string?, string?, string?, string?];
  border?:    BorderProp;
  background?: string;
  radius?:    { top?: string; right?: string; bottom?: string; left?: string };
}

export default function PageHeading({
  level = 1,
  title,
  subtitle,
  className,
  margin,
  padding,
  border,
  background,
  radius,
}: PageHeadingProps) {
  const Tag = `h${level}` as "h1" | "h2" | "h3" | "h4";

  const marginStyle = margin
    ? {
        marginTop:    margin[0] ?? "0",
        marginRight:  margin[1] ?? "0",
        marginBottom: margin[2] ?? "0",
        marginLeft:   margin[3] ?? "0",
      }
    : undefined;

  const paddingStyle = padding
    ? {
        paddingTop:    padding[0] ?? "0",
        paddingRight:  padding[1] ?? "0",
        paddingBottom: padding[2] ?? "0",
        paddingLeft:   padding[3] ?? "0",
      }
    : undefined;

  const borderStyle  = border     ? buildBorderStyle(border) : undefined;
  const bgStyle      = background ? { background }           : undefined;

  const radiusStyle = radius
    ? {
        borderTopLeftRadius:     radius.top    ?? "0",
        borderTopRightRadius:    radius.right  ?? "0",
        borderBottomRightRadius: radius.bottom ?? "0",
        borderBottomLeftRadius:  radius.left   ?? "0",
      }
    : undefined;

  const classes = [
    "page-heading",
    `page-heading--h${level}`,
    className,
  ].filter(Boolean).join(" ");

  return (
    <div
      className={classes}
      style={{ ...marginStyle, ...paddingStyle, ...borderStyle, ...bgStyle, ...radiusStyle }}
    >
      <Tag className="page-heading__title">{title}</Tag>
      {subtitle && <p className="page-heading__subtitle">{subtitle}</p>}
    </div>
  );
}
