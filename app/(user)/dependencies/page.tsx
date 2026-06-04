"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import PageContent from "@/app/components/PageContent";
import PageDescription from "@/app/components/PageDescription";
import type { ArtefactDetail } from "@/app/components/ArtefactInlineForm/types";
import { DependencyMapOverlay } from "@/app/components/DependencyMap/DependencyMapOverlay";
import { Canvas } from "@/app/components/Canvas/Canvas";
import { workItems } from "@/app/lib/apiSite";

export default function DependenciesPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const artefactId = searchParams.get("ash");
  const meg = searchParams.get("meg");
  // PLA074 / B23.2.4 — `?mid=` opts the composer into persistence
  // mode. Absent → ephemeral preview (legacy). A map-picker UX that
  // sets/clears this param is deferred to a follow-up story.
  const mapId = searchParams.get("mid");
  const [artefact, setArtefact] = useState<ArtefactDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  const close = useCallback(() => {
    const params = new URLSearchParams();
    if (meg) params.set("meg", meg);
    router.push(params.size > 0 ? `/artefacts?${params}` : "/artefacts");
  }, [meg, router]);

  useEffect(() => {
    let alive = true;
    setArtefact(null);
    setError(null);

    if (!artefactId) {
      setError("Missing artefact id.");
      return () => {
        alive = false;
      };
    }

    workItems
      .get(artefactId)
      .then((row) => {
        if (!alive) return;
        setArtefact(row as ArtefactDetail);
      })
      .catch(() => {
        if (!alive) return;
        setError("This artefact could not be loaded in the active scope.");
      });

    return () => {
      alive = false;
    };
  }, [artefactId]);

  if (error) {
    return (
      <PageContent>
        <PageDescription>{error}</PageDescription>
      </PageContent>
    );
  }

  if (!artefact) {
    return (
      <Canvas
        ariaLabel="Dependency map"
        title="Dependency Map"
        subtitle="Loading artefact metadata"
        status={{
          label: "Loading",
          tone: "draft",
          ariaLabel: "Canvas state: loading",
        }}
        onClose={close}
        primaryView={
          <div className="canvas__Surface_Empty">
            <p>Loading dependency map...</p>
          </div>
        }
      />
    );
  }

  return (
    <DependencyMapOverlay
      artefact={artefact}
      onClose={close}
      mapId={mapId}
    />
  );
}
