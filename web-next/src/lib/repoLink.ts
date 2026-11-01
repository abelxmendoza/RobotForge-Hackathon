/* Find a GitHub repo link inside a chat message, so Wrench can hand it
 * to the repo importer. Only an explicit github.com/<owner>/<repo>
 * link counts; a bare "owner/repo" in prose is too easy to misread. */
import { parseRepoInput, type RepoRef } from "./repoImport";

export function repoLinkIn(text: string): RepoRef | null {
  const m = String(text || "").match(/(?:https?:\/\/)?(?:www\.)?github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+/i);
  if (!m) return null;
  const ref = parseRepoInput(m[0].replace(/[.,;:!?)]+$/, ""));
  if (!ref) return null;
  // github.com/<owner>/<reserved> pages are not repos.
  if (["orgs", "settings", "marketplace", "topics", "features"].includes(ref.owner.toLowerCase())) return null;
  return ref;
}

/* Fired by Wrench when a repo link is pasted while /import/ is already
 * open; detail is "owner/repo". */
export const REPO_IMPORT_EVENT = "rf-repo-import";
