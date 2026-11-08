import { useCallback, useState } from "react";
import { toast } from "sonner";

export function useCopy(timeout = 1600) {
  const [copied, setCopied] = useState<string | null>(null);
  const copy = useCallback(
    async (text: string, label = "Copied to clipboard", id = text) => {
      try {
        await navigator.clipboard.writeText(text);
        setCopied(id);
        toast.success(label);
        setTimeout(() => setCopied((c) => (c === id ? null : c)), timeout);
      } catch {
        toast.error("Copy failed. Your browser blocked clipboard access.");
      }
    },
    [timeout],
  );
  return { copied, copy };
}
