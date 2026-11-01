import type { Metadata } from "next";
import AppShell from "@/components/shell/AppShell";

/**
 * User data deletion instructions — the page the Meta app
 * dashboard (and the other providers) point at. The steps match
 * the operator route that actually exists: deleting the
 * auth:user:<email> record in the endpoint's KV store.
 */

export const metadata: Metadata = {
  // The layout template appends "· RobotForge".
  title: "Data Deletion",
  description:
    "How to have your RobotForge account and its stored data deleted.",
};

export default function DataDeletionPage() {
  return (
    <AppShell active="" gate={false} crumbs={[{ label: "Data Deletion" }]}>
      <div className="page-head">
        <div>
          <div className="eyebrow">Fine print</div>
          <h1>Deleting your data</h1>
          <p className="lede">
            How to have your RobotForge account — and everything stored
            with it — removed.
          </p>
        </div>
      </div>

      <section className="section">
        <h2>How to request deletion</h2>
        <p>
          Email{" "}
          <a href="mailto:abelxmendoza@gmail.com?subject=Delete%20my%20RobotForge%20account">
            abelxmendoza@gmail.com
          </a>{" "}
          from the email address on your account (or tell us which
          account email to delete) with the subject{" "}
          <strong>&ldquo;Delete my RobotForge account&rdquo;</strong>.
          The operator deletes the account record and confirms by
          reply when it is done.
        </p>
      </section>

      <section className="section">
        <h2>What gets deleted</h2>
        <p>
          Deleting the account record removes everything the server
          holds for the account: the email address, display name,
          password hash (if any), role, sign-in provider and provider
          user ID, and the creation date. Because sessions are checked
          against that record, any signed-in session for the account
          stops working as soon as the record is removed.
        </p>
        <p>
          If you signed in with Meta, GitHub or Google, you can also
          revoke RobotForge&apos;s access at any time from that
          provider&apos;s own app-settings page; revoking there does
          not by itself delete the RobotForge account record, so email
          us as above if you want the record itself gone.
        </p>
      </section>

      <section className="section">
        <h2>What deletion does not cover</h2>
        <p>
          Your robots, inventory and specs are stored only in your own
          browser&apos;s localStorage — they are not account data and
          the server never had them. To remove them, clear this site&apos;s
          data in your browser settings. Prompts you sent to the live
          Forge were processed by AI model providers to produce their
          answers; RobotForge does not keep a server-side copy of them
          to delete.
        </p>
      </section>
    </AppShell>
  );
}
