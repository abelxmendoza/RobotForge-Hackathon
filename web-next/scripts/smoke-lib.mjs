import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

/** Check one static-exported route and return human-readable failures. */
export function checkRoute(root, route) {
  const file = join(root, route.path);
  if (!existsSync(file)) return [`${route.name}: missing export ${route.path}`];

  const html = readFileSync(file, "utf8");
  const failures = [];
  if (!html.includes(`<title>${route.title}</title>`)) {
    failures.push(`${route.name}: expected title "${route.title}"`);
  }
  for (const marker of route.markers) {
    if (!html.includes(marker)) failures.push(`${route.name}: missing marker "${marker}"`);
  }

  const assets = new Set(
    [...html.matchAll(/(?:src|href)="\/(?:_next\/[^"?#]+)(?:[?#][^"]*)?"/g)]
      .map((match) => match[0].match(/"\/([^"?#]+)/)?.[1])
      .filter(Boolean),
  );
  for (const asset of assets) {
    if (!existsSync(join(root, asset))) failures.push(`${route.name}: missing referenced asset ${asset}`);
  }
  return failures;
}

