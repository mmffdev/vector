"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

export default function ApiManagerRoot() {
  const router = useRouter();
  useEffect(() => {
    router.replace("/workspace-settings/api-manager/webhooks");
  }, [router]);
  return null;
}
