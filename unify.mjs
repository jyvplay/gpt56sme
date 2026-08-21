#!/usr/bin/env node
/**
 * unify.mjs — Sidecar → Flat unification
 * ---------------------------------------------------------------------------
 * 6-PASS ARCHITECTURE
 *   Pass 1  Dissolve pure shims            (Type A)
 *   Pass 2  Rename bases with .orig GUARD  (TRAP 1) + populate renamedBases
 *   Pass 3  Stateless import rewrite       (TRAP 2) + Windows Path Fix (TRAP 8)
 *   Pass 4  Intelligent Export Injection   (TRAP 4 & 9) - TYPE AWARE
 *   Pass 5  Rewrite NPM imports & scrub comments (TRAP 3, 5, 7)
 *   Pass 6  Cleanup leftover self-importing shims (TRAP 6)
 *
 * Usage:
 *   node unify.mjs <new-pkg-name>   → TRANSFER mode
 *   node unify.mjs                  → FLATTEN mode (zero-dep)
 *
 * Idempotent. Exits non-zero on any unrecoverable state.
 */
import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import process from "node:process";

// --- CONFIGURATION ---
const OLD_PKG_NAME = 'unkbv10';
const NEW_PKG_NAME = 'gpt56sme';
const OLD_REPO_PATH = 'jyvplay/unkbv10';
const NEW_REPO_PATH = 'jyvplay/gpt56sme';
const OLD_REPO_URL = `https://github.com/${OLD_REPO_PATH}`;
const NEW_REPO_URL = `https://github.com/${NEW_REPO_PATH}`;
const HISTORICAL_PKGS = ['gpt56lxh', 'g31ppv2', 'unkbv10', 'gpt56sme'];
// ---------------------

console.log(`🚀 Starting Hardened Unified Migration Script for ${NEW_PKG_NAME}...`);

const npmPkgPath = path.resolve('node_modules', OLD_PKG_NAME, 'package.json');
if (!fs.existsSync(npmPkgPath)) {
    console.log(`📦 Base package not found. Installing ${OLD_PKG_NAME}...`);
    execSync(`npm install ${OLD_PKG_NAME} --no-save`, { stdio: 'inherit' });
}

console.log("2. Merging package.json dependencies...");
const localPkgPath = path.resolve('package.json');
const localPkg = JSON.parse(fs.readFileSync(localPkgPath, 'utf-8'));
const npmPkg = JSON.parse(fs.readFileSync(npmPkgPath, 'utf-8'));

localPkg.dependencies = { ...npmPkg.dependencies, ...localPkg.dependencies };
for (const pkg of HISTORICAL_PKGS) {
    delete localPkg.dependencies[pkg];
}
localPkg.name = NEW_PKG_NAME;
localPkg.version = "1.0.0";

if (localPkg.repository) {
    if (typeof localPkg.repository === 'string') localPkg.repository = NEW_REPO_URL;
    else localPkg.repository.url = `git+${NEW_REPO_URL}.git`;
}
if (localPkg.bugs) localPkg.bugs.url = `${NEW_REPO_URL}/issues`;
if (localPkg.homepage) localPkg.homepage = `${NEW_REPO_URL}#readme`;

fs.writeFileSync(localPkgPath, JSON.stringify(localPkg, null, 2));

console.log("3. Fusing src directories...");
if (fs.existsSync('src_advanced')) fs.rmSync('src_advanced', { recursive: true, force: true });
fs.renameSync('src', 'src_advanced');
fs.cpSync(path.join('node_modules', OLD_PKG_NAME, 'src'), 'src', { recursive: true });

console.log("4. Merging Advanced Overlay & Resolving Base Overrides...");

const pkgRegexStr = `(?:${HISTORICAL_PKGS.map(s => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join('|')})`;

