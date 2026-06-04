export const meta = {
  name: 'codebase-audit',
  description: 'Whole-repo audit: tools-live find → adversarial verify → ranked findings for Dev → Reporting',
  whenToUse: 'Auditing the Vector repo for orphans, duplication, dead code, smells, syntax/type breakage, and HARD-RULE architecture drift. Pass args.slices to scope (default: all 6).',
  phases: [
    { title: 'Find', detail: 'one Sonnet finder per slice, runs knip/jscpd/tsc/go vet/deadcode/lint:* live, then semantic pass' },
    { title: 'Verify', detail: 'independent refuter per semantic finding; Opus for security-critical; default-to-refuted if uncertain' },
    { title: 'Synthesize', detail: 'Opus dedups across slices, ranks by severity, maps to HARD RULES, attaches recommendations' },
  ],
}

// ---- Slice definitions: each owns a coherent subsystem + the exact tools to run live ----
const ALL_SLICES = [
  {
    key: 'fe-core',
    label: 'app/ core (components + lib + hooks + store)',
    paths: ['app/components', 'app/lib', 'app/hooks', 'app/store', 'app/contexts'],
    tools: [
      'npx knip --no-progress   (orphan files/exports/deps — ground truth)',
      'npx jscpd app/components app/lib --min-tokens 70 --reporters consoleFull --silent   (duplication)',
      'npx tsc --noEmit   (syntax/type — ground truth; attribute only errors in this slice\'s paths)',
    ],
  },
  {
    key: 'fe-routes',
    label: 'app/ routes + sentinel + api (drift surface)',
    paths: ['app/(user)', 'app/(overlay)', 'app/api', 'app/sentinel', 'app/redesign', 'app/login'],
    tools: [
      'npm run lint:no-direct-workspace-id; npm run lint:no-old-context-imports; npm run lint:route-orphans; npm run lint:page-description; npm run lint:h2-panel-only; npm run lint:no-ghost-scope-ls-reads   (HARD-RULE drift — ground truth)',
      'npx tsc --noEmit   (attribute errors in this slice\'s paths only)',
    ],
  },
  {
    key: 'be-security',
    label: 'backend auth/security/sentinel/permissions/roles (SECURITY-CRITICAL)',
    paths: ['backend/internal/auth', 'backend/internal/security', 'backend/internal/sentinel', 'backend/internal/topologyclamp', 'backend/internal/permissions', 'backend/internal/roles', 'backend/internal/apikeys', 'backend/internal/secrets'],
    securityCritical: true,
    tools: [
      'cd backend && go vet ./internal/auth/... ./internal/security/... ./internal/sentinel/... ./internal/permissions/... ./internal/roles/...   (correctness)',
      'cd backend && go test ./internal/lintchecks/... ./internal/dbinvariants/...   (sentinel-clamp + invariant compliance)',
      'Server-gate audit: for every List/Get handler in these paths, confirm the SERVER drops data the caller is not cleared for (sentinel.FromCtx clamp), per the SERVER-IS-THE-GATE hard rule. Flag any handler relying on client-side filtering.',
    ],
  },
  {
    key: 'be-data',
    label: 'backend data services (artefacts/fields/topology/deps/portfolio/search)',
    paths: ['backend/internal/artefactitems', 'backend/internal/artefacttypes', 'backend/internal/artefactpriorities', 'backend/internal/fields', 'backend/internal/topology', 'backend/internal/dependencies', 'backend/internal/portfolio', 'backend/internal/portfoliomodels', 'backend/internal/search', 'backend/internal/searchworker', 'backend/internal/savedviews'],
    tools: [
      'cd backend && go vet ./internal/artefactitems/... ./internal/fields/... ./internal/topology/... ./internal/dependencies/... ./internal/portfolio/... ./internal/search/...   (correctness)',
      '/Users/rick/go/bin/deadcode (run from backend/ over ./... — it needs whole-module reachability; filter output to this slice\'s paths)',
      'npm run lint:no-db-in-handlers; npm run lint:writer-boundary; npm run lint:public-dto-mapper   (transport/writer drift)',
    ],
  },
  {
    key: 'be-infra',
    label: 'backend infra services (nav/notifications/messaging/realtime/cache/audit/devreports/etc.)',
    paths: ['backend/internal/nav', 'backend/internal/notifications', 'backend/internal/messaging', 'backend/internal/usermessages', 'backend/internal/realtime', 'backend/internal/cache', 'backend/internal/audit', 'backend/internal/devreports', 'backend/internal/alerting', 'backend/internal/mentions', 'backend/internal/lookups', 'backend/internal/transport', 'backend/internal/shared'],
    tools: [
      'cd backend && go vet ./internal/nav/... ./internal/notifications/... ./internal/messaging/... ./internal/realtime/... ./internal/cache/... ./internal/shared/...   (correctness)',
      '/Users/rick/go/bin/deadcode (run from backend/ over ./... — filter to this slice\'s paths)',
      'npx jscpd backend/internal --min-tokens 80 --reporters consoleFull --silent --ignore "**/*_test.go"   (Go duplication; attribute clones in this slice\'s paths)',
    ],
  },
  {
    key: 'migrations',
    label: 'migrations + dev scripts (SQL hygiene + column-prefix)',
    paths: ['backend/migrations', 'dev/scripts', 'backend/cmd'],
    tools: [
      'npm run lint:column-prefix-convention; npm run lint:sql-in-sqlfile-only; npm run lint:custom-field-prefix   (HARD-RULE: every column is <table>_<col> — ground truth)',
      'Scan migrations for: missing BEGIN/COMMIT, non-idempotent DDL, columns lacking the full-table-name prefix (mmff_library is EXEMPT), orphaned/superseded migrations.',
    ],
  },
]

