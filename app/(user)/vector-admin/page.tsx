"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

export default function VectorAdminRoot() {
  const router = useRouter();
  useEffect(() => {
    router.replace("/vector-admin/tenant-details");
  }, [router]);
  return null;
}