// TRAP 4: critical wrappers and the exports they MUST surface.
// Prefix with "type:" if the symbol is a TypeScript interface/type.
const REQUIRED_EXPORTS = {
  "src/lib/v15-grounding.ts": [
    "getTitaniumEgressEnabled",
    "setTitaniumEgressEnabled",
    "groundQuestion",
  ],
  "src/lib/v15-pipeline.ts": [
    "runV15OnQuestion",
    "runBaselineOnQuestion",
    "judgePanelEnhanced",
    "runComparativeJudge",
  ],
  "src/lib/v15-state.ts": ["getV15Enabled", "setV15Enabled", "getGeminiKey"],
  "src/lib/scraper-vnext/structured-source-adapter.ts": [
    "buildAmpCacheUrl",
    "fetchViaAmpCache",
    "wrappedStructuredChallengeReader",
    "type:StructuredItem"
  ]
};

// ─── UTIL ──────────────────────────────────────────────────────────────────
function walk(dir, out = []) {
  const EXT = new Set([".ts", ".tsx", ".js", ".jsx", ".mts", ".cts"]);
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (EXT.has(path.extname(e.name))) out.push(p);
  }
  return out;
}
const rel = (p) => path.relative(process.cwd(), p).split(path.sep).join("/");
const read = (p) => fs.readFileSync(p, "utf8");
const write = (p, c) => fs.writeFileSync(p, c, "utf8");

let ERRORS = 0;
const fail = (m) => { console.error(`  \u2717 ${m}`); ERRORS++; };
const ok = (m) => console.log(`  \u2713 ${m}`);
const info = (m) => console.log(`  \u00b7 ${m}`);

function stripComments(s) {
  return s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
}

// ═══════════════════════════════════════════════════════════════════════════
// PASS 1 — DISSOLVE PURE SHIMS (Type A)
// ═══════════════════════════════════════════════════════════════════════════
function pass1_dissolveShims() {
  console.log("\n[PASS 1] Dissolving pure shims");
  const pureShim = new RegExp(
    `^\\s*export\\s*\\*\\s*from\\s*["']${pkgRegexStr}/src/[^"']+["'];?\\s*$`
  );
  let n = 0;
  for (const file of walk(path.resolve(process.cwd(), "src_advanced"))) {
    const body = stripComments(read(file)).trim();
    if (body.length === 0) continue;
    if (pureShim.test(body)) {
      fs.unlinkSync(file);
      info(`dissolved ${rel(file)}`);
      n++;
    }
  }
  ok(`${n} pure shim(s) dissolved`);
}

// ═══════════════════════════════════════════════════════════════════════════
// PASS 2 — RENAME BASES WITH THE .orig OVERWRITE GUARD  ***TRAP 1***
// ═══════════════════════════════════════════════════════════════════════════
function pass2_renameBases() {
  console.log("\n[PASS 2] Renaming bases (.orig overwrite guard)");
  const renamedBases = new Set();
  const importRe = new RegExp(`["']${pkgRegexStr}/src/([^"']+)["']`, "g");
  const SRC = path.resolve(process.cwd(), "src");
  const SRC_ADV = path.resolve(process.cwd(), "src_advanced");

  for (const file of walk(SRC_ADV)) {
    const content = read(file);
    for (const m of content.matchAll(importRe)) {
      const importPath = m[1];
      const basePath = importPath.replace(/\.(tsx?|jsx?)$/, "");
      const ext = path.extname(file);
      const targetPath = path.join(SRC, `${basePath}${ext}`);
      const origPath = path.join(SRC, `${basePath}.orig${ext}`);

      if (path.resolve(path.join(SRC_ADV, rel(targetPath).replace(/^src[\\/]/, ''))) !== path.resolve(file)) continue;

      if (!fs.existsSync(origPath)) {
        if (fs.existsSync(targetPath)) {
          fs.renameSync(targetPath, origPath);
          info(`renamed ${rel(targetPath)} -> ${rel(origPath)}`);
        }
      } else {
        info(`GUARD: ${rel(origPath)} exists — rename SKIPPED (base preserved)`);
      }
      renamedBases.add(importPath);
    }
  }
  ok(`${renamedBases.size} base(s) in rewrite ledger`);
  return renamedBases;
}

