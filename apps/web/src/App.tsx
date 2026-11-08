import { Route, Routes } from "react-router";
import { Toaster } from "sonner";
import { Loader2, ServerCrash } from "lucide-react";
import { useAuth } from "./state/auth";
import { useTheme } from "./state/theme";
import { RealtimeProvider } from "./state/realtime";
import { AppShell } from "./components/AppShell";
import { Button } from "./components/ui";
import { LoginPage } from "./pages/LoginPage";
import { SetupPage } from "./pages/SetupPage";
import { PublicEnrollPage } from "./pages/PublicEnrollPage";
import { OverviewPage } from "./pages/OverviewPage";
import { DevicesPage } from "./pages/DevicesPage";
import { DeviceDetailPage } from "./pages/device/DeviceDetailPage";
import { EnrollmentPage } from "./pages/EnrollmentPage";
import { MonitoringPage } from "./pages/MonitoringPage";
import { RemoteAssistancePage } from "./pages/RemoteAssistancePage";
import { ScreenSessionsPage } from "./pages/ScreenSessionsPage";
import { UsersPage } from "./pages/UsersPage";
import { OrganizationPage } from "./pages/OrganizationPage";
import { PermissionsPage } from "./pages/PermissionsPage";
import { ApplicationsPage, IosSupportPage } from "./pages/Phase2Pages";
import { PoliciesPage } from "./pages/PoliciesPage";
import { RemoteControlPage } from "./pages/RemoteControlPage";
import { AuditPage } from "./pages/AuditPage";
import { SettingsPage } from "./pages/SettingsPage";
import { NotFoundPage } from "./pages/NotFoundPage";

export function App() {
  const { resolved } = useTheme();
  return (
    <>
      <Routes>
        <Route path="/enroll/:token" element={<PublicEnrollPage />} />
        <Route path="*" element={<AuthGate />} />
      </Routes>
      <Toaster theme={resolved} position="bottom-right" closeButton richColors={false} toastOptions={{ className: "font-sans" }} />
    </>
  );
}

function AuthGate() {
  const { status, bootError, retryBoot } = useAuth();

  if (status === "booting") {
    return (
      <div className="grid min-h-dvh place-items-center bg-bg">
        <Loader2 className="size-6 animate-spin text-muted" aria-label="Loading" />
      </div>
    );
  }
  if (status === "unreachable") {
    return (
      <div className="grid min-h-dvh place-items-center bg-bg px-6">
        <div className="max-w-sm text-center">
          <div className="mx-auto mb-4 grid size-12 place-items-center rounded-xl border border-border bg-surface text-danger-fg">
            <ServerCrash className="size-5" />
          </div>
          <h1 className="text-[17px] font-semibold text-fg">Can't reach the API server</h1>
          <p className="mt-1.5 text-[13px] text-muted">{bootError ?? "The server did not respond."} Check that the API is running and try again.</p>
          <Button className="mt-5" variant="primary" onClick={retryBoot}>
            Try again
          </Button>
        </div>
      </div>
    );
  }
  if (status === "needsSetup") return <SetupPage />;
  if (status === "anonymous") return <LoginPage />;

  return (
    <RealtimeProvider>
      <Routes>
        <Route element={<AppShell />}>
          <Route index element={<OverviewPage />} />
          <Route path="devices" element={<DevicesPage />} />
          <Route path="devices/:id" element={<DeviceDetailPage />} />
          <Route path="enrollment" element={<EnrollmentPage />} />
          <Route path="monitoring" element={<MonitoringPage />} />
          <Route path="assist" element={<RemoteAssistancePage />} />
          <Route path="assist/:id" element={<RemoteAssistancePage />} />
          <Route path="sessions" element={<ScreenSessionsPage />} />
          <Route path="users" element={<UsersPage />} />
          <Route path="organization" element={<OrganizationPage />} />
          <Route path="permissions" element={<PermissionsPage />} />
          <Route path="policies" element={<PoliciesPage />} />
          <Route path="applications" element={<ApplicationsPage />} />
          <Route path="remote-control" element={<RemoteControlPage />} />
          <Route path="ios" element={<IosSupportPage />} />
          <Route path="audit" element={<AuditPage />} />
          <Route path="settings" element={<SettingsPage />} />
          <Route path="*" element={<NotFoundPage />} />
        </Route>
      </Routes>
    </RealtimeProvider>
  );
}
