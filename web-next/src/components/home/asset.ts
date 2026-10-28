/**
 * Resolve a repo-local asset path ("assets/img/hero.jpg", as recorded in
 * catalog data and used verbatim by the vanilla site) to a URL in the
 * exported Next site.
 *
 * The vanilla landing sits at the site root, so it can use the relative
 * path as-is. The Next export serves every route under the configured
 * basePath (next.config.mjs: "/RobotForge-Hackathon"), so local assets
 * are referenced root-absolutely. External URLs pass through untouched.
 *
 * If the deployment ever serves assets from somewhere else, this is the
 * one place to change.
 */
export const BASE_PATH = "/RobotForge-Hackathon";

export function assetPath(src: string): string {
  if (/^(https?:)?\/\//.test(src) || src.startsWith("data:")) return src;
  return `${BASE_PATH}/${src.replace(/^\.?\//, "")}`;
}