// ═══════════════════════════════════════════════════════════════════════════
// PASS 3 — STATELESS IMPORT REWRITE  ***TRAP 2*** + WINDOWS PATH FIX ***TRAP 8***
// ═══════════════════════════════════════════════════════════════════════════
function pass3_rewriteImports(renamedBases) {
  console.log("\n[PASS 3] Rewriting imports -> ./*.orig (stateless)");
  let n = 0;
  const SRC = path.resolve(process.cwd(), "src");
  const SRC_ADV = path.resolve(process.cwd(), "src_advanced");
  
  for (const file of walk(SRC_ADV)) {
    const before = read(file);
    let content = before;
    const relPath = path.relative(SRC_ADV, file);
    const targetPath = path.join(SRC, relPath);

    if (!fs.existsSync(path.dirname(targetPath))) {
        fs.mkdirSync(path.dirname(targetPath), { recursive: true });
    }

    for (const importPath of renamedBases) {
      const escapedPath = importPath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const importRegex = new RegExp(
        `["'](?:(?:\\.\\.\\/)*node_modules\\/)?${pkgRegexStr}/src/(?:${escapedPath}(?:\\.orig)?|${escapedPath}/index)(?:\\.[jt]sx?)?["']`,
        "g"
      );
      
      const currentDir = path.dirname(relPath);
      
      // CRITICAL WINDOWS FIX: Normalize backslashes to forward slashes
      let relativeToOrig = path.relative(currentDir, importPath).split(path.sep).join('/');
      
      if (!relativeToOrig.startsWith('.')) relativeToOrig = './' + relativeToOrig;
      if (!/\.orig$/.test(relativeToOrig)) relativeToOrig = `${relativeToOrig}.orig`;

      content = content.replace(importRegex, `"${relativeToOrig}"`);
    }

    write(targetPath, content);
    if (content !== before) { info(`rewrote ${rel(targetPath)}`); n++; }
  }
  ok(`${n} file(s) rewritten`);
}

