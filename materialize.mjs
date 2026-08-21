#!/usr/bin/env node
/**
 * materialize.mjs — SURGICAL single-file materializer + repair-site verifier
 * ---------------------------------------------------------------------------
 * Distinct from `force-materialize.mjs`, which flattens the ENTIRE package.
 * This script exists for the case the diagnosis engine keeps producing:
 * "the fix is one line inside one package file."
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * HONEST LIMITATION — READ BEFORE USING MODE 2
 * ═══════════════════════════════════════════════════════════════════════════
 * Copying `v15-grounding.orig.ts` into `src/` does NOT make your edit live.
 * The package imports it RELATIVELY (`./v15-grounding.orig`), and a relative
 * specifier always resolves inside the package. The `@` alias cannot intercept
 * it. See flatten-guide.md §9.
 *
 * Therefore mode 2 does the safe half automatically and REFUSES to do the
 * unsafe half silently:
 *   ✔ copies the file into src/ so it is editable, diffable, and version-controlled
 *   ✔ writes .materialized.json so a future turn knows what was taken
 *   ✔ prints the EXACT vite.config.ts alias line required to activate it
 *   ✘ does NOT edit vite.config.ts (standing repo rule: config is off-limits
 *     unless a task explicitly authorises it)
 *
 * If you want the edit live, you apply that one printed line yourself, or you
 * run the full `force-materialize.mjs` flatten where relative imports become
 * workspace-relative and the problem disappears entirely.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * MODE 1 (default, read-only) — --verify-sites
 * ═══════════════════════════════════════════════════════════════════════════
 * Greps the INSTALLED package for every anchor string registered in
 * src/lib/debug/repair-sites.ts and reports line drift. This makes the repair
 * coordinates machine-checkable rather than merely asserted: if the package
 * version changes, this tells you exactly which coordinates moved.
 *
 * USAGE
 *   node materialize.mjs                       # verify all repair-site anchors
 *   node materialize.mjs --verify-sites        # same
 *   node materialize.mjs --list                # list materializable files
 *   ALLOW_MATERIALIZE=1 node materialize.mjs lib/v15-grounding.orig.ts
 */
import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const PKG = process.env.MATERIALIZE_PKG || "unkbv10";
const ROOT = process.cwd();
const PKG_SRC = path.join(ROOT, "node_modules", PKG, "src");
const WS_SRC = path.join(ROOT, "src");
const MANIFEST = path.join(ROOT, ".materialized.json");
const SITES_FILE = path.join(WS_SRC, "lib", "debug", "repair-sites.ts");

const ok = (m) => console.log(`  \u2713 ${m}`);
const bad = (m) => console.error(`  \u2717 ${m}`);
const info = (m) => console.log(`  \u00b7 ${m}`);
const rel = (p) => path.relative(ROOT, p).split(path.sep).join("/");

