import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError } from "../lib/api";

export interface QueryState<T> {
  data: T | undefined;
  error: ApiError | Error | null;
  loading: boolean;
  /** Refetch; keeps the current data visible while loading. */
  reload: () => Promise<void>;
  setData: (updater: (prev: T | undefined) => T | undefined) => void;
}

/** Minimal fetch-on-mount hook. `key` changes trigger a refetch. */
export function useApiQuery<T>(fetcher: (signal: AbortSignal) => Promise<T>, key: unknown[] = [], enabled = true): QueryState<T> {
  const [data, setDataState] = useState<T | undefined>(undefined);
  const [error, setError] = useState<ApiError | Error | null>(null);
  const [loading, setLoading] = useState<boolean>(enabled);
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;
  const ctrlRef = useRef<AbortController | null>(null);

  const run = useCallback(async () => {
    ctrlRef.current?.abort();
    const ctrl = new AbortController();
    ctrlRef.current = ctrl;
    setLoading(true);
    try {
      const result = await fetcherRef.current(ctrl.signal);
      if (ctrl.signal.aborted) return;
      setDataState(result);
      setError(null);
    } catch (err) {
      if (ctrl.signal.aborted || (err as Error)?.name === "AbortError") return;
      setError(err as Error);
    } finally {
      if (!ctrl.signal.aborted) setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!enabled) {
      setLoading(false);
      return;
    }
    void run();
    return () => ctrlRef.current?.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, run, ...key]);

  const setData = useCallback((updater: (prev: T | undefined) => T | undefined) => setDataState(updater), []);

  return { data, error, loading, reload: run, setData };
}
