/**
 * vite-native-contract-plane.ts — L3: OpenAPI 3.1 & RFC 9457 Schemas
 * Zero-dependency: pure TypeScript objects.
 */

// ── RFC 9457 Problem Details ──────────────────────────────────────────────
export const PROBLEM_TYPES = {
  missing_query: {
    type: 'https://vite-native-gateway/problems/missing-query',
    title: 'Missing Required Query Parameter',
    status: 400,
    detail: "The 'q' query parameter is required and was not provided.",
  },
  ssrf_blocked: {
    type: 'https://vite-native-gateway/problems/ssrf-blocked',
    title: 'SSRF Target Blocked',
    status: 400,
    detail: 'The requested URL was blocked by the SSRF protection policy.',
  },
  rate_limited: {
    type: 'https://vite-native-gateway/problems/rate-limited',
    title: 'Rate Limit Exceeded',
    status: 429,
    detail: 'Too many requests. Please slow down and retry after a moment.',
  },
  upstream_failed: {
    type: 'https://vite-native-gateway/problems/upstream-failed',
    title: 'Upstream Search Engine Failed',
    status: 502,
    detail: 'All search engine backends returned errors. Retry later.',
  },
  internal_error: {
    type: 'https://vite-native-gateway/problems/internal-error',
    title: 'Internal Server Error',
    status: 500,
    detail: 'An unexpected internal error occurred.',
  },
  agent_loop: {
    type: 'https://vite-native-gateway/problems/agent-loop',
    title: 'Agent Loop Detected',
    status: 429,
    detail: 'The same URL has been requested too many times in a short period.',
  },
  cross_origin: {
    type: 'https://vite-native-gateway/problems/cross-origin',
    title: 'Cross-Origin Request Rejected',
    status: 403,
    detail: 'Cross-origin requests to the local gateway are not permitted.',
  },
} as const;

export type ProblemType = keyof typeof PROBLEM_TYPES;

export function makeProblem(type: ProblemType, extra?: Partial<{ detail: string; instance: string }>): object {
  const base = PROBLEM_TYPES[type];
  return {
    ...base,
    ...(extra?.detail && { detail: extra.detail }),
    ...(extra?.instance && { instance: extra.instance }),
  };
}

