/* Admin console — founder only. Who has an account on RobotForge
 * and who has actually logged in, served by the endpoint's
 * founder-gated /auth/admin/users route. The page shell is public
 * like every app page; the data is not — the console component
 * signs the founder in, and the endpoint enforces the role. */
import type { Metadata } from "next";
import AppShell from "@/components/shell/AppShell";
import AdminConsole from "@/components/admin/AdminConsole";

export const metadata: Metadata = {
  title: "Admin console",
  description: "Founder-only: every RobotForge account and its login activity.",
};

export default function AdminPage() {
  return (
    <AppShell active="" crumbs={[{ label: "Admin console" }]}>
      <div className="page-head">
        <div>
          <div className="eyebrow">Founder</div>
          <h1>Admin console</h1>
          <p className="lede">
            Everyone who has made a RobotForge account — and everyone
            who has actually logged in.
          </p>
        </div>
      </div>
      <AdminConsole />
    </AppShell>
  );
}