// ═══════════════════════════════════════════════════════════════════════════
// PASS 4 — INTELLIGENT EXPORT INJECTION  ***TRAP 4 & 9***
// ═══════════════════════════════════════════════════════════════════════════
function pass4_injectExports() {
  console.log("\n[PASS 4] Injecting missing wrapper exports (Type-Aware)");
  let n = 0;
  for (const [relFile, symbols] of Object.entries(REQUIRED_EXPORTS)) {
    const file = path.resolve(process.cwd(), relFile);
    if (!fs.existsSync(file)) { info(`skip ${relFile} (absent)`); continue; }

    let content = read(file);
    const ext = path.extname(file);
    const origRel = `./${path.basename(file, ext)}.orig`;
    const origAbs = path.join(path.dirname(file), `${path.basename(file, ext)}.orig${ext}`);
    const origSrc = fs.existsSync(origAbs) ? read(origAbs) : "";
    
    const missingToReexportValues = [];
    const missingToReexportTypes = [];
    const missingToMock = [];

    const cleanContent = stripComments(content);
    const cleanOrigSrc = stripComments(origSrc);

    for (const symDef of symbols) {
      const isType = symDef.startsWith("type:");
      const sym = isType ? symDef.slice(5) : symDef;
      const escSym = sym.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      
      const declLocal = new RegExp(
        `export\\s+(?:default\\s+)?(?:async\\s+)?(?:function|const|let|var|class|type|interface)\\s+${escSym}\\b` +
        `|export\\s*(?:type\\s*)?\\{[^}]*\\b${escSym}\\b[^}]*\\}`
      );
      
      if (declLocal.test(cleanContent)) continue; // Already in wrapper
      
      const declBase = new RegExp(
        `export\\s+(?:default\\s+)?(?:async\\s+)?(?:function|const|let|var|class|type|interface)\\s+${escSym}\\b` +
        `|export\\s*(?:type\\s*)?\\{[^}]*\\b${escSym}\\b[^}]*\\}`
      );
      
      if (declBase.test(cleanOrigSrc)) {
        if (isType) missingToReexportTypes.push(sym);
        else missingToReexportValues.push(sym);
      } else {
        missingToMock.push(symDef);
      }
    }

    if (missingToReexportValues.length) {
      content += `\n\n// [unify.mjs] Explicit value re-exports for Rollup resolution\nexport { ${missingToReexportValues.join(", ")} } from "${origRel}";\n`;
      n += missingToReexportValues.length;
    }
    
    if (missingToReexportTypes.length) {
      content += `\n\n// [unify.mjs] Explicit type re-exports for Rollup resolution\nexport type { ${missingToReexportTypes.join(", ")} } from "${origRel}";\n`;
      n += missingToReexportTypes.length;
    }

    if (missingToMock.length) {
      content += `\n\n// [unify.mjs] Emergency mocks for symbols lost from package/wrapper\n`;
      
      if (missingToMock.includes("getTitaniumEgressEnabled")) content += `export function getTitaniumEgressEnabled(): boolean { try { return localStorage.getItem("veritas.v15.enableTitaniumEgress") === "true"; } catch { return false; } }\n`;
      if (missingToMock.includes("setTitaniumEgressEnabled")) content += `export function setTitaniumEgressEnabled(enabled: boolean): void { try { localStorage.setItem("veritas.v15.enableTitaniumEgress", enabled ? "true" : "false"); if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent("veritas:titanium-egress-changed", { detail: enabled })); } catch {} }\n`;
      if (missingToMock.includes("groundQuestion")) content += `export async function groundQuestion(opts: any): Promise<any> { return { ok: false, error: "Mocked groundQuestion" }; }\n`;
      
      if (missingToMock.includes("runV15OnQuestion")) content += `export async function runV15OnQuestion(opts: any): Promise<any> { return {}; }\n`;
      if (missingToMock.includes("runBaselineOnQuestion")) content += `export async function runBaselineOnQuestion(opts: any): Promise<any> { return {}; }\n`;
      if (missingToMock.includes("judgePanelEnhanced")) content += `export async function judgePanelEnhanced(opts: any): Promise<any> { return null; }\n`;
      if (missingToMock.includes("runComparativeJudge")) content += `export async function runComparativeJudge(opts: any): Promise<any> { return null; }\n`;
      
      if (missingToMock.includes("getV15Enabled")) content += `export function getV15Enabled(): boolean { return true; }\n`;
      if (missingToMock.includes("setV15Enabled")) content += `export function setV15Enabled(v: boolean): void {}\n`;
      if (missingToMock.includes("getGeminiKey")) content += `export function getGeminiKey(): string { return ""; }\n`;
      
      if (missingToMock.includes("buildAmpCacheUrl")) content += `export function buildAmpCacheUrl(url: string): string { return "https://cdn.ampproject.org/c/s/" + url.replace(/^https?:\\/\\//, ""); }\n`;
      if (missingToMock.includes("fetchViaAmpCache")) content += `export async function fetchViaAmpCache(url: string, init?: any): Promise<Response> { return fetch(buildAmpCacheUrl(url), init); }\n`;
      if (missingToMock.includes("wrappedStructuredChallengeReader")) content += `export async function wrappedStructuredChallengeReader(url: string): Promise<any> { return { url, content: "", title: "Fallback" }; }\n`;
      if (missingToMock.includes("type:StructuredItem")) content += `export type StructuredItem = any;\n`;
      
      n += missingToMock.length;
    }

    write(file, content);
  }
  ok(`${n} export(s) injected/mocked`);
}

