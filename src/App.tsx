/**
 * SIDECAR MOUNT — DURABLE WORKSPACE SEAM (Type B). See flatten-guide.md.
 * --------------------------------------------------------------
 * The full VERITAS V15 / GBSE application lives in the `gpt56sme` NPM package
 * and is imported directly out of `node_modules`. Nothing is extracted.
 *
 * Because vite's `@` alias points at THIS workspace's `src/`, every
 * `@/components/...` and `@/lib/...` import inside the package resolves
 * through the shim files under `src/components/` and `src/lib/`. That is what
 * makes overrides durable: to change behaviour, edit the workspace shim.
 *
 * DO NOT edit files inside `node_modules/**` — they reset between turns.
 *
 * ADDITIVE OVERLAY (turn 2): <PipelineDebugConsole /> mounts as a portal-based
 * floating console. It observes only; it changes no pipeline behaviour.
 */
import PackagedApp from "./App.orig";
import { PipelineDebugConsole } from "@/components/PipelineDebugConsole";

export default function App() {
  return (
    <>
      <PackagedApp />
      <PipelineDebugConsole />
    </>
  );
}
