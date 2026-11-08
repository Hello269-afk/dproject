import type { ReactNode } from "react";
import { AppWindow, CheckCircle2, CircleDashed, TabletSmartphone } from "lucide-react";
import { PageHeader } from "../components/Common";
import { Badge, Card } from "../components/ui";

function Phase2({
  icon,
  title,
  summary,
  needs,
  today,
}: {
  icon: ReactNode;
  title: string;
  summary: string;
  needs: string[];
  today: string[];
}) {
  return (
    <>
      <PageHeader title={title} eyebrow={<Badge tone="accent">Phase 2</Badge>} description={summary} />
      <Card className="overflow-hidden">
        <div className="flex flex-col items-center border-b border-border bg-surface-2/50 px-6 py-12 text-center">
          <div className="relative mb-5 grid place-items-center">
            <div className="absolute size-28 rounded-full border border-dashed border-border-strong" />
            <div className="absolute size-20 rounded-full border border-border" />
            <div className="relative grid size-12 place-items-center rounded-xl border border-border bg-surface text-accent shadow-xs [&_svg]:size-5">
              {icon}
            </div>
          </div>
          <h2 className="text-[16px] font-semibold text-fg">Not available yet</h2>
          <p className="mt-1.5 max-w-lg text-[13px] leading-relaxed text-muted">
            This page is intentionally empty rather than showing placeholder data. It will light up once the pieces below exist.
          </p>
        </div>
        <div className="grid gap-0 md:grid-cols-2 md:divide-x divide-border">
          <div className="p-6">
            <h3 className="mb-3 text-[13px] font-semibold text-fg">What's needed</h3>
            <ul className="space-y-2.5">
              {needs.map((n) => (
                <li key={n} className="flex gap-2.5 text-[13px] leading-relaxed text-fg-2">
                  <CircleDashed className="mt-0.5 size-4 shrink-0 text-subtle" />
                  {n}
                </li>
              ))}
            </ul>
          </div>
          <div className="border-t border-border p-6 md:border-t-0">
            <h3 className="mb-3 text-[13px] font-semibold text-fg">What works today</h3>
            <ul className="space-y-2.5">
              {today.map((n) => (
                <li key={n} className="flex gap-2.5 text-[13px] leading-relaxed text-fg-2">
                  <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-success" />
                  {n}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </Card>
    </>
  );
}

export function ApplicationsPage() {
  return (
    <Phase2
      icon={<AppWindow />}
      title="Applications"
      summary="See installed apps per device and distribute managed apps."
      needs={[
        "An installed-apps inventory reported by the device app (needs usage access or managed-device APIs on Android; not available to regular iOS apps).",
        "Managed Google Play / Apple Business Manager integration for app distribution.",
        "Inventory and deployment endpoints in the API protocol.",
      ]}
      today={[
        "The MDM app version for every device is shown on the device detail page.",
        "Usage access can be requested as a permission during enrollment.",
      ]}
    />
  );
}

export function IosSupportPage() {
  return (
    <Phase2
      icon={<TabletSmartphone />}
      title="iOS Devices"
      summary="Enrollment and management of iPhones and iPads."
      needs={[
        "The iOS device app (apps/ios), using the same device protocol as Android.",
        "A ReplayKit Broadcast Upload Extension for screen sharing; iOS shows its own picker and recording indicator every session.",
        "Apple MDM enrollment (APNs certificate and configuration profiles) for anything beyond what a regular app can do.",
      ]}
      today={[
        "The dashboard, protocol and permission catalog already model iOS: platform filters, iOS columns in the permission comparison and iOS manage instructions.",
        "Android devices are fully supported end to end.",
      ]}
    />
  );
}
