import path from 'node:path';
import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import { runAstPipelineWithPlugins, type AstRelationType } from '../packages/inference/src/plugins';

interface GoldenRepo {
  id: string;
  name: string;
}

interface GoldenCaseFile {
  path: string;
  content: string;
}

interface GoldenExpectedRelation {
  toId: string;
  type: AstRelationType;
}

interface GoldenCase {
  name: string;
  fromId: string;
  file: GoldenCaseFile;
  expected: GoldenExpectedRelation[];
}

interface GoldenSet {
  version: string;
  repos: GoldenRepo[];
  cases: GoldenCase[];
}

interface CandidateRelation {
  key: string;
  fromId: string;
  toId: string;
  type: AstRelationType;
  evidencePresent: boolean;
  caseNames: Set<string>;
}

interface CaseMetric {
  caseName: string;
  expected: number;
  predicted: number;
  truePositives: number;
  precision: number;
  recall: number;
}

interface MetricSummary {
  precision: number;
  recall: number;
  evidenceCoverage: number;
  f1: number;
}

interface RegressionRow {
  metric: 'precision' | 'recall' | 'evidenceCoverage';
  baseline: number;
  current: number;
  delta: number;
  passed: boolean;
}

interface BenchmarkReport {
  version: string;
  generatedAt: string;
  goldenSetPath: string;
  baselinePath: string | null;
  thresholds: {
    minPrecision: number;
    minRecall: number;
    minEvidenceCoverage: number;
    maxDrop: number;
  };
  summary: MetricSummary & {
    totalExpected: number;
    totalPredicted: number;
    truePositives: number;
    missing: number;
    unexpected: number;
  };
  perCase: CaseMetric[];
  missing: string[];
  unexpected: string[];
  regression: RegressionRow[];
  gateFailures: string[];
}

const RELATION_TYPES: AstRelationType[] = [
  'call',
  'expose',
  'read',
  'write',
  'produce',
  'consume',
  'depend_on',
];

const GENERIC_TOKENS = new Set([
  'service', 'services', 'app', 'application', 'config', 'url', 'uri', 'host', 'hostname',
  'port', 'base', 'endpoint', 'api', 'http', 'https', 'grpc', 'client', 'server',
  'prod', 'stage', 'staging', 'dev', 'local', 'internal', 'external', 'main', 'spring',
  'datasource', 'username', 'password', 'read', 'write', 'enabled',
]);

function makeKey(fromId: string, toId: string, type: AstRelationType): string {
  return `${fromId}|${toId}|${type}`;
}

function parseKey(key: string): { fromId: string; toId: string; type: AstRelationType } {
  const [fromId, toId, type] = key.split('|');
  return { fromId, toId, type: normalizeRelationType(type) };
}

function normalizeRelationType(value: unknown): AstRelationType {
  if (typeof value === 'string' && RELATION_TYPES.includes(value as AstRelationType)) {
    return value as AstRelationType;
  }
  return 'depend_on';
}

function tokenize(raw: string): string[] {
  return raw
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .map((token) => token.trim())
    .filter((token) => token.length >= 2 && !GENERIC_TOKENS.has(token));
}

function inferTargetRepoId(
  hint: string,
  repoTokens: Array<{ id: string; tokens: Set<string> }>,
  currentRepoId: string,
): string | null {
  const tokens = tokenize(hint);
  if (tokens.length === 0) return null;

  let best: { id: string; score: number } | null = null;

  for (const candidate of repoTokens) {
    if (candidate.id === currentRepoId) continue;

    let score = 0;
    for (const token of tokens) {
      if (candidate.tokens.has(token)) score += 1;
    }

    if (score === 0) continue;
    if (!best || score > best.score) {
      best = { id: candidate.id, score };
    }
  }

  return best ? best.id : null;
}

function readArgValue(args: string[], flag: string): string | undefined {
  const idx = args.indexOf(flag);
  if (idx < 0 || idx + 1 >= args.length) return undefined;
  return args[idx + 1];
}

function readNumericArg(args: string[], flag: string, fallback: number): number {
  const raw = readArgValue(args, flag);
  if (!raw) return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : fallback;
}

async function exists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

function round(value: number): number {
  return Number(value.toFixed(3));
}

function toDisplay(key: string): string {
  const parsed = parseKey(key);
  return `${parsed.fromId} -> ${parsed.toId} (${parsed.type})`;
}

function intersectionSize(a: Set<string>, b: Set<string>): number {
  let count = 0;
  for (const item of a) {
    if (b.has(item)) count += 1;
  }
  return count;
}

