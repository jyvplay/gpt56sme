#!/usr/bin/env node
/**
 * diagnostics.mjs — strict post-unification audit
 * ---------------------------------------------------------------------------
 * Run AFTER unify.mjs and BEFORE npm run build.
 * Exit 0 = flat and clean. Exit 1 = ghosts remain; DO NOT publish.
 */
import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const HISTORICAL_PKGS = ["gpt56lxh", "g31ppv2", "unkbv10", "gpt56sme"];
const SRC = path.resolve(process.cwd(), "src");
const EXT = new Set([".ts", ".tsx", ".js", ".jsx", ".css", ".json", ".md"]);
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const pkgRegexStr = `(?:${HISTORICAL_PKGS.map(esc).join("|")})`;

function walk(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (EXT.has(path.extname(e.name))) out.push(p);
  }
  return out;
}
const rel = (p) => path.relative(process.cwd(), p).split(path.sep).join("/");

const findings = [];

// ── CHECK 1: ghost package references anywhere in src/ ─────────────────────
const ghostRe = new RegExp(`${pkgRegexStr}/`, "g");
for (const file of walk(SRC)) {
  const lines = fs.readFileSync(file, "utf8").split("\n");
  lines.forEach((line, i) => {
    ghostRe.lastIndex = 0; // explicit reset: /g is stateful
    if (ghostRe.test(line)) {
      findings.push({
        sev: "FATAL",
        file: rel(file),
        line: i + 1,
        msg: `ghost import: ${line.trim().slice(0, 100)}`,
      });
    }
  });
}

// ── CHECK 2: self-importing shims (undissolved Type A) ─────────────────────
for (const file of walk(SRC)) {
  if (!/\.(tsx?|jsx?)$/.test(file)) continue;
  const base = path.basename(file, path.extname(file));
  const src = fs.readFileSync(file, "utf8");
  
  const cleanSrc = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '').trim();
  if (cleanSrc.length === 0) continue;
  
  const statements = cleanSrc.split(/(?:;|\n)+/).map(s => s.trim()).filter(s => s.length > 0);
  let isPureSelfShim = true;
  
  for (const stmt of statements) {
    const match = stmt.match(/^export\s+(?:[*]|{[^}]+}|default)\s+from\s+["']\.\/([^"']+)["']$/);
    if (!match || match[1] !== base) { 
      isPureSelfShim = false; 
      break; 
    }
  }
  
  if (isPureSelfShim) {
    findings.push({ sev: "FATAL", file: rel(file), line: 0, msg: "self-import cycle (pure shim not dissolved)" });
  }
}

// ── CHECK 3: broken .orig targets ──────────────────────────────────────────
for (const file of walk(SRC)) {
  if (!/\.(tsx?|jsx?)$/.test(file)) continue;
  const src = fs.readFileSync(file, "utf8");
  for (const m of src.matchAll(/from\s+["'](\.[^"']*\.orig)["']/g)) {
    const dir = path.dirname(file);
    const hit = [".ts", ".tsx", ".js", ".jsx"].some((e) => fs.existsSync(path.join(dir, m[1] + e)));
    if (!hit) findings.push({ sev: "FATAL", file: rel(file), line: 0, msg: `missing base: ${m[1]}` });
  }
}

// ── CHECK 4: package.json must not depend on any historical package ────────
const pkgJsonPath = path.resolve(process.cwd(), "package.json");
if (fs.existsSync(pkgJsonPath)) {
  const pj = JSON.parse(fs.readFileSync(pkgJsonPath, "utf8"));
  for (const dep of Object.keys({ ...pj.dependencies, ...pj.devDependencies })) {
    if (HISTORICAL_PKGS.includes(dep)) {
      findings.push({ sev: "FATAL", file: "package.json", line: 0, msg: `dependency "${dep}" still present` });
    }
  }
}

// ── CHECK 5: Tailwind @source pointing into node_modules ───────────────────
const cssPath = path.join(SRC, "index.css");
if (fs.existsSync(cssPath)) {
  const css = fs.readFileSync(cssPath, "utf8");
  const m = css.match(/@source\s+["']([^"']+)["']/);
  if (m && /node_modules/.test(m[1])) {
    findings.push({ sev: "FATAL", file: "src/index.css", line: 0, msg: `@source still targets node_modules: ${m[1]}` });
  }
}

// ── CHECK 6: Mangled "src/..." imports (Rollup Resolution Failure) ─────────
for (const file of walk(SRC)) {
  const src = fs.readFileSync(file, "utf8");
  if (/(?:from|import)\s+["']src\//.test(src)) {
    findings.push({ sev: "FATAL", file: rel(file), line: 0, msg: `mangled import pointing to "src/..." instead of "@/"` });
  }
}

// ── CHECK 7: Malformed Windows relative imports ────────────────────────────
for (const file of walk(SRC)) {
  const src = fs.readFileSync(file, "utf8");
  if (/(?:from|import)\s+["']\.\.[a-zA-Z0-9]/.test(src) || /(?:from|import)\s+["']\.[a-zA-Z0-9]/.test(src)) {
    findings.push({ sev: "FATAL", file: rel(file), line: 0, msg: `mangled relative import missing slash (Windows path issue)` });
  }
}

// ── REPORT ─────────────────────────────────────────────────────────────────
console.log("=".repeat(72));
console.log("diagnostics.mjs — strict post-unification audit");
console.log("=".repeat(72));
if (findings.length === 0) {
  console.log("\u2713 CLEAN — zero ghost imports, zero cycles, zero broken bases.");
  console.log("\u2713 Safe to run: npm run build");
  process.exit(0);
}
for (const f of findings) console.error(`\u2717 [${f.sev}] ${f.file}:${f.line} — ${f.msg}`);
console.error(`\nFAILED: ${findings.length} finding(s). DO NOT BUILD OR PUBLISH.`);
process.exit(1);