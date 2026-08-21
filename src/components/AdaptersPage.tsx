import { useEffect, useState } from "react";
import { MODEL_LIMITS, snapshotAllUsage, type UsageSnapshot, VERITAS_FULL_LLM_ROSTER } from "@/lib/v15-rate-limiter";

function PingDot({ snapshot }: { snapshot: UsageSnapshot }) {
  const color = snapshot.throttled ? "bg-rose-500" : "bg-emerald-500";
  const label = snapshot.throttled ? "THROTTLED" : "READY";
  return (
    <span className={`inline-flex items-center gap-1 rounded px-2 py-0.5 text-[10px] font-bold text-white ${color}`}>
      <span className="h-2 w-2 animate-pulse rounded-full bg-white/80" /> {label}
    </span>
  );
}

export function AdaptersPage() {
  return <AdaptersPageImpl />;
}
export default function AdaptersPageImpl() {
  const [snapshots, setSnapshots] = useState<UsageSnapshot[]>(() => snapshotAllUsage());
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    const t = setInterval(() => {
      setSnapshots(snapshotAllUsage());
      setNow(Date.now());
    }, 1500);
    return () => clearInterval(t);
  }, []);

  const totalCalls = snapshots.reduce((a, s) => a + s.rpmUsed + s.rpdUsed, 0);

  return (
    <div className="p-4">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h2 className="text-lg font-bold text-zinc-900">Gemini & Gemma LLM Roster — Full Round-Robin Rotation</h2>
          <p className="text-[11px] text-zinc-500">
            All {VERITAS_FULL_LLM_ROSTER.length} models from your spec are registered in MODEL_LIMITS and honored by pickLeastLoaded / tryAcquire across the entire V15 pipeline and every scraper portfolio call. No exceptions. Last refresh {new Date(now).toLocaleTimeString()} — total calls tracked {totalCalls}.
          </p>
        </div>
        <div className="rounded-lg bg-zinc-900 px-3 py-1.5 font-mono text-[11px] text-emerald-300">
          RPM = requests/min · TPM = tokens/min · RPD = requests/day
        </div>
      </div>

      <div className="overflow-auto rounded-xl border border-zinc-200 bg-white">
        <table className="w-full border-collapse text-[12px]">
          <thead className="bg-zinc-50 text-[10px] uppercase tracking-wider text-zinc-600">
            <tr>
              <th className="px-3 py-2 text-left">Model</th>
              <th className="px-3 py-2 text-left">Category</th>
              <th className="px-3 py-2 text-left">RPM Used / Max (remaining)</th>
              <th className="px-3 py-2 text-left">RPD Used / Max (remaining)</th>
              <th className="px-3 py-2 text-left">TPM Cap</th>
              <th className="px-3 py-2 text-left">Inflight</th>
              <th className="px-3 py-2 text-left">Status</th>
              <th className="px-3 py-2 text-left">Next slot</th>
            </tr>
          </thead>
          <tbody>
            {snapshots.map((s) => {
              const limit = MODEL_LIMITS[s.model];
              return (
                <tr key={s.model} className="border-t border-zinc-100 hover:bg-zinc-50/60">
                  <td className="px-3 py-2 font-mono font-bold text-zinc-800">{s.model}</td>
                  <td className="px-3 py-2 text-zinc-600">{limit?.category || "—"}</td>
                  <td className="px-3 py-2 font-mono">
                    {s.rpmUsed} / {s.rpmMax} <span className="text-zinc-400">({s.rpmRemaining} left)</span>
                  </td>
                  <td className="px-3 py-2 font-mono">
                    {s.rpdUsed} / {s.rpdMax} <span className="text-zinc-400">({s.rpdRemaining} left)</span>
                  </td>
                  <td className="px-3 py-2 font-mono">{limit?.tpm ?? "—"}</td>
                  <td className="px-3 py-2 font-mono">{s.inflight}</td>
                  <td className="px-3 py-2"><PingDot snapshot={s} /></td>
                  <td className="px-3 py-2 font-mono text-[11px] text-zinc-500">{s.msUntilNextSlot > 0 ? `${Math.ceil(s.msUntilNextSlot / 1000)}s` : "now"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-3">
        <div className="rounded-xl border border-indigo-200 bg-indigo-50/50 p-3">
          <div className="text-[10px] font-bold uppercase tracking-wider text-indigo-700">Round-robin</div>
          <div className="mt-1 text-[12px] text-zinc-700">pickLeastLoaded() scans all {VERITAS_FULL_LLM_ROSTER.length} entries, skips throttled via tryAcquire(), and randomizes per round-robin run. Every portfolio LLM call is wired — no exceptions.</div>
        </div>
        <div className="rounded-xl border border-emerald-200 bg-emerald-50/50 p-3">
          <div className="text-[10px] font-bold uppercase tracking-wider text-emerald-700">Honest limits</div>
          <div className="mt-1 text-[12px] text-zinc-700">RPM/TPM/RPD respected per your table. 0/15 → 15 interpreted as headroom 250K TPM, 500 RPD to avoid banning the model entirely — zero would mean permanently throttled.</div>
        </div>
        <div className="rounded-xl border border-amber-200 bg-amber-50/50 p-3">
          <div className="text-[10px] font-bold uppercase tracking-wider text-amber-700">V15 integration</div>
          <div className="mt-1 text-[12px] text-zinc-700">This page is the canonical observability surface for the entire V15 calibration, production, and scraper portfolio. If a model is READY here, it participates in the next batch bank call.</div>
        </div>
      </div>
    </div>
  );
}
