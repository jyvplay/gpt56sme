import { useState, useEffect } from "react";
import { V15Toggle } from "@/components/V15Toggle";
import { V15CalibrationDialog } from "@/components/V15CalibrationDialog";
import { V15CalibrationAugment } from "@/components/V15CalibrationAugment";
import { getTitaniumEgressEnabled, setTitaniumEgressEnabled } from "@/lib/v15-grounding";

export function V15Overlay() {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [minimized, setMinimized] = useState(true);
  const [titaniumEnabled, setTitaniumEnabledState] = useState(() => getTitaniumEgressEnabled());
  const [searxngUrl, setSearxngUrl] = useState(() =>
    typeof localStorage !== "undefined"
      ? localStorage.getItem("veritas.v15.searxngUrl") || "http://localhost:8080"
      : "http://localhost:8080"
  );

  useEffect(() => {
    const onStorage = () => setTitaniumEnabledState(getTitaniumEgressEnabled());
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  const save = () => {
    if (typeof localStorage !== "undefined") {
      localStorage.setItem("veritas.v15.searxngUrl", searxngUrl.trim() || "http://localhost:8080");
    }
  };

  const toggleTitanium = () => {
    const next = !titaniumEnabled;
    setTitaniumEgressEnabled(next);
    setTitaniumEnabledState(next);
  };

  return (
    <>
      <div
        className="fixed left-2 top-1/2 z-[9998] flex -translate-y-1/2 flex-col items-start gap-2"
        style={{ pointerEvents: "none" }}
      >
        <div
          className="rounded-2xl border border-zinc-200 bg-white/95 px-3 py-2 shadow-xl backdrop-blur"
          style={{ pointerEvents: "auto" }}
        >
          {minimized ? (
            <button
              onClick={() => setMinimized(false)}
              className="flex items-center gap-1.5 text-[11px] font-bold text-indigo-700 hover:text-indigo-900"
              title="Expand V15 controls"
            >
              <span className="grid h-5 w-5 place-items-center rounded-md bg-indigo-600 text-[10px] font-bold text-white">
                V15
              </span>
              <span>▲</span>
            </button>
          ) : (
            <>
              <div className="flex flex-wrap items-center gap-2">
                <div className="grid h-6 w-6 place-items-center rounded-md bg-gradient-to-br from-indigo-600 to-emerald-500 text-[10px] font-bold text-white">
                  V15
                </div>
                <V15Toggle />
                <button
                  onClick={() => setDialogOpen(true)}
                  className="rounded-lg border border-indigo-300 bg-indigo-50 px-2 py-1 text-[11px] font-bold text-indigo-800 hover:bg-indigo-100"
                >
                  📊 Calibrate
                </button>
                <button
                  onClick={() => setDialogOpen(true)}
                  className="rounded-lg border border-emerald-300 bg-emerald-50 px-2 py-1 text-[11px] font-bold text-emerald-800 hover:bg-emerald-100"
                >
                  📖 Guide
                </button>
                <button
                  onClick={toggleTitanium}
                  className={`rounded-lg border px-2 py-1 text-[11px] font-bold transition-colors ${
                    titaniumEnabled
                      ? "border-amber-400 bg-amber-100 text-amber-900 shadow-sm"
                      : "border-zinc-300 bg-zinc-50 text-zinc-600 hover:bg-zinc-100"
                  }`}
                  title="Toggle Vanguard-Titanium Virtual Egress (Google Translate & AMP routes)"
                >
                  ⚡ Titanium: {titaniumEnabled ? "ON" : "OFF"}
                </button>
                <button
                  onClick={() => setMinimized(true)}
                  className="rounded-lg border border-zinc-200 px-1.5 py-1 text-[10px] text-zinc-500 hover:bg-zinc-100"
                >
                  ▼
                </button>
              </div>
              <div className="mt-2 flex items-center gap-1.5 border-t border-zinc-100 pt-1.5">
                <span className="text-[10px] font-bold text-zinc-600">🔍 SearXNG:</span>
                <input
                  value={searxngUrl}
                  onChange={(e) => setSearxngUrl(e.target.value)}
                  onBlur={save}
                  className="w-36 rounded border border-zinc-300 px-1 py-0.5 font-mono text-[10px]"
                  placeholder="http://localhost:8080"
                />
                <button onClick={save} className="rounded bg-zinc-100 px-1.5 text-[10px] font-bold text-zinc-700">
                  Save
                </button>
                <button onClick={() => setDialogOpen(true)} className="text-[10px] text-blue-600 underline">
                  setup help
                </button>
              </div>
              <div className="mt-1 text-[9px] leading-tight text-zinc-400">
                Additive · original app unchanged when OFF · ⚡ Titanium overrides AMP/Translate routes
              </div>
            </>
          )}
        </div>
      </div>
      <V15CalibrationDialog open={dialogOpen} onClose={() => setDialogOpen(false)} />
      <V15CalibrationAugment />
    </>
  );
}
