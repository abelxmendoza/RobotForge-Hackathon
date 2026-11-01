"use client";
import { useEffect } from "react";
import Link from "next/link";

export default function BomRedirect() {
  useEffect(() => { window.location.replace("/garage/#tab=bom"); }, []);
  return (
    <main style={{ padding: 32 }}>
      <p>The bill of materials now lives in the Workshop. <Link href="/garage/#tab=bom">Open the BOM tab</Link>.</p>
    </main>
  );
}
