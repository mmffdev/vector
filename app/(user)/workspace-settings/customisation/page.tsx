"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

export default function CustomisationRoot() {
  const router = useRouter();
  useEffect(() => {
    router.replace("/workspace-settings/customisation/organisation");
  }, [router]);
  return null;
}
