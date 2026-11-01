import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { checkRoute } from "./smoke-lib.mjs";

function exportFixture(html, withAsset = true) {
  const root = mkdtempSync(join(tmpdir(), "robotforge-smoke-"));
  mkdirSync(join(root, "forge"), { recursive: true });
  mkdirSync(join(root, "_next/static/chunks"), { recursive: true });
  writeFileSync(join(root, "forge/index.html"), html);
  if (withAsset) writeFileSync(join(root, "_next/static/chunks/app.js"), "// built");
  return root;
}

const route = {
  name: "forge",
  path: "forge/index.html",
  title: "Workshop · RobotForge",
  markers: ["Check a robot before you build it"],
};

test("accepts an exported route with metadata and resolvable Next assets", () => {
  const root = exportFixture('<title>Workshop · RobotForge</title><meta name="description" content="Check a robot before you build it"><script src="/_next/static/chunks/app.js"></script>');
  assert.deepEqual(checkRoute(root, route), []);
});

test("reports a missing route", () => {
  const root = exportFixture("<title>unused</title>");
  assert.deepEqual(checkRoute(root, { ...route, path: "missing/index.html" }), [
    "forge: missing export missing/index.html",
  ]);
});

test("reports missing product markers", () => {
  const root = exportFixture('<title>Workshop · RobotForge</title><script src="/_next/static/chunks/app.js"></script>');
  assert.deepEqual(checkRoute(root, route), [
    'forge: missing marker "Check a robot before you build it"',
  ]);
});

test("reports the wrong route title", () => {
  const root = exportFixture('<title>Wrong page</title>Check a robot before you build it<script src="/_next/static/chunks/app.js"></script>');
  assert.deepEqual(checkRoute(root, route), [
    'forge: expected title "Workshop · RobotForge"',
  ]);
});

test("reports a referenced Next asset that is absent", () => {
  const root = exportFixture('<title>Workshop · RobotForge</title>Check a robot before you build it<script src="/_next/static/chunks/app.js"></script>', false);
  assert.deepEqual(checkRoute(root, route), [
    "forge: missing referenced asset _next/static/chunks/app.js",
  ]);
});
