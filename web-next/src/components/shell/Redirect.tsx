"use client";
/* Client redirect for retired routes; keeps the #hash (sample deep
 * links like /forge/#words still play their run). */
import { useEffect } from "react";
import { useRouter } from "next/navigation";

export default function Redirect({ to, label }: { to: string; label: string }) {
  const router = useRouter();
  useEffect(() => {
    router.replace(to + (to.includes("#") ? "" : window.location.hash));
  }, [router, to]);
  return <p style={{ padding: 24 }}>Opening <a href={to}>{label}</a>…</p>;
}
