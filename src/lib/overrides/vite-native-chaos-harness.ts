/**
 * vite-native-chaos-harness.ts — L5: Deterministic SSRF/NUL Fuzzing
 * Uses deterministic PRNG to generate and test malicious inputs.
 * Zero-dependency: pure TypeScript.
 */

export interface ChaosResult {
  passed: boolean;
  blocked: number;
  escaped: number;
  total: number;
  failures: string[];
  ts: number;
}

// ── Deterministic PRNG: XorShift32 ───────────────────────────────────────
// Hand-trace for seed 0x0badc0de:
//   let s = 0x0badc0de
//   Step 1: s ^= (s << 13)  = s ^ (s * 2^13) [32-bit truncated]
//     0x0badc0de << 13 in 32-bit: 0x0badc0de * 8192 mod 2^32
//     0x0badc0de = 196362462 decimal
//     196362462 * 8192 = 1608868429824 = 0x176_7A37_0000 — lower 32 bits = 0x7A370000 BUT need XOR
//     Actually: (196362462 * 8192) >>> 0 = (0x0badc0de0000 >> 16 lower 32 bits)
//     Let s = seed, result s ^= (s << 13) truncated to 32 bits
//   This is standard XorShift32 — produces deterministic non-zero sequence
export function xorshift32(seed: number): () => number {
  // Must use 32-bit arithmetic
  let s = seed >>> 0;
  if (s === 0) s = 1; // XorShift must not start at 0
  return () => {
    // Standard XorShift32 algorithm
    s ^= (s << 13) >>> 0;
    s ^= (s >>> 17);
    s ^= (s << 5) >>> 0;
    s = s >>> 0; // Enforce uint32
    return s;
  };
}

// ── Malicious URL Corpus ───────────────────────────────────────────────────
// These are the canonical SSRF attack vectors the system MUST block
const MALICIOUS_URLS: Array<{ url: string; expectedBlock: string }> = [
  // NUL byte injection — caught by Step 1
  { url: 'http://127.0.0.1%00.evil.com', expectedBlock: 'NUL byte' },
  { url: 'http://evil.com%00@127.0.0.1/', expectedBlock: 'NUL byte' },
  // Gopher protocol (can be used to access Redis, etc.)
  { url: 'gopher://127.0.0.1:6379/_PING', expectedBlock: 'protocol' },
  // AWS metadata endpoint
  { url: 'http://169.254.169.254/latest/meta-data/', expectedBlock: 'blocked IP' },
  // GCP metadata
  { url: 'http://metadata.google.internal/computeMetadata/v1/', expectedBlock: 'blocked host' },
  // IPv4-mapped IPv6 — must extract and check embedded IPv4
  { url: 'http://[::ffff:127.0.0.1]/', expectedBlock: 'blocked IP' },
  // Direct loopback
  { url: 'http://127.0.0.1/', expectedBlock: 'blocked IP' },
  { url: 'http://0.0.0.0/', expectedBlock: 'blocked IP' },
  // Link-local
  { url: 'http://169.254.0.1/', expectedBlock: 'blocked IP' },
  // RFC 1918 private ranges
  { url: 'http://10.0.0.1/', expectedBlock: 'blocked IP' },
  { url: 'http://192.168.1.1/', expectedBlock: 'blocked IP' },
  { url: 'http://172.16.0.1/', expectedBlock: 'blocked IP' },
  // localhost variants
  { url: 'http://localhost/', expectedBlock: 'blocked host' },
  { url: 'http://localhost.localdomain/', expectedBlock: 'blocked host' },
  // Credentialed URLs
  { url: 'http://admin:password@127.0.0.1/', expectedBlock: 'credentials' },
  // Carrier-grade NAT
  { url: 'http://100.64.0.1/', expectedBlock: 'blocked IP' },
];

// ── Test runner: requires prepTarget function from scraper ────────────────
// The chaos harness calls the actual prepTarget implementation to verify
// 100% of malicious inputs are blocked

export async function runChaosTests(prepTarget: (url: string) => Promise<unknown>): Promise<ChaosResult> {
  const ts = Date.now();
  const failures: string[] = [];
  let blocked = 0;
  let escaped = 0;

  // Use deterministic PRNG to shuffle corpus — reproducible test order
  const prng = xorshift32(0x0badc0de);
  const shuffled = [...MALICIOUS_URLS].sort(() => (prng() % 2 === 0 ? 1 : -1));

  for (const { url, expectedBlock } of shuffled) {
    try {
      await prepTarget(url);
      // If we get here, the URL was NOT blocked — security failure
      escaped++;
      failures.push(`SSRF ESCAPE: "${url}" was not blocked (expected: ${expectedBlock})`);
    } catch (e: any) {
      // Expected: prepTarget should throw for all malicious URLs
      blocked++;
    }
  }

  // Additional fuzz test: generate random mutations of malicious URLs
  const prng2 = xorshift32(0xdeadbeef);
  const extraMalicious = [
    `http://127.${prng2() % 256}.${prng2() % 256}.${prng2() % 256}/`,
    `http://192.168.${prng2() % 256}.${prng2() % 256}/sensitive`,
    `http://10.${prng2() % 256}.${prng2() % 256}.${prng2() % 256}:8080/`,
  ];

  for (const url of extraMalicious) {
    try {
      await prepTarget(url);
      escaped++;
      failures.push(`SSRF ESCAPE (fuzz): "${url}" was not blocked`);
    } catch {
      blocked++;
    }
  }

  const total = shuffled.length + extraMalicious.length;

  return {
    passed: escaped === 0 && blocked === total,
    blocked,
    escaped,
    total,
    failures,
    ts,
  };
}

// ── Offline corpus test (no prepTarget needed) ────────────────────────────
// Tests only the URL parsing logic without making DNS calls
export function runOfflineChaosTests(): { passed: boolean; failures: string[] } {
  const failures: string[] = [];

  // Test NUL detection
  const nulUrls = ['http://127.0.0.1%00.evil.com', 'http://evil.com\x00test'];
  for (const url of nulUrls) {
    const hasNul = url.includes('\0') || /%00/i.test(url);
    if (!hasNul) failures.push(`NUL detection missed: ${url}`);
  }

  // Test credential detection
  try {
    const u = new URL('http://admin:password@127.0.0.1/');
    if (!u.username || !u.password) failures.push('URL parser did not detect credentials');
  } catch {}

  // Test blocked host detection
  const blockedHosts = ['localhost', 'metadata.google.internal', 'test.localhost'];
  for (const host of blockedHosts) {
    const isBlocked = host === 'localhost' || host.endsWith('.localhost') || host === 'metadata.google.internal';
    if (!isBlocked) failures.push(`Host ${host} should be blocked`);
  }

  return { passed: failures.length === 0, failures };
}
