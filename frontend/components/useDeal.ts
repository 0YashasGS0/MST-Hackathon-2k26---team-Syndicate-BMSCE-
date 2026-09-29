"use client";
import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api";
import type { Deal } from "@/lib/types";

/** Loads a deal; `reload` refetches after an action. */
export function useDeal(id: string) {
  const [deal, setDeal] = useState<Deal>();
  const [error, setError] = useState<string>();

  const reload = useCallback(
    () => api.getDeal(id).then((d) => setDeal({ ...d }), (e) => setError(e instanceof Error ? e.message : String(e))),
    [id],
  );

  useEffect(() => {
    reload();
  }, [reload]);

  return { deal, error, reload, setDeal };
}