const FINDING_SCHEMA = {
  type: 'object',
  required: ['slice', 'findings'],
  properties: {
    slice: { type: 'string' },
    toolStatus: { type: 'array', items: { type: 'string' }, description: 'one line per tool: ran clean / N findings / failed-why' },
    findings: {
      type: 'array',
      items: {
        type: 'object',
        required: ['id', 'dimension', 'severity', 'file', 'claim', 'evidence', 'source'],
        properties: {
          id: { type: 'string' },
          dimension: { type: 'string', enum: ['orphan', 'dead-code', 'duplication', 'redundancy', 'smell', 'syntax-type', 'security', 'architecture-drift'] },
          severity: { type: 'string', enum: ['critical', 'high', 'medium', 'low'] },
          file: { type: 'string', description: 'file:line' },
          claim: { type: 'string' },
          evidence: { type: 'string', description: 'tool output line OR the code excerpt proving it' },
          source: { type: 'string', enum: ['tool', 'semantic'], description: 'tool = deterministic (knip/jscpd/tsc/go vet/deadcode/lint); semantic = LLM judgement' },
          recommendation: { type: 'string' },
        },
      },
    },
  },
}

const VERDICT_SCHEMA = {
  type: 'object',
  required: ['id', 'verdict', 'reason'],
  properties: {
    id: { type: 'string' },
    verdict: { type: 'string', enum: ['confirmed', 'refuted', 'downgraded'] },
    reason: { type: 'string' },
    correctedSeverity: { type: 'string', enum: ['critical', 'high', 'medium', 'low'] },
  },
}

function finderPrompt(slice) {
  return `You are auditing ONE slice of the Vector repo. Repo root: "/Users/rick/Documents/MMFFDev - Projects/MMFFDev - Vector".
SLICE: ${slice.label}
PATHS (only report findings whose file is under these): ${slice.paths.join(', ')}

STEP 1 — RUN THESE TOOLS LIVE (Bash) and read their output. These are GROUND TRUTH; build tool-sourced findings from their real output:
${slice.tools.map((t, i) => `  ${i + 1}. ${t}`).join('\n')}

For tsc/go vet/deadcode/jscpd that run wider than this slice, RUN them but only KEEP findings whose file falls under this slice's paths. Record each tool's status in toolStatus (ran clean / N findings / failed + why). If a tool errors, say so — do NOT fabricate output.

STEP 2 — SEMANTIC PASS (read excerpts, do NOT load whole files): within this slice's paths only, look for redundancy (two things doing one job), code smells (god functions, deep nesting, leaky abstractions, dead-but-tool-missed branches), and architecture drift against these HARD RULES:
  - Sentinel is the SOLE identity/tenant/scope owner; new FE code reads identity via useSentinel(), not useAuth().user.workspace_id; new BE handlers on artefact_* call sentinel.FromCtx(ctx).
  - SERVER IS THE GATE: wire payload must not contain data the caller isn't cleared for.
  - ?meg= is a cosmetic NARROW hint, NEVER the authority for scoping a query — flag any client call site passing ?meg= to "scope to current node".
  - Every column is <table_name>_<column> (mmff_library exempt).
${slice.securityCritical ? '  - THIS IS A SECURITY-CRITICAL SLICE: weight server-gate + clamp + auth findings heavily; validate by the forgery test, not the happy path.' : ''}

RULES OF TRUTH:
- Every finding needs real evidence: a tool output line (source:"tool") OR a verbatim code excerpt (source:"semantic").
- Do NOT guess. If you cannot prove a file is orphaned/dead beyond the tool's word, mark source:"tool" and let the verifier decide. If it's your judgement, source:"semantic".
- Prefer fewer, high-confidence findings over a long speculative list.
Return the structured object. Your output IS data, not a human message.`
}

// =================== EXECUTION ===================
// Slice selection: prefer args.slices, but fall back to an EXPLICIT in-script default so a
// dropped/garbled args payload can never silently shrink coverage. fe-core already audited
// (calibration run wpfmyt31w) — this default covers the 5 remaining slices for the backend pass.
const DEFAULT_SLICES = ['fe-routes', 'be-security', 'be-data', 'be-infra', 'migrations']
const requested = (args && Array.isArray(args.slices) && args.slices.length) ? args.slices : DEFAULT_SLICES
const slices = ALL_SLICES.filter((s) => requested.includes(s.key))
log(`Auditing ${slices.length} slice(s): ${slices.map((s) => s.key).join(', ')}`)

