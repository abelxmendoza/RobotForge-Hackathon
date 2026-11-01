"use client";

import { useState } from "react";
import type { PartPhoto as PartPhotoRecord } from "@/lib/types";

/* A verified part photo, hot-linked from the manufacturer's or an
 * official supplier's page (the record's source page), with its
 * credit always attached. If the remote image fails to load, the
 * component falls back to the honest placeholder — a broken-image
 * glyph must never be what "verified" looks like. Renders (the one
 * SLAMTEC record) are badged as renders, never passed off as photos.
 * The catalogue's AI-illustration `image` field is never used here. */
export default function PartPhoto({
  photo,
  name,
  variant = "thumb",
}: {
  photo: PartPhotoRecord | null;
  name: string;
  variant?: "thumb" | "card";
}) {
  const [failed, setFailed] = useState(false);
  if (!photo || failed) {
    return (
      <div
        className={`part-photo part-photo-none part-photo-${variant}`}
        role="img"
        aria-label={`No verified photo of ${name}`}
        title="The catalogue holds no verified photo of this part — only verified manufacturer/supplier photos are shown."
      >
        <span>No verified photo</span>
      </div>
    );
  }
  return (
    <figure
      className={`part-photo part-photo-${variant}`}
      title={`${photo.credit} — gathered from the source page ${photo.fetched_at}; ${photo.kind === "render" ? "a manufacturer render, not a photograph" : "a real product photo"}.`}
    >
      <img
        src={photo.url}
        alt={name}
        loading="lazy"
        referrerPolicy="no-referrer"
        onError={() => setFailed(true)}
      />
      <figcaption>
        {photo.credit}
        {photo.kind === "render" ? " · render" : ""}{" "}
        <a href={photo.source_page} target="_blank" rel="noreferrer">
          source
        </a>
      </figcaption>
    </figure>
  );
}
