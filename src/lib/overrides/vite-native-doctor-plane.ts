/**
 * vite-native-doctor-plane.ts — L4: Aggregated Health & Remediation
 * Dynamically imports all planes to avoid circular dependencies.
 * Zero-dependency: node:* only.
 */
async function optionalImport(specifier: string): Promise<{ ok: boolean; mod?: any; error?: string }> {
  try {
    const mod = await import(specifier);
    return { ok: true, mod };
  } catch (e: any) {
    return { ok: false, error: e?.message ?? 'Import failed' };
  }
}

export type HealthStatus = 'green' | 'yellow' | 'red';

export interface DoctorSection {
  available: boolean;
  error?: string;
  data?: Record<string, unknown>;
}

export interface DoctorReport {
  status: HealthStatus;
  ts: number;
  pressure: string;
  criticalFailed: number;
  highFailed: number;
  indexConsistent: boolean;
  recommendations: string[];
  sections: {
    runtime: DoctorSection;
    policy: DoctorSection;
    knowledge: DoctorSection;
    contract: DoctorSection;
    snapshot: DoctorSection;
    selftest?: DoctorSection;
  };
}

function pickStatus(opts: {
  criticalFailed: number;
  pressure: string;
  indexConsistent: boolean;
  highFailed: number;
}): HealthStatus {
  if (opts.criticalFailed > 0 || opts.pressure === 'hot') return 'red';
  if (!opts.indexConsistent || opts.highFailed > 0 || opts.pressure === 'warm') return 'yellow';
  return 'green';
}

export async function buildDoctorReport(opts: { deep?: boolean } = {}): Promise<DoctorReport> {
  const ts = Date.now();
  const recommendations: string[] = [];
  let criticalFailed = 0;
  let highFailed = 0;
  let pressure = 'ok';
  let indexConsistent = true;

  // ── Runtime section ────────────────────────────────────────────────────
  // Hand-trace: if getRuntimeStats() throws an Error:
  //   sections.runtime = { available: true, error: 'Error message string', data: {} }
  //   criticalFailed is NOT incremented (runtime errors are not critical failures)
  const runtimeSection: DoctorSection = { available: true };
  const runtimeImport = await optionalImport('./vite-native-runtime-plane.js');
  if (!runtimeImport.ok) {
    runtimeSection.available = true;
    runtimeSection.error = runtimeImport.error;
    criticalFailed++;
  } else {
    try {
      const stats = runtimeImport.mod.getRuntimeStats();
      pressure = stats.pressure;
      runtimeSection.data = stats;
    } catch (e: any) {
      runtimeSection.error = e?.message ?? 'getRuntimeStats failed';
      runtimeSection.data = {};
    }
  }

  // ── Policy section ─────────────────────────────────────────────────────
  const policySection: DoctorSection = { available: true };
  const policyImport = await optionalImport('./vite-native-policy-plane.js');
  if (!policyImport.ok) {
    policySection.available = true;
    policySection.error = policyImport.error;
    criticalFailed++;
  } else {
    try {
      const policy = policyImport.mod.evaluatePolicy({ pressure });
      policySection.data = policy;
    } catch (e: any) {
      policySection.error = e?.message ?? 'evaluatePolicy failed';
      highFailed++;
    }
  }

  // ── Knowledge section ──────────────────────────────────────────────────
  const knowledgeSection: DoctorSection = { available: true };
  const knowledgeImport = await optionalImport('./vite-native-knowledge-store.js');
  if (!knowledgeImport.ok) {
    knowledgeSection.available = true;
    knowledgeSection.error = knowledgeImport.error;
    criticalFailed++;
  } else {
    try {
      const stats = knowledgeImport.mod.getKnowledgeStats();
      knowledgeSection.data = stats;
      // Check FTS index consistency
      if (stats.totalRecords > 0 && !stats.available) {
        indexConsistent = false;
        recommendations.push('Run /api/native-knowledge/repair-index to heal FTS drift.');
      }
    } catch (e: any) {
      knowledgeSection.error = e?.message ?? 'getKnowledgeStats failed';
      highFailed++;
    }
  }

  // ── Contract section ───────────────────────────────────────────────────
  const contractSection: DoctorSection = { available: true };
  const contractImport = await optionalImport('./vite-native-contract-plane.js');
  if (!contractImport.ok) {
    contractSection.available = true;
    contractSection.error = contractImport.error;
    highFailed++;
  } else {
    try {
      const result = contractImport.mod.contractSelfTest();
      contractSection.data = result;
      if (!result.passed) highFailed++;
    } catch (e: any) {
      contractSection.error = e?.message ?? 'contractSelfTest failed';
      highFailed++;
    }
  }

  // ── Snapshot section ───────────────────────────────────────────────────
  const snapshotSection: DoctorSection = { available: true };
  const snapshotImport = await optionalImport('./vite-native-snapshot-plane.js');
  if (!snapshotImport.ok) {
    snapshotSection.available = true;
    snapshotSection.error = snapshotImport.error;
  } else {
    try {
      const manifest = await snapshotImport.mod.getSnapshotManifest();
      snapshotSection.data = manifest;
      // Maintenance recommendation: >32MB reclaimable space
      if (manifest.sizeBytes > 32 * 1024 * 1024) {
        recommendations.push('Run /api/native-maintenance/run to reclaim SQLite space.');
      }
    } catch (e: any) {
      snapshotSection.error = e?.message ?? 'getSnapshotManifest failed';
    }
  }

  // ── Optional deep self-test ────────────────────────────────────────────
  let selftestSection: DoctorSection | undefined;
  if (opts.deep) {
    selftestSection = { available: true };
    const stImport = await optionalImport('./vite-native-selftest.js');
    if (!stImport.ok) {
      selftestSection.available = true;
      selftestSection.error = stImport.error;
      criticalFailed++;
    } else {
      try {
        const result = stImport.mod.runStaticSelfTest();
        selftestSection.data = result;
        if (!result.passed) {
          highFailed += result.failures?.length ?? 1;
          // Trigger policy remediation for known failures
          if (policyImport.ok) {
            policyImport.mod.applySelfTestRemediation(result);
          }
        }
      } catch (e: any) {
        selftestSection.error = e?.message ?? 'Static self-test failed';
        criticalFailed++;
      }
    }
  }

  // Add index inconsistency recommendation
  if (!indexConsistent) {
    recommendations.push('Run /api/native-knowledge/repair-index to heal FTS drift.');
  }

  const status = pickStatus({ criticalFailed, pressure, indexConsistent, highFailed });

  return {
    status,
    ts,
    pressure,
    criticalFailed,
    highFailed,
    indexConsistent,
    recommendations: [...new Set(recommendations)],
    sections: {
      runtime: runtimeSection,
      policy: policySection,
      knowledge: knowledgeSection,
      contract: contractSection,
      snapshot: snapshotSection,
      ...(selftestSection && { selftest: selftestSection }),
    },
  };
}