async function main() {
  const args = process.argv.slice(2);
  const goldenSetPath = path.resolve(process.cwd(), readArgValue(args, '--golden-set') ?? 'scripts/fixtures/task2-8-golden-set.v0.json');
  const baselinePath = path.resolve(process.cwd(), readArgValue(args, '--baseline') ?? 'scripts/fixtures/task2-8-benchmark-baseline.v0.json');
  const reportPath = path.resolve(process.cwd(), readArgValue(args, '--report-out') ?? 'scripts/reports/task2-8-benchmark-report.json');

  const minPrecision = readNumericArg(args, '--min-precision', 0.7);
  const minRecall = readNumericArg(args, '--min-recall', 0.7);
  const minEvidenceCoverage = readNumericArg(args, '--min-evidence-coverage', 0.95);
  const maxDrop = readNumericArg(args, '--max-drop', 0.03);

  const goldenSetRaw = await readFile(goldenSetPath, 'utf8');
  const goldenSet = JSON.parse(goldenSetRaw) as GoldenSet;

  if (!Array.isArray(goldenSet.repos) || goldenSet.repos.length === 0) {
    throw new Error('golden set repos is empty');
  }
  if (!Array.isArray(goldenSet.cases) || goldenSet.cases.length === 0) {
    throw new Error('golden set cases is empty');
  }

  const repoIds = new Set(goldenSet.repos.map((repo) => repo.id));
  const repoTokens = goldenSet.repos.map((repo) => ({
    id: repo.id,
    tokens: new Set([...tokenize(repo.name), ...tokenize(repo.id)]),
  }));

  const predicted = new Map<string, CandidateRelation>();
  const expected = new Set<string>();
  const predictedByCase = new Map<string, Set<string>>();
  const expectedByCase = new Map<string, Set<string>>();

  for (const testCase of goldenSet.cases) {
    if (!repoIds.has(testCase.fromId)) {
      throw new Error(`case ${testCase.name}: fromId ${testCase.fromId} does not exist in repos`);
    }

    const caseExpected = new Set<string>();
    for (const relation of testCase.expected) {
      if (!repoIds.has(relation.toId)) {
        throw new Error(`case ${testCase.name}: expected toId ${relation.toId} does not exist in repos`);
      }
      const relationType = normalizeRelationType(relation.type);
      const key = makeKey(testCase.fromId, relation.toId, relationType);
      expected.add(key);
      caseExpected.add(key);
    }
    expectedByCase.set(testCase.name, caseExpected);

    const pipeline = runAstPipelineWithPlugins(testCase.file);
    for (const signal of pipeline.signals) {
      const toId = inferTargetRepoId(signal.hint, repoTokens, testCase.fromId);
      if (!toId) continue;

      const type = normalizeRelationType(signal.relationType ?? signal.relationTypeHint);
      const key = makeKey(testCase.fromId, toId, type);
      const evidencePresent =
        (typeof signal.evidence === 'string' && signal.evidence.trim().length > 0)
        || (Array.isArray(signal.evidences) && signal.evidences.length > 0);

      const existing = predicted.get(key);
      if (!existing) {
        predicted.set(key, {
          key,
          fromId: testCase.fromId,
          toId,
          type,
          evidencePresent,
          caseNames: new Set([testCase.name]),
        });
      } else {
        existing.evidencePresent = existing.evidencePresent || evidencePresent;
        existing.caseNames.add(testCase.name);
      }

      const casePredicted = predictedByCase.get(testCase.name) ?? new Set<string>();
      casePredicted.add(key);
      predictedByCase.set(testCase.name, casePredicted);
    }
  }

  const predictedKeys = new Set(predicted.keys());
  const truePositiveCount = intersectionSize(predictedKeys, expected);

  const precision = predictedKeys.size === 0 ? 0 : round(truePositiveCount / predictedKeys.size);
  const recall = expected.size === 0 ? 0 : round(truePositiveCount / expected.size);
  const f1 = precision + recall === 0 ? 0 : round((2 * precision * recall) / (precision + recall));

  let evidenceTruePositives = 0;
  for (const key of predictedKeys) {
    if (!expected.has(key)) continue;
    if (predicted.get(key)?.evidencePresent) {
      evidenceTruePositives += 1;
    }
  }
  const evidenceCoverage = truePositiveCount === 0 ? 0 : round(evidenceTruePositives / truePositiveCount);

  const missing: string[] = [];
  for (const key of expected) {
    if (!predictedKeys.has(key)) {
      missing.push(toDisplay(key));
    }
  }

  const unexpected: string[] = [];
  for (const key of predictedKeys) {
    if (!expected.has(key)) {
      unexpected.push(toDisplay(key));
    }
  }

  const perCase: CaseMetric[] = [];
  for (const testCase of goldenSet.cases) {
    const expectedSet = expectedByCase.get(testCase.name) ?? new Set<string>();
    const predictedSet = predictedByCase.get(testCase.name) ?? new Set<string>();
    const caseTp = intersectionSize(expectedSet, predictedSet);
    perCase.push({
      caseName: testCase.name,
      expected: expectedSet.size,
      predicted: predictedSet.size,
      truePositives: caseTp,
      precision: predictedSet.size === 0 ? 0 : round(caseTp / predictedSet.size),
      recall: expectedSet.size === 0 ? 0 : round(caseTp / expectedSet.size),
    });
  }

  const regression: RegressionRow[] = [];
  if (await exists(baselinePath)) {
    const baselineRaw = await readFile(baselinePath, 'utf8');
    const baseline = JSON.parse(baselineRaw) as { summary?: Partial<MetricSummary> };
    const baselineSummary = baseline.summary ?? {};

    const baselinePrecision = Number(baselineSummary.precision ?? 0);
    const baselineRecall = Number(baselineSummary.recall ?? 0);
    const baselineEvidence = Number(baselineSummary.evidenceCoverage ?? 0);

    const rows: Array<{ metric: RegressionRow['metric']; baseline: number; current: number }> = [
      { metric: 'precision', baseline: baselinePrecision, current: precision },
      { metric: 'recall', baseline: baselineRecall, current: recall },
      { metric: 'evidenceCoverage', baseline: baselineEvidence, current: evidenceCoverage },
    ];

    for (const row of rows) {
      const delta = round(row.current - row.baseline);
      regression.push({
        metric: row.metric,
        baseline: round(row.baseline),
        current: row.current,
        delta,
        passed: delta >= -maxDrop,
      });
    }
  }

  const gateFailures: string[] = [];
  if (precision < minPrecision) {
    gateFailures.push(`precision ${precision.toFixed(3)} < ${minPrecision.toFixed(3)}`);
  }
  if (recall < minRecall) {
    gateFailures.push(`recall ${recall.toFixed(3)} < ${minRecall.toFixed(3)}`);
  }
  if (evidenceCoverage < minEvidenceCoverage) {
    gateFailures.push(`evidenceCoverage ${evidenceCoverage.toFixed(3)} < ${minEvidenceCoverage.toFixed(3)}`);
  }
  for (const row of regression) {
    if (!row.passed) {
      gateFailures.push(
        `${row.metric} regression ${row.delta.toFixed(3)} exceeded max drop ${maxDrop.toFixed(3)}`,
      );
    }
  }

  const report: BenchmarkReport = {
    version: 'task2-8-benchmark-v0',
    generatedAt: new Date().toISOString(),
    goldenSetPath,
    baselinePath: (await exists(baselinePath)) ? baselinePath : null,
    thresholds: {
      minPrecision,
      minRecall,
      minEvidenceCoverage,
      maxDrop,
    },
    summary: {
      precision,
      recall,
      evidenceCoverage,
      f1,
      totalExpected: expected.size,
      totalPredicted: predictedKeys.size,
      truePositives: truePositiveCount,
      missing: missing.length,
      unexpected: unexpected.length,
    },
    perCase,
    missing,
    unexpected,
    regression,
    gateFailures,
  };

  await mkdir(path.dirname(reportPath), { recursive: true });
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');

  console.log(
    [
      'Task 2-8 benchmark complete.',
      `precision=${precision.toFixed(3)}`,
      `recall=${recall.toFixed(3)}`,
      `evidenceCoverage=${evidenceCoverage.toFixed(3)}`,
      `f1=${f1.toFixed(3)}`,
      `expected=${expected.size}`,
      `predicted=${predictedKeys.size}`,
      `missing=${missing.length}`,
      `unexpected=${unexpected.length}`,
      `report=${reportPath}`,
    ].join(' '),
  );

  if (gateFailures.length > 0) {
    console.error('Task 2-8 quality gate failed:');
    for (const failure of gateFailures) {
      console.error(`- ${failure}`);
    }
    process.exit(1);
  }

  console.log('OK: task2-8 quality gate passed.');
}

main().catch((error) => {
  console.error('Task 2-8 benchmark failed:', error);
  process.exit(1);
});
