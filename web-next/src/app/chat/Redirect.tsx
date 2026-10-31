"use client";
import { useEffect } from "react";
import { useRouter } from "next/navigation";

export default function Redirect() {
  const router = useRouter();
  useEffect(() => {
    router.replace("/forge/");
  }, [router]);
  return <p style={{ padding: 24 }}>Wrench lives in the <a href="/forge/">Workspace</a> now…</p>;
}