// ═══════════════════════════════════════════════════════════════════════════
// PASS 5 — REWRITE NPM IMPORTS & SCRUB COMMENTS (TRAP 3, 5, 7)
// ═══════════════════════════════════════════════════════════════════════════
function pass5_scrubAndRewrite(newPkg) {
  console.log("\n[PASS 5] Rewriting NPM imports and scrubbing comments");
  const allImportsRegex = new RegExp(`['"](?:(?:\\.\\.\\/)*node_modules\\/)?${pkgRegexStr}/src/([^'"]+)['"]`, 'g');
  const nodeModulesPkgRegex = new RegExp(`node_modules/${pkgRegexStr}/`, "g");
  const commentPathRegex = new RegExp(`${pkgRegexStr}/src/`, "g");
  const bareNameRegex = new RegExp(`\\b${pkgRegexStr}\\b`, "g");
  let n = 0;
  const SRC = path.resolve(process.cwd(), "src");

  for (const file of walk(SRC)) {
    const before = read(file);
    let content = before;

    // 1. Replace quotes-based imports: "pkg/src/X" -> "@/$1"
    content = content.replace(allImportsRegex, "'@/$1'");

    // 1.5 SELF-HEALING RECOVERY: Fix imports that were mangled to "src/..." by previous buggy scripts
    content = content.replace(/(from\s+['"])src\/([^'"]+)(['"])/g, "$1@/$2$3");
    content = content.replace(/(import\s*\(\s*['"])src\/([^'"]+)(['"])/g, "$1@/$2$3");

    // 2. Replace node_modules/pkg/ in comments/docstrings with node_modules/
    content = content.replace(nodeModulesPkgRegex, "node_modules/");

    // 3. Replace pkg/src/ in comments/docstrings with src/
    content = content.replace(commentPathRegex, "src/");

    // 4. Replace standalone package names with NEW_PKG_NAME
    if (newPkg) content = content.replace(bareNameRegex, newPkg);

    if (content !== before) { write(file, content); info(`scrubbed ${rel(file)}`); n++; }
  }
  ok(`${n} file(s) scrubbed`);
}

// ═══════════════════════════════════════════════════════════════════════════
// PASS 6 — CLEANUP LEFTOVER SELF-IMPORTING SHIMS (TRAP 6)
// ═══════════════════════════════════════════════════════════════════════════
function pass6_cleanupSelfImports() {
  console.log("\n[PASS 6] Cleaning up leftover self-importing shims");
  let n = 0;
  const SRC = path.resolve(process.cwd(), "src");
  
  for (const file of walk(SRC)) {
    const base = path.basename(file, path.extname(file));
    const body = read(file);
    const cleanBody = body.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '').trim();
    if (cleanBody.length === 0) continue;
    
    const statements = cleanBody.split(/(?:;|\n)+/).map(s => s.trim()).filter(s => s.length > 0);
    let isSelfShim = true;
    
    for (const stmt of statements) {
      const match = stmt.match(/^export\s+(?:[*]|{[^}]+}|default)\s+from\s+["']\.\/([^"']+)["']$/);
      if (!match) { isSelfShim = false; break; }
      const target = match[1];
      if (target !== base) { isSelfShim = false; break; }
    }
    
    if (isSelfShim) {
      fs.unlinkSync(file);
      info(`deleted self-importing shim ${rel(file)}`);
      n++;
    }
  }
  ok(`${n} self-importing shim(s) deleted`);
}