// ── OpenAPI 3.1 Document ──────────────────────────────────────────────────
export function getNativeOpenApiDocument(baseUrl: string): object {
  const problemSchema = {
    type: 'object',
    properties: {
      type: { type: 'string', format: 'uri' },
      title: { type: 'string' },
      status: { type: 'integer' },
      detail: { type: 'string' },
      instance: { type: 'string', format: 'uri' },
    },
    required: ['type', 'title', 'status'],
  };

  const problemResponse = {
    description: 'RFC 9457 Problem Details',
    content: { 'application/problem+json': { schema: { $ref: '#/components/schemas/Problem' } } },
  };

  return {
    openapi: '3.1.0',
    jsonSchemaDialect: 'https://json-schema.org/draft/2020-12/schema',
    info: {
      title: 'Vite Native Knowledge Gateway',
      version: '1.0.0',
      description: 'Zero-dependency local metasearch engine and knowledge store.',
    },
    servers: [{ url: baseUrl }],
    paths: {
      '/api/native-search': {
        get: {
          summary: 'Metasearch across multiple engines with RRF+MMR ranking',
          parameters: [
            { name: 'q', in: 'query', required: true, schema: { type: 'string', minLength: 1 } },
            { name: 'count', in: 'query', required: false, schema: { type: 'integer', minimum: 1, maximum: 20, default: 5 } },
            { name: 'engines', in: 'query', required: false, schema: { type: 'string' } },
          ],
          responses: {
            '200': { description: 'Search results', content: { 'application/json': { schema: { type: 'object' } } } },
            '400': { $ref: '#/components/responses/Problem' },
            '429': { $ref: '#/components/responses/Problem' },
            '502': { $ref: '#/components/responses/Problem' },
          },
        },
      },
      '/api/native-search/stream': {
        get: {
          summary: 'SSE streaming search results',
          parameters: [
            { name: 'q', in: 'query', required: true, schema: { type: 'string' } },
            { name: 'count', in: 'query', required: false, schema: { type: 'integer', minimum: 1, maximum: 20 } },
          ],
          responses: {
            '200': { description: 'SSE stream', content: { 'text/event-stream': { schema: { type: 'string' } } } },
            '400': { $ref: '#/components/responses/Problem' },
            '429': { $ref: '#/components/responses/Problem' },
          },
        },
      },
      '/api/native-read': {
        get: {
          summary: 'Fetch and extract text content from a URL (SSRF-protected)',
          parameters: [
            { name: 'url', in: 'query', required: true, schema: { type: 'string', format: 'uri' } },
          ],
          responses: {
            '200': { description: 'Page content', content: { 'application/json': { schema: { type: 'object' } } } },
            '400': { $ref: '#/components/responses/Problem' },
          },
        },
      },
      '/api/native-ingest': {
        post: {
          summary: 'Ingest content into the knowledge store',
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    kind: { type: 'string' },
                    ref: { type: 'string' },
                    summary: { type: 'string' },
                  },
                  required: ['kind', 'ref', 'summary'],
                },
              },
            },
          },
          responses: {
            '200': { description: 'Ingest result', content: { 'application/json': { schema: { type: 'object' } } } },
            '400': { $ref: '#/components/responses/Problem' },
          },
        },
      },
      '/api/native-knowledge': {
        get: {
          summary: 'Search the knowledge store',
          parameters: [
            { name: 'q', in: 'query', required: true, schema: { type: 'string' } },
            { name: 'limit', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 100 } },
          ],
          responses: {
            '200': { description: 'Knowledge records', content: { 'application/json': { schema: { type: 'object' } } } },
          },
        },
      },
      '/api/native-knowledge/repair-index': {
        post: {
          summary: 'Rebuild FTS5 index',
          responses: { '200': { description: 'Repair result' } },
        },
      },
      '/api/audit/verify': {
        get: {
          summary: 'Verify audit log integrity',
          responses: { '200': { description: 'Audit verification result' } },
        },
      },
      '/api/native-doctor': {
        get: {
          summary: 'Aggregated health report',
          parameters: [
            { name: 'deep', in: 'query', schema: { type: 'boolean' } },
          ],
          responses: { '200': { description: 'Doctor report' } },
        },
      },
      '/api/native-selftest': {
        get: {
          summary: 'Run static self-tests',
          responses: { '200': { description: 'Self-test results' } },
        },
      },
      '/api/native-selftest/functional': {
        get: {
          summary: 'Run functional golden-fixture tests',
          responses: { '200': { description: 'Functional test results' } },
        },
      },
      '/api/native-policy': {
        get: { summary: 'Get all policy flags', responses: { '200': { description: 'Policy flags' } } },
        post: { summary: 'Set a policy flag', responses: { '200': { description: 'Policy update result' } } },
      },
      '/api/native-snapshot': {
        post: { summary: 'Create hot backup', responses: { '200': { description: 'Snapshot result' } } },
        get: { summary: 'Get snapshot manifest', responses: { '200': { description: 'Snapshot manifest' } } },
      },
      '/api/native-maintenance/run': {
        post: { summary: 'Run SQLite maintenance', responses: { '200': { description: 'Maintenance result' } } },
      },
      '/api/native-runtime': {
        get: { summary: 'Get runtime stats', responses: { '200': { description: 'Runtime stats' } } },
      },
    },
    components: {
      schemas: { Problem: problemSchema },
      responses: { Problem: problemResponse },
    },
  };
}

// ── Contract Self-Test ────────────────────────────────────────────────────
export function contractSelfTest(): { passed: boolean; failures: string[] } {
  const failures: string[] = [];
  const doc = getNativeOpenApiDocument('http://localhost:5173') as any;

  if (doc.openapi !== '3.1.0') failures.push('openapi version must be 3.1.0');
  if (!doc.jsonSchemaDialect) failures.push('jsonSchemaDialect missing');
  if (!doc.paths['/api/native-search']) failures.push('/api/native-search path missing');
  if (!doc.paths['/api/native-read']) failures.push('/api/native-read path missing');
  if (!doc.paths['/api/native-ingest']) failures.push('/api/native-ingest path missing');
  if (!doc.components?.schemas?.Problem) failures.push('Problem schema missing from components');
  if (!doc.components?.responses?.Problem) failures.push('Problem response missing from components');

  // Verify query param type precision
  const searchParams = doc.paths['/api/native-search']?.get?.parameters;
  const countParam = searchParams?.find((p: any) => p.name === 'count');
  if (countParam?.schema?.type !== 'integer') failures.push('count param must be type:integer not type:number');

  return { passed: failures.length === 0, failures };
}
