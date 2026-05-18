"use client";

// PLA-0008 — Reusable renderer for a HelpDoc shape.
//
// Used by:
//   • Panel popover (compact variant) — short body + first 2 embeds + first 4 images.
//   • /help/<addressable_id> full page (default variant) — everything.
//   • Gadmin editor live-preview (default variant).
//
// Body HTML is server-sanitised at write time (see addressables.handler
// validateHelpRichContent + the deeper sanitiser story 00330). Video and
// image URLs are re-checked here so a bad row in the DB cannot leak a
// non-whitelisted iframe into the DOM.

import { useMemo, type ReactNode } from "react";
import DOMPurify from "isomorphic-dompurify";

export type VideoEmbed = { url: string; title?: string; position?: number };
export type ImageRef = { url: string; alt?: string; caption?: string; position?: number };

export interface HelpDoc {
  addressable_id: string;
  title?: string | null;
  body_html?: string | null;
  video_embeds?: VideoEmbed[] | null;
  image_urls?: ImageRef[] | null;
}

interface HelpDocRendererProps {
  doc: HelpDoc;
  // "compact" trims to popover-friendly size; "full" renders everything.
  variant?: "compact" | "full";
  // Show the "Open full page →" link. Defaults to true for compact, false for full.
  showOpenFullLink?: boolean;
  // Optional fallback body HTML when doc.body_html is empty (e.g. SDK manifest default).
  fallbackBodyHtml?: string | null;
  // Empty-state node for when there is nothing to render at all.
  emptyState?: ReactNode;
}

const COMPACT_VIDEOS = 2;
const COMPACT_IMAGES = 4;

// Allowlists kept in sync with backend validateHelpRichContent.
const YOUTUBE_HOSTS = new Set([
  "youtube.com",
  "www.youtube.com",
  "m.youtube.com",
  "youtu.be",
]);

function youTubeEmbedSrc(rawUrl: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return null;
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return null;
  if (!YOUTUBE_HOSTS.has(parsed.hostname)) return null;

  // youtu.be/<id>
  if (parsed.hostname === "youtu.be") {
    const id = parsed.pathname.replace(/^\/+/, "").split("/")[0];
    if (!id) return null;
    return `https://www.youtube.com/embed/${encodeURIComponent(id)}`;
  }
  // youtube.com/watch?v=<id>
  if (parsed.pathname === "/watch") {
    const id = parsed.searchParams.get("v");
    if (!id) return null;
    return `https://www.youtube.com/embed/${encodeURIComponent(id)}`;
  }
  // youtube.com/embed/<id>  — pass through after re-encoding the id segment.
  if (parsed.pathname.startsWith("/embed/")) {
    const id = parsed.pathname.slice("/embed/".length).split("/")[0];
    if (!id) return null;
    return `https://www.youtube.com/embed/${encodeURIComponent(id)}`;
  }
  return null;
}

function safeImageUrl(rawUrl: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return null;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
  return parsed.toString();
}

function sortByPosition<T extends { position?: number }>(items: T[]): T[] {
  return [...items].sort((a, b) => (a.position ?? 0) - (b.position ?? 0));
}

export default function HelpDocRenderer({
  doc,
  variant = "full",
  showOpenFullLink,
  fallbackBodyHtml = null,
  emptyState = <p className="help-doc__empty">No help text yet.</p>,
}: HelpDocRendererProps) {
  const compact = variant === "compact";
  const showLink = showOpenFullLink ?? compact;

  const bodyHtml = (doc.body_html ?? "").trim() || (fallbackBodyHtml ?? "").trim();

  // B16.8 Phase 2 — defense-in-depth XSS guard. Backend allowlist
  // (addressables/sanitise.go SanitiseHelpBodyHTML) runs at write time;
  // DOMPurify here protects the render against any future write path
  // that bypasses that gate.
  const safeBodyHtml = useMemo(
    () => (bodyHtml ? DOMPurify.sanitize(bodyHtml) : ""),
    [bodyHtml],
  );

  const videos = sortByPosition(doc.video_embeds ?? [])
    .map((v) => ({ ...v, _src: youTubeEmbedSrc(v.url) }))
    .filter((v): v is VideoEmbed & { _src: string } => v._src !== null);
  const images = sortByPosition(doc.image_urls ?? [])
    .map((i) => ({ ...i, _src: safeImageUrl(i.url) }))
    .filter((i): i is ImageRef & { _src: string } => i._src !== null);

  const renderedVideos = compact ? videos.slice(0, COMPACT_VIDEOS) : videos;
  const renderedImages = compact ? images.slice(0, COMPACT_IMAGES) : images;

  const isEmpty = !doc.title && !bodyHtml && renderedVideos.length === 0 && renderedImages.length === 0;
  if (isEmpty) {
    return (
      <div className={compact ? "help-doc help-doc--compact" : "help-doc"}>
        {emptyState}
      </div>
    );
  }

  return (
    <article className={compact ? "help-doc help-doc--compact" : "help-doc"}>
      {doc.title ? (
        compact ? (
          <h3 className="help-doc__title">{doc.title}</h3>
        ) : (
          <h1 className="help-doc__title">{doc.title}</h1>
        )
      ) : null}

      {safeBodyHtml ? (
        <div className="help-doc__body" dangerouslySetInnerHTML={{ __html: safeBodyHtml }} />
      ) : null}

      {renderedVideos.length > 0 ? (
        <div className="help-doc__videos">
          {renderedVideos.map((v, idx) => (
            <div className="help-doc__video" key={`${v._src}-${idx}`}>
              <iframe
                className="help-doc__video-frame"
                src={v._src}
                title={v.title ?? "YouTube video"}
                loading="lazy"
                allow="accelerometer; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                allowFullScreen
                referrerPolicy="strict-origin-when-cross-origin"
              />
              {v.title ? <p className="help-doc__video-caption">{v.title}</p> : null}
            </div>
          ))}
        </div>
      ) : null}

      {renderedImages.length > 0 ? (
        <ul className="help-doc__gallery">
          {renderedImages.map((img, idx) => (
            <li className="help-doc__gallery-item" key={`${img._src}-${idx}`}>
              {/* Help-doc images are author-curated for explanatory purposes,
                  not page chrome — using <img> keeps it simple and avoids
                  forcing every gadmin to whitelist a Next/Image domain. */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                className="help-doc__gallery-image"
                src={img._src}
                alt={img.alt ?? ""}
                loading="lazy"
              />
              {img.caption ? (
                <p className="help-doc__gallery-caption">{img.caption}</p>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}

      {compact && (videos.length > renderedVideos.length || images.length > renderedImages.length) ? (
        <p className="help-doc__overflow-note">
          More media on the full help page.
        </p>
      ) : null}

      {showLink ? (
        <p className="help-doc__open-full">
          <a
            className="help-doc__open-full-link"
            href={`/help/${encodeURIComponent(doc.addressable_id)}`}
            target="_blank"
            rel="noopener noreferrer"
          >
            Open full help page →
          </a>
        </p>
      ) : null}
    </article>
  );
}
