'use client';
/* Old /kit/?part=<id> links (Wrench answers, bookmarks) pointed at
 * the parts catalogue that used to sit on this page. It lives in
 * My Parts and Tools now (2026-11-17), so forward them there. */
import { useEffect } from 'react';
import { catalogPartHref } from '@/lib/partsLibrary';

export default function KitPartForward() {
  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get('part');
    if (id) window.location.replace(catalogPartHref(id));
  }, []);
  return null;
}
