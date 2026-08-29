"use client";

import { useEffect } from "react";

export function EntityExplorerFocus({ detailHeadingId }: { detailHeadingId: string | null }) {
  useEffect(() => {
    const targetId = detailHeadingId ?? window.location.hash.slice(1);
    if (targetId === "") return;
    document.getElementById(targetId)?.focus();
  }, [detailHeadingId]);

  return null;
}