// ═══════════════════════════════════════════════════════════════════════════
// MODE 1 — verify every registered repair-site anchor against the package
// ═══════════════════════════════════════════════════════════════════════════
function verifySites() {
  console.log("=".repeat(74));
  console.log("materialize.mjs --verify-sites  ·  repair coordinate drift check");
  console.log("=".repeat(74));

  if (!fs.existsSync(SITES_FILE)) {
    bad(`${rel(SITES_FILE)} not found — nothing to verify.`);
    process.exit(1);
  }
  const sitesSrc = fs.readFileSync(SITES_FILE, "utf8");

  // Parse the literal object entries. Deliberately regex-based rather than
  // importing TS: this script must run with plain node, no build step.
  const entryRe =
    /file:\s*"([^"]+)",\s*\n\s*line:\s*(\d+),\s*\n\s*symbol:\s*"([^"]*)",\s*\n\s*anchor:\s*(?:'([^']*)'|"([^"]*)")/g;

  const sites = [];
  for (const m of sitesSrc.matchAll(entryRe)) {
    sites.push({ file: m[1], line: Number(m[2]), symbol: m[3], anchor: m[4] ?? m[5] ?? "" });
  }

  if (sites.length === 0) {
    bad("Parsed 0 repair sites. The registry format changed — update the regex in this script.");
    process.exit(1);
  }
  info(`parsed ${sites.length} repair site(s) from ${rel(SITES_FILE)}\n`);

  let exact = 0, drifted = 0, missing = 0, unreadable = 0;

  for (const s of sites) {
    const abs = path.resolve(ROOT, s.file);
    if (!fs.existsSync(abs)) {
      bad(`${s.file} — FILE NOT FOUND (package layout changed?)`);
      unreadable++;
      continue;
    }
    const lines = fs.readFileSync(abs, "utf8").split("\n");
    const hits = [];
    lines.forEach((ln, i) => {
      if (s.anchor && ln.includes(s.anchor)) hits.push(i + 1);
    });

    const short = `${s.file.split("/").pop()}:${s.line}`;
    if (hits.length === 0) {
      bad(`${short} — ANCHOR NOT FOUND: "${s.anchor.slice(0, 60)}"`);
      console.error(`      → the defect may already be fixed, or the package version changed.`);
      missing++;
    } else if (hits.includes(s.line)) {
      ok(`${short} — anchor confirmed at recorded line  (${s.symbol})`);
      exact++;
    } else {
      bad(`${short} — DRIFT: anchor now at line ${hits.join(", ")}  (${s.symbol})`);
      console.error(`      → update repair-sites.ts line to ${hits[0]}. The anchor is authoritative.`);
      drifted++;
    }
  }

  console.log("\n" + "-".repeat(74));
  console.log(`exact=${exact}  drifted=${drifted}  anchor-missing=${missing}  file-missing=${unreadable}`);
  if (drifted || missing || unreadable) {
    console.error("\nRESULT: coordinates are STALE. Fix repair-sites.ts before trusting the Diagnosis tab.");
    process.exit(1);
  }
  console.log("\nRESULT: all repair coordinates verified against the installed package.");
  process.exit(0);
}

// ═══════════════════════════════════════════════════════════════════════════
// MODE 3 — list what can be materialized
// ═══════════════════════════════════════════════════════════════════════════
function listCandidates() {
  console.log("=".repeat(74));
  console.log(`materialize.mjs --list  ·  files available in ${PKG}/src`);
  console.log("=".repeat(74));
  if (!fs.existsSync(PKG_SRC)) {
    bad(`${rel(PKG_SRC)} not found. Run: npm install ${PKG}`);
    process.exit(1);
  }
  const out = [];
  (function walk(dir) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (/\.(tsx?|jsx?)$/.test(e.name)) out.push(path.relative(PKG_SRC, p).split(path.sep).join("/"));
    }
  })(PKG_SRC);
  out.sort();
  for (const f of out) {
    const already = fs.existsSync(path.join(WS_SRC, f));
    console.log(`  ${already ? "[in src/]" : "         "} ${f}`);
  }
  console.log(`\n${out.length} file(s). Materialize one with:`);
  console.log(`  ALLOW_MATERIALIZE=1 node materialize.mjs <path-from-above>`);
  process.exit(0);
}