const perSlice = await pipeline(
  slices,
  // STAGE 1 — find (tools live + semantic)
  (slice) => agent(finderPrompt(slice), {
    label: `find:${slice.key}`,
    phase: 'Find',
    schema: FINDING_SCHEMA,
    model: 'sonnet',
  }).then((r) => ({ slice, result: r })),
  // STAGE 2 — verify every SEMANTIC finding adversarially (tool-sourced findings are already ground truth, pass through)
  ({ slice, result }) => {
    if (!result || !result.findings) return { slice, confirmed: [], toolStatus: result?.toolStatus || [] }
    const semantic = result.findings.filter((f) => f.source === 'semantic')
    const toolBased = result.findings.filter((f) => f.source === 'tool')
    return parallel(
      semantic.map((f) => () =>
        agent(
          `Adversarially verify this audit finding. Repo root: "/Users/rick/Documents/MMFFDev - Projects/MMFFDev - Vector".
FINDING: [${f.dimension}/${f.severity}] ${f.file} — ${f.claim}
EVIDENCE GIVEN: ${f.evidence}
RECOMMENDATION: ${f.recommendation || '(none)'}

Your job is to REFUTE it. Read the actual code at ${f.file} and its surroundings. Consider: is it reachable via reflection / dynamic dispatch / a public API export / a route registration / a test-only consumer / a build-time codegen step? Is the "duplication" actually intentional parallelism? Is the "smell" load-bearing?
Default to verdict:"refuted" if you are not confident the finding is real. Use "downgraded" (with correctedSeverity) if real but less severe than claimed. Only "confirmed" if you verified it holds.`,
          {
            label: `verify:${slice.key}:${f.id}`,
            phase: 'Verify',
            schema: VERDICT_SCHEMA,
            model: slice.securityCritical ? 'opus' : 'sonnet',
          },
        ).then((v) => ({ finding: f, verdict: v })).catch(() => null),
      ),
    ).then((verdicts) => {
      const surviving = (verdicts || []).filter(Boolean).filter((v) => v.verdict && v.verdict.verdict !== 'refuted')
        .map((v) => ({ ...v.finding, severity: v.verdict.correctedSeverity || v.finding.severity, verifiedBy: v.verdict.verdict, verifyReason: v.verdict.reason }))
      const refutedCount = (verdicts || []).filter(Boolean).filter((v) => v.verdict && v.verdict.verdict === 'refuted').length
      return {
        slice,
        toolStatus: result.toolStatus || [],
        confirmed: [...toolBased.map((f) => ({ ...f, verifiedBy: 'tool-ground-truth' })), ...surviving],
        refutedCount,
        semanticTotal: semantic.length,
      }
    })
  },
)

const clean = perSlice.filter(Boolean)
log(`Verification done. Synthesizing ${clean.reduce((n, s) => n + s.confirmed.length, 0)} confirmed findings across ${clean.length} slice(s).`)

// STAGE 3 — synthesize (Opus): dedup, rank, map to HARD RULES, prioritised recommendations
phase('Synthesize')
const synthesis = await agent(
  `You are the synthesizer for a Vector codebase audit. Below are VERIFIED findings per slice (tool-ground-truth + adversarially-survived semantic findings). Refuted findings are already removed.

${JSON.stringify(clean, null, 2)}

Produce a prioritised audit report as a structured object:
1. Dedup findings that appear in multiple slices (same file:line / same root cause).
2. Rank by severity (critical → low), with security + HARD-RULE-drift findings weighted up.
3. For each, give a one-line prioritised recommendation (NO code changes — recommendations only).
4. Note per-slice tool status and how many semantic findings were refuted (false-positive rate signal — this is the calibration metric).
5. Group by dimension (orphan / dead-code / duplication / redundancy / smell / syntax-type / security / architecture-drift).`,
  {
    label: 'synthesize',
    phase: 'Synthesize',
    model: 'opus',
    schema: {
      type: 'object',
      required: ['summary', 'falsePositiveSignal', 'byDimension', 'topPriorities'],
      properties: {
        summary: { type: 'string' },
        falsePositiveSignal: { type: 'string', description: 'refuted/total semantic per slice — the calibration metric' },
        topPriorities: { type: 'array', items: { type: 'object', required: ['rank', 'severity', 'file', 'issue', 'recommendation'], properties: { rank: { type: 'number' }, severity: { type: 'string' }, dimension: { type: 'string' }, file: { type: 'string' }, issue: { type: 'string' }, recommendation: { type: 'string' } } } },
        byDimension: { type: 'object' },
        toolStatus: { type: 'array', items: { type: 'string' } },
      },
    },
  },
)

return synthesis
