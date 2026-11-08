import { api } from "../lib/api";
import type { User } from "../lib/types";
import { useAuth } from "../state/auth";
import { useApiQuery } from "./useApiQuery";

/**
 * Users a device can be assigned to. Admins+ get every user; operators only
 * get members (`?role=member`), per the RBAC table.
 */
export function useAssignableUsers(enabled = true) {
  const { can } = useAuth();
  const isAdmin = can("admin");
  return useApiQuery(
    (signal) =>
      api
        .get<{ users: User[] }>("/api/users", { signal, query: isAdmin ? undefined : { role: "member" } })
        .then((r) =>
          r.users
            .filter((u) => u.status === "active")
            .sort((a, b) => (a.role === "member" ? 0 : 1) - (b.role === "member" ? 0 : 1) || a.name.localeCompare(b.name)),
        ),
    [isAdmin],
    enabled,
  );
}
