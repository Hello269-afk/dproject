import { useEffect } from "react";
import { create } from "zustand";
import { api } from "../lib/api";
import type { PermissionDefinition, PermissionKey } from "../lib/types";

interface CatalogState {
  permissions: PermissionDefinition[] | null;
  byKey: Partial<Record<PermissionKey, PermissionDefinition>>;
  error: string | null;
  loading: boolean;
  load: () => Promise<void>;
}

const useCatalogStore = create<CatalogState>((set, get) => ({
  permissions: null,
  byKey: {},
  error: null,
  loading: false,
  load: async () => {
    if (get().loading || get().permissions) return;
    set({ loading: true });
    try {
      const { permissions } = await api.get<{ permissions: PermissionDefinition[] }>("/api/permissions/catalog", { anonymous: true });
      set({ permissions, byKey: Object.fromEntries(permissions.map((p) => [p.key, p])), error: null, loading: false });
    } catch (err) {
      set({ error: (err as Error).message, loading: false });
    }
  },
}));

/** Permission catalog (public endpoint), fetched once and cached. */
export function usePermissionCatalog() {
  const state = useCatalogStore();
  useEffect(() => {
    if (!state.permissions && !state.loading && !state.error) void state.load();
  }, [state]);
  return {
    permissions: state.permissions,
    byKey: state.byKey,
    error: state.error,
    loading: state.loading || (!state.permissions && !state.error),
    retry: () => {
      useCatalogStore.setState({ error: null });
      void useCatalogStore.getState().load();
    },
  };
}
