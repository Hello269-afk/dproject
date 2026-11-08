import { useEffect, useRef, useState } from "react";
import { MessageSquare, SendHorizontal } from "lucide-react";
import { toast } from "sonner";
import { Button, Card, EmptyState, Skeleton, Textarea } from "./ui";
import { api, errorMessage } from "../lib/api";
import { cn } from "../lib/cn";
import { formatTime, formatDate } from "../lib/format";
import type { Device, SupportMessage } from "../lib/types";
import { useApiQuery } from "../hooks/useApiQuery";
import { useRealtimeEvent } from "../state/realtime";
import { deviceUserName } from "../lib/devices";

export function MessagesPanel({ device, className }: { device: Device; className?: string }) {
  const q = useApiQuery(
    (signal) => api.get<{ messages: SupportMessage[] }>(`/api/devices/${device.id}/messages`, { signal }).then((r) => r.messages),
    [device.id],
  );
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useRealtimeEvent("message.created", ({ message }) => {
    if (message.deviceId !== device.id) return;
    q.setData((prev) => (prev ? (prev.some((m) => m.id === message.id) ? prev : [...prev, message]) : prev));
  });

  const messages = q.data ?? [];
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages.length]);

  const canSend = device.lifecycleStatus === "authenticated";

  const send = async () => {
    const body = draft.trim();
    if (!body || sending) return;
    setSending(true);
    try {
      const { message } = await api.post<{ message: SupportMessage }>(`/api/devices/${device.id}/messages`, { body });
      q.setData((prev) => (prev ? (prev.some((m) => m.id === message.id) ? prev : [...prev, message]) : [message]));
      setDraft("");
    } catch (err) {
      toast.error("Message not sent", { description: errorMessage(err) });
    } finally {
      setSending(false);
    }
  };

  let lastDay = "";

  return (
    <Card className={cn("flex min-h-[420px] flex-col", className)}>
      <div className="flex items-center justify-between border-b border-border px-5 py-3.5">
        <div>
          <h3 className="text-[15px] font-semibold text-fg">Support chat</h3>
          <p className="text-[12px] text-muted">
            With {deviceUserName(device)} on {device.name}
            {!device.online && " · delivered when the device reconnects"}
          </p>
        </div>
      </div>
      <div ref={scrollRef} className="min-h-0 flex-1 space-y-2 overflow-y-auto px-4 py-4" aria-live="polite">
        {q.loading && !q.data ? (
          <div className="space-y-3">
            <Skeleton className="h-10 w-2/3" />
            <Skeleton className="ml-auto h-10 w-1/2" />
            <Skeleton className="h-10 w-3/5" />
          </div>
        ) : q.error ? (
          <EmptyState compact icon={<MessageSquare />} title="Couldn't load messages" description={errorMessage(q.error)} action={<Button onClick={() => void q.reload()}>Retry</Button>} />
        ) : messages.length === 0 ? (
          <EmptyState compact icon={<MessageSquare />} title="No messages yet" description="Messages you send appear on the device as notifications." />
        ) : (
          messages.map((m) => {
            const day = formatDate(m.createdAt);
            const showDay = day !== lastDay;
            lastDay = day;
            const out = m.direction === "to_device";
            return (
              <div key={m.id}>
                {showDay && <div className="my-3 text-center text-[11px] font-medium text-subtle">{day}</div>}
                <div className={cn("flex", out ? "justify-end" : "justify-start")}>
                  <div
                    className={cn(
                      "max-w-[80%] rounded-2xl px-3.5 py-2 text-[13px] leading-relaxed",
                      out ? "rounded-br-md bg-accent text-accent-fg" : "rounded-bl-md bg-surface-2 text-fg",
                    )}
                  >
                    <div className="whitespace-pre-wrap break-words">{m.body}</div>
                    <div className={cn("mt-1 text-[10.5px]", out ? "text-white/70" : "text-muted")}>
                      {m.senderName ?? (out ? "Admin" : deviceUserName(device))} · {formatTime(m.createdAt)}
                      {out && m.readAt && " · Read"}
                    </div>
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>
      <form
        className="flex items-end gap-2 border-t border-border p-3"
        onSubmit={(e) => {
          e.preventDefault();
          void send();
        }}
      >
        <Textarea
          aria-label="Message"
          rows={1}
          value={draft}
          disabled={!canSend}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void send();
            }
          }}
          placeholder={canSend ? "Write a message… (Enter to send)" : "Messaging is unavailable for suspended or revoked devices"}
          className="min-h-[38px] flex-1 resize-none py-2"
          maxLength={2000}
        />
        <Button type="submit" variant="primary" size="icon" aria-label="Send message" loading={sending} disabled={!draft.trim() || !canSend}>
          {!sending && <SendHorizontal />}
        </Button>
      </form>
    </Card>
  );
}