// ═══════════════════════════════════════════════════════════════════════════
// MODE 2 — materialize ONE file (guarded)
// ═══════════════════════════════════════════════════════════════════════════
function materializeOne(relPath) {
  console.log("=".repeat(74));
  console.log(`materialize.mjs  ·  ${PKG}/src/${relPath}`);
  console.log("=".repeat(74));

  if (process.env.ALLOW_MATERIALIZE !== "1") {
    bad("Refusing to write. This mode mutates src/.");
    console.error("      Re-run with:  ALLOW_MATERIALIZE=1 node materialize.mjs " + relPath);
    process.exit(1);
  }

  const from = path.join(PKG_SRC, relPath);
  const to = path.join(WS_SRC, relPath);

  if (!fs.existsSync(from)) {
    bad(`source not found: ${rel(from)}`);
    console.error("      Run `node materialize.mjs --list` to see valid paths.");
    process.exit(1);
  }
  // TRAP 1 discipline, reused: never clobber an existing workspace override.
  if (fs.existsSync(to)) {
    bad(`${rel(to)} already exists — refusing to overwrite a workspace file.`);
    console.error("      Delete or rename it first if you really want a fresh copy.");
    process.exit(1);
  }

  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.copyFileSync(from, to);
  const bytes = fs.statSync(to).size;
  ok(`copied → ${rel(to)}  (${bytes.toLocaleString()} bytes)`);

  // Manifest so a later turn (or unify.mjs) knows this file was lifted.
  let manifest = { pkg: PKG, files: [] };
  if (fs.existsSync(MANIFEST)) {
    try { manifest = JSON.parse(fs.readFileSync(MANIFEST, "utf8")); } catch { /* reset */ }
  }
  if (!manifest.files.includes(relPath)) manifest.files.push(relPath);
  manifest.updatedAt = new Date().toISOString();
  fs.writeFileSync(MANIFEST, JSON.stringify(manifest, null, 2) + "\n", "utf8");
  ok(`manifest updated → ${rel(MANIFEST)}`);

  // Reachability analysis: is this file reachable via the @ alias at all?
  const src = fs.readFileSync(from, "utf8");
  const importedRelatively = [];
  (function scan(dir) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) { scan(p); continue; }
      if (!/\.(tsx?|jsx?)$/.test(e.name)) continue;
      const body = fs.readFileSync(p, "utf8");
      const base = "./" + path.basename(relPath).replace(/\.(tsx?|jsx?)$/, "");
      if (body.includes(`"${base}"`) || body.includes(`'${base}'`)) {
        importedRelatively.push(path.relative(PKG_SRC, p).split(path.sep).join("/"));
      }
    }
  })(PKG_SRC);

  console.log("\n" + "-".repeat(74));
  console.log("ACTIVATION — read carefully");
  console.log("-".repeat(74));
  if (importedRelatively.length > 0) {
    console.log(`  This file is imported RELATIVELY by ${importedRelatively.length} package file(s):`);
    for (const f of importedRelatively.slice(0, 8)) console.log(`    · ${f}`);
    console.log("");
    console.log("  A relative specifier resolves INSIDE the package. Your edit to");
    console.log(`  ${rel(to)} will NOT be live until you add this alias:`);
    console.log("");
    const aliasKey = `${PKG}/src/${relPath.replace(/\.(tsx?|jsx?)$/, "")}`;
    console.log(`      // vite.config.ts → resolve.alias`);
    console.log(`      "${aliasKey}": path.resolve(__dirname, "src/${relPath}"),`);
    console.log("");
    console.log("  NOTE: even that alias only redirects callers who use the BARE");
    console.log(`  specifier "${aliasKey}". Package-internal relative callers`);
    console.log("  listed above will still load the package copy. For those, the only");
    console.log("  complete fix is a full flatten:  node force-materialize.mjs");
  } else {
    console.log("  No relative importers found — this file is likely alias-reachable.");
    console.log("  Your edit should take effect after the next build.");
  }
  console.log("");
  console.log("  Verify what actually changed:");
  console.log(`    diff -u ${rel(from)} ${rel(to)}`);
  console.log("=".repeat(74));
  process.exit(0);
}

// ─── dispatch ──────────────────────────────────────────────────────────────
const arg = process.argv[2];
if (!arg || arg === "--verify-sites") verifySites();
else if (arg === "--list") listCandidates();
else if (arg.startsWith("--")) {
  bad(`unknown flag ${arg}`);
  console.error("  usage: node materialize.mjs [--verify-sites | --list | <pkg-relative-path>]");
  process.exit(1);
} else materializeOne(arg.replace(/^\/+/, ""));
