#!/usr/bin/env node
/**
 * force-materialize.mjs — extract <pkg>/src → workspace src, then flatten deps.
 * ---------------------------------------------------------------------------
 *   node force-materialize.mjs [pkgName=unkbv10]
 *
 * Order: copy (workspace-wins) → merge deps → strip @source → rewrite entry
 *        → uninstall.
 *
 * MERGE RULE (non-negotiable): the workspace always wins. A local file at
 * src/X is an intentional override; the package copy must never overwrite it.
 * See flatten-guide.md §5.
 */
import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import process from "node:process";

const PKG = process.argv[2] || "unkbv10";
const ROOT = process.cwd();
const SRC = path.join(ROOT, "src");
const PKG_ROOT = path.join(ROOT, "node_modules", PKG);
const PKG_SRC = path.join(PKG_ROOT, "src");

// Never copy these out of the package — the workspace owns build config.
const NEVER_COPY = new Set([
  "vite.config.ts", "vite.config.js", "tsconfig.json", "tsconfig.node.json",
  "eject.cjs", "eject.js", "eject.mjs", "postinstall.js",
  ".sync-lock", "sync-lock-permanent.txt", "package.json", "package-lock.json",
]);

const rel = (p) => path.relative(ROOT, p).split(path.sep).join("/");
let copied = 0, preserved = 0;

function copyTree(from, to) {
  fs.mkdirSync(to, { recursive: true });
  for (const e of fs.readdirSync(from, { withFileTypes: true })) {
    if (NEVER_COPY.has(e.name)) continue;
    const s = path.join(from, e.name);
    const d = path.join(to, e.name);
    if (e.isDirectory()) { copyTree(s, d); continue; }
    if (fs.existsSync(d)) {
      // WORKSPACE WINS. The local file is a deliberate override.
      console.log(`  \u00b7 preserved override ${rel(d)}`);
      preserved++;
      continue;
    }
    fs.copyFileSync(s, d);
    copied++;
  }
}

console.log("=".repeat(72));
console.log(`force-materialize.mjs — extracting ${PKG}`);
console.log("=".repeat(72));

if (!fs.existsSync(PKG_SRC)) {
  console.error(`\u2717 ${rel(PKG_SRC)} not found. Run: npm install ${PKG}`);
  process.exit(1);
}

// ── STEP 1: copy package src → workspace src ───────────────────────────────
console.log("\n[1/5] Copying package src -> workspace src (workspace wins)");
copyTree(PKG_SRC, SRC);
console.log(`  \u2713 ${copied} copied, ${preserved} local override(s) preserved`);

const pkgPublic = path.join(PKG_ROOT, "public");
if (fs.existsSync(pkgPublic)) {
  console.log("\n[1b] Copying package public/");
  copyTree(pkgPublic, path.join(ROOT, "public"));
}

// ── STEP 2: merge dependencies ─────────────────────────────────────────────
console.log("\n[2/5] Merging dependencies");
const wsPjPath = path.join(ROOT, "package.json");
const wsPj = JSON.parse(fs.readFileSync(wsPjPath, "utf8"));
const pkPj = JSON.parse(fs.readFileSync(path.join(PKG_ROOT, "package.json"), "utf8"));
const added = [];
for (const field of ["dependencies", "devDependencies"]) {
  wsPj[field] = wsPj[field] || {};
  for (const [name, ver] of Object.entries(pkPj[field] || {})) {
    if (name === PKG) continue;
    if (!wsPj.dependencies?.[name] && !wsPj.devDependencies?.[name]) {
      wsPj[field][name] = ver;
      added.push(`${name}@${ver}`);
    }
  }
}
delete wsPj.dependencies?.[PKG];
delete wsPj.devDependencies?.[PKG];
for (const f of ["dependencies", "devDependencies"]) {
  if (wsPj[f]) wsPj[f] = Object.fromEntries(Object.entries(wsPj[f]).sort(([a], [b]) => a.localeCompare(b)));
}
fs.writeFileSync(wsPjPath, JSON.stringify(wsPj, null, 2) + "\n", "utf8");
console.log(`  \u2713 added ${added.length}: ${added.join(", ") || "(none)"}`);
console.log(`  \u2713 removed dependency "${PKG}"`);

// ── STEP 3: strip the Tailwind @source sidecar line ────────────────────────
console.log("\n[3/5] Stripping Tailwind @source sidecar line");
const cssPath = path.join(SRC, "index.css");
if (fs.existsSync(cssPath)) {
  const before = fs.readFileSync(cssPath, "utf8");
  const after = before.replace(/^\s*@source\s+["'][^"']*node_modules[^"']*["'];?\s*$\n?/gm, "");
  if (after !== before) { fs.writeFileSync(cssPath, after, "utf8"); console.log("  \u2713 removed"); }
  else console.log("  \u00b7 none found");
}

// ── STEP 4: rewrite the app entry to a local import ────────────────────────
console.log("\n[4/5] Rewriting src/App.tsx entry");
const appPath = path.join(SRC, "App.tsx");
if (fs.existsSync(appPath)) {
  const before = fs.readFileSync(appPath, "utf8");
  const after = before.replace(new RegExp(`["']${PKG}/src/([^"']+)["']`, "g"), '"./$1"');
  if (after !== before) { fs.writeFileSync(appPath, after, "utf8"); console.log("  \u2713 rewritten"); }
  else console.log("  \u00b7 already local");
}

// ── STEP 5: uninstall the package ──────────────────────────────────────────
console.log(`\n[5/5] Uninstalling ${PKG}`);
try { execSync(`npm uninstall ${PKG}`, { stdio: "inherit" }); }
catch { console.warn(`  ! npm uninstall failed — remove "${PKG}" from package.json manually`); }

console.log("\n" + "=".repeat(72));
console.log("Materialization complete. Next: node unify.mjs && node diagnostics.mjs");
console.log("=".repeat(72));
