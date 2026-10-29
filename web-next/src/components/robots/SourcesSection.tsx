import type { SourceEntry, SourceRecord } from "@/lib/types";
import { REPO_URL } from "@/components/shell/AppShell";

/* Sources & models (Wave 4): the retrieval layer's per-robot record,
   rendered as filed. Retrieval is operator-side — someone (or an
   engine run) opened each page, verified what it actually says, and
   committed this record with its date; the app displays the record
   and never fetches pages live, and a retrieved source is proposed
   into the record, never auto-merged into the robot's spec.
   Official and community sources are kept in separate groups, gated
   sources are labelled gated, and every entry carries the source's
   own license/terms — the record's headline states the vendor's
   position plainly rather than smoothing it. */

const KIND_LABEL: Record<SourceEntry["kind"], string> = {
  "official-docs": "Official docs",
  "official-cad": "Official CAD / model file",
  "official-support": "Official support",
  "community-model": "Community model",
  "sim-model": "Simulation model",
  "spec-sheet": "Spec sheet",
};

function EntryCard({ e }: { e: SourceEntry }) {
  return (
    <div className="card" style={{ marginTop: 12 }}>
      <div className="card-head">
        <h3 style={{ fontSize: "var(--fs-md)" }}>
          <a href={e.url} target="_blank" rel="noreferrer">{e.title}</a>
        </h3>
        <span className="faint" style={{ fontSize: "var(--fs-sm)" }}>
          {KIND_LABEL[e.kind]}
        </span>
      </div>
      <p className="prov" style={{ marginTop: 8 }}>
        <span>
          <strong>Access:</strong>{" "}
          {e.gated
            ? "gated — not a public download (see notes)"
            : "public"}
          {" "}· retrieved {e.retrieved}
        </span>
        <span>
          <strong>License / terms:</strong> {e.license_or_terms}
        </span>
      </p>
      <p className="muted" style={{ fontSize: "var(--fs-sm)", marginTop: 8 }}>
        {e.notes}
      </p>
    </div>
  );
}

export default function SourcesSection({
  record,
  slug,
}: {
  record: SourceRecord;
  slug: string;
}) {
  const official = record.entries.filter((e) => e.provenance === "OFFICIAL");
  const community = record.entries.filter((e) => e.provenance === "COMMUNITY");
  return (
    <section className="section" id="sources">
      <h2>Sources &amp; models</h2>
      <p className="sub">
        Where this robot&apos;s models and interface data actually live
        on the web — gathered by a retrieval pass and filed as a
        record on {record.retrieved}. Retrieval happens
        operator-side: each page below was opened and read, its gate
        and terms recorded as found. This page displays that record;
        it does not fetch anything live, and a retrieved source is
        proposed into the record — never auto-merged into the
        robot&apos;s spec.
      </p>
      <div className="callout" style={{ marginTop: 12 }}>
        <span>{record.headline}</span>
      </div>

      {official.length ? (
        <>
          <h3 style={{ fontSize: "var(--fs-md)", marginTop: 20 }}>
            Official — the vendor and its licensees
          </h3>
          {official.map((e) => (
            <EntryCard key={e.url} e={e} />
          ))}
        </>
      ) : null}

      {community.length ? (
        <>
          <h3 style={{ fontSize: "var(--fs-md)", marginTop: 20 }}>
            Community — not the vendor&apos;s, and never labelled as
            if it were
          </h3>
          {community.map((e) => (
            <EntryCard key={e.url} e={e} />
          ))}
        </>
      ) : null}

      {record.notes ? (
        <p className="muted" style={{ fontSize: "var(--fs-sm)", marginTop: 16 }}>
          {record.notes}
        </p>
      ) : null}
      <p className="prov" style={{ marginTop: 12 }}>
        <span>
          <strong>Record:</strong>{" "}
          <a href={`${REPO_URL}/blob/main/catalog/sources/${slug}.json`}>
            <code>catalog/sources/{slug}.json</code>
          </a>{" "}
          · schema <code>robotforge-sources/1</code> · retrieved{" "}
          {record.retrieved}
        </span>
      </p>
    </section>
  );
}
