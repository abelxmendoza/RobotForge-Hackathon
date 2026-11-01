import type { Metadata } from "next";
import AppShell from "@/components/shell/AppShell";

/**
 * Privacy policy — written against what the system actually does
 * (the live endpoint's account store and the site's localStorage),
 * not boilerplate. If a practice changes, this page changes with it.
 */

export const metadata: Metadata = {
  // The layout template appends "· RobotForge".
  title: "Privacy Policy",
  description:
    "What RobotForge stores for accounts, what stays in your browser, and who processes Forge prompts.",
};

export default function PrivacyPage() {
  return (
    <AppShell active="" crumbs={[{ label: "Privacy Policy" }]}>
      <div className="page-head">
        <div>
          <div className="eyebrow">Fine print</div>
          <h1>Privacy Policy</h1>
          <p className="lede">
            What RobotForge stores, what it never sees, and who touches
            your Forge prompts. Last updated November 1, 2026.
          </p>
        </div>
      </div>

      <section className="section">
        <h2>Account data (stored on the server)</h2>
        <p>
          If you create an account, the live endpoint stores one record
          per account in its database (Cloudflare KV): your email
          address, the display name you gave, your role (user, admin or
          founder), how you signed up, and the date the account was
          created.
        </p>
        <p>
          If you signed up with a password, the record holds a salted
          PBKDF2 password hash — never the password itself. If you
          signed up with Meta, GitHub or Google, the record holds that
          provider&apos;s user ID for your account instead, and no
          password hash. Social sign-in also gives us the name and
          email from that provider; we never receive your password for
          those services, and we never post to them.
        </p>
        <p>
          Signing in issues a session token (a signed JWT, valid for
          7 days) that your own browser keeps in localStorage. Signing
          out removes it from your browser.
        </p>
      </section>

      <section className="section">
        <h2>What stays in your browser</h2>
        <p>
          Your robots, inventory, specs, builds and photos you keep in
          the app live in your browser&apos;s localStorage on your
          device. They are not tied to your account, are not synced to
          the server, and we cannot see them. Clearing your browser&apos;s
          site data removes them.
        </p>
      </section>

      <section className="section">
        <h2>Forge prompts and photos</h2>
        <p>
          When you use the live Forge — describing a robot, chatting
          about a part, or submitting a photo or scan for a draft —
          the text and images you submit are sent to the live endpoint
          and processed by AI model providers: Meta (Muse Spark),
          Baseten, and Fireworks when it is switched on. Those
          providers process the input to produce the answer; do not
          put personal information in Forge prompts.
        </p>
      </section>

      <section className="section">
        <h2>What we don&apos;t do</h2>
        <p>
          We do not sell personal data. Account data is used only to
          run accounts: signing you in and applying your role. This
          version of accounts has no email verification and no
          password reset, and we do not send marketing email.
        </p>
      </section>

      <section className="section">
        <h2>Your choices</h2>
        <p>
          You can use almost all of RobotForge without an account.
          To ask what we hold about you, correct it, or have your
          account deleted, email{" "}
          <a href="mailto:abelxmendoza@gmail.com">abelxmendoza@gmail.com</a>.
          Deletion steps are on the{" "}
          <a href="/data-deletion/">data deletion page</a>.
        </p>
      </section>
    </AppShell>
  );
}
