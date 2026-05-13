"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

export default function DevRoot() {
  const router = useRouter();
  useEffect(() => { router.replace("/dev/setup"); }, [router]);
  return null;
}