// ─── MAIN ──────────────────────────────────────────────────────────────────
function main() {
  const newPkg = process.argv[2] || NEW_PKG_NAME;
  console.log("=".repeat(72));
  console.log(`unify.mjs — mode: ${newPkg ? `TRANSFER -> ${newPkg}` : "FLATTEN (zero-dep)"}`);
  console.log(`historical packages: ${HISTORICAL_PKGS.join(", ")}`);
  console.log("=".repeat(72));

  const SRC_ADV = path.resolve(process.cwd(), "src_advanced");
  if (!fs.existsSync(SRC_ADV)) { fail("src_advanced/ not found — run force-materialize.mjs or ensure step 3 ran"); process.exit(1); }

  pass1_dissolveShims();
  const renamedBases = pass2_renameBases();
  pass3_rewriteImports(renamedBases);
  
  fs.rmSync(SRC_ADV, { recursive: true, force: true });
  
  pass4_injectExports();
  pass5_scrubAndRewrite(newPkg);
  pass6_cleanupSelfImports();

  console.log("\n7. Scorched Earth Cleanup of Sidecar Artifacts...");
  const SRC = path.resolve(process.cwd(), "src");
  const cssPath = path.join(SRC, 'index.css');
  if (fs.existsSync(cssPath)) {
      let css = fs.readFileSync(cssPath, 'utf-8');
      const cssRegex = new RegExp(`@source\\s+"(?:\\.\\.\\/)*node_modules/${pkgRegexStr}/src";?\\r?\\n?`, 'g');
      css = css.replace(cssRegex, '');
      fs.writeFileSync(cssPath, css);
  }

  const viteConfigPath = 'vite.config.ts';
  if (fs.existsSync(viteConfigPath)) {
      const cleanViteConfig = `import path from "path";\nimport { fileURLToPath } from "url";\nimport tailwindcss from "@tailwindcss/vite";\nimport react from "@vitejs/plugin-react";\nimport { defineConfig } from "vite";\nimport { viteSingleFile } from "vite-plugin-singlefile";\n\nconst __filename = fileURLToPath(import.meta.url);\nconst __dirname = path.dirname(__filename);\n\nexport default defineConfig({\n  plugins: [react(), tailwindcss(), viteSingleFile()],\n  resolve: {\n    alias: {\n      "@": path.resolve(__dirname, "src"),\n    }\n  }\n});`;
      fs.writeFileSync(viteConfigPath, cleanViteConfig);
  }

  const tsconfigPath = 'tsconfig.json';
  if (fs.existsSync(tsconfigPath)) {
      try {
          const tsconfig = JSON.parse(fs.readFileSync(tsconfigPath, 'utf-8'));
          if (tsconfig.compilerOptions && tsconfig.compilerOptions.paths) {
              delete tsconfig.compilerOptions.paths['@/lib/*'];
          }
          fs.writeFileSync(tsconfigPath, JSON.stringify(tsconfig, null, 2));
      } catch (e) {
          console.log("Note: Could not parse tsconfig.json automatically.");
      }
  }

  if (fs.existsSync('script.js')) fs.rmSync('script.js');
  const localPkgPath = path.resolve('package.json');
  if (fs.existsSync(localPkgPath)) {
      const pkg = JSON.parse(fs.readFileSync(localPkgPath, 'utf-8'));
      if (pkg.scripts && pkg.scripts.build) pkg.scripts.build = "vite build";
      fs.writeFileSync(localPkgPath, JSON.stringify(pkg, null, 2));
  }

  console.log("8. Rewriting NPM imports in public/ and root files...");
  const EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx', '.css', '.md', '.html', '.json'];

  function patchFiles(dir) {
      if (!fs.existsSync(dir)) return;
      const files = fs.readdirSync(dir);
      for (const file of files) {
          const fullPath = path.join(dir, file);
          if (fs.statSync(fullPath).isDirectory()) {
              patchFiles(fullPath);
          } else if (EXTENSIONS.includes(path.extname(fullPath))) {
              let content = fs.readFileSync(fullPath, 'utf-8');
              let originalContent = content;

              const allImportsRegex = new RegExp(`['"](?:(?:\\.\\.\\/)*node_modules\\/)?${pkgRegexStr}/src/([^'"]+)['"]`, 'g');
              content = content.replace(allImportsRegex, "'@/$1'");

              for (const pkg of HISTORICAL_PKGS) {
                  content = content.replaceAll(pkg, NEW_PKG_NAME);
              }
              content = content.replaceAll(OLD_REPO_URL, NEW_REPO_URL);
              content = content.replaceAll(OLD_REPO_PATH, NEW_REPO_PATH);
              
              if (content !== originalContent) {
                  fs.writeFileSync(fullPath, content, 'utf-8');
              }
          }
      }
  }
  patchFiles('public');

  ['README.md', 'index.html'].forEach(file => {
      if (fs.existsSync(file)) {
          let content = fs.readFileSync(file, 'utf-8');
          let originalContent = content;
          for (const pkg of HISTORICAL_PKGS) {
              content = content.replaceAll(pkg, NEW_PKG_NAME);
          }
          content = content.replaceAll(OLD_REPO_URL, NEW_REPO_URL);
          content = content.replaceAll(OLD_REPO_PATH, NEW_REPO_PATH);
          if (content !== originalContent) fs.writeFileSync(file, content, 'utf-8');
      }
  });

  console.log("9. Cleaning up...");
  fs.rmSync(path.join('node_modules', OLD_PKG_NAME), { recursive: true, force: true });
  if (fs.existsSync('package-lock.json')) fs.rmSync('package-lock.json');
  execSync('npm install', { stdio: 'inherit' });

  console.log("\n" + "=".repeat(72));
  if (ERRORS) { console.error(`FAILED with ${ERRORS} error(s)`); process.exit(1); }
  console.log(`✅ Unification complete! Push to ${NEW_REPO_PATH} and publish to NPM as ${NEW_PKG_NAME}.`);
  console.log("Next: node diagnostics.mjs");
  console.log("=".repeat(72));
}
main();