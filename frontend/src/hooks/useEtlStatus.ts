import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { API_BASE } from "../config";
import { etlAuthHeaders, clearAdminKey } from "../lib/adminKey";

/**
 * Fetch an /api/etl/* endpoint with the X-ETL-API-Key header attached.
 * A 403 means the stored key is no longer valid: clear it so <AdminGuard>
 * resets to the locked state.
 */
async function etlFetch(url: string, init?: RequestInit): Promise<Response> {
  const res = await fetch(url, { ...init, headers: { ...etlAuthHeaders(), ...init?.headers } });
  if (res.status === 403) {
    clearAdminKey();
  }
  return res;
}

interface LastRun {
  id: number;
  status: string;
  started_at: string;
  finished_at: string | null;
  rows_loaded: number | null;
  error_message: string | null;
  triggered_by: string | null;
  validation_status: string | null;
}

export interface EtlSource {
  name: string;
  schedule: string;
  depends_on: string[];
  last_run: LastRun | null;
}

interface EtlRunItem {
  id: number;
  source: string;
  status: string;
  started_at: string;
  finished_at: string | null;
  rows_loaded: number | null;
  triggered_by: string | null;
  validation_status: string | null;
  error_message: string | null;
}

export function useEtlStatus() {
  return useQuery<EtlSource[]>({
    queryKey: ["etlStatus"],
    queryFn: async () => {
      const res = await etlFetch(`${API_BASE}/api/etl/status`);
      if (!res.ok) throw new Error(`ETL status ${res.status}`);
      const data = await res.json();
      return data.sources;
    },
    refetchInterval: 30_000,
  });
}

export function useEtlRuns(limit = 20) {
  return useQuery<EtlRunItem[]>({
    queryKey: ["etlRuns", limit],
    queryFn: async () => {
      const res = await etlFetch(`${API_BASE}/api/etl/runs?limit=${limit}`);
      if (!res.ok) throw new Error(`ETL runs ${res.status}`);
      const data = await res.json();
      return data.runs;
    },
    refetchInterval: 30_000,
  });
}

export function useTriggerEtl() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (only?: string) => {
      const url = only
        ? `${API_BASE}/api/etl/run?only=${only}`
        : `${API_BASE}/api/etl/run`;
      const res = await etlFetch(url, { method: "POST" });
      if (!res.ok) throw new Error(`Trigger failed ${res.status}`);
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["etlStatus"] });
      qc.invalidateQueries({ queryKey: ["etlRuns"] });
    },
  });
}
