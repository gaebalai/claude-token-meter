/**
 * claude-token-meter core logic
 */

'use strict';

const fs = require('fs');
const fsp = require('fs/promises');
const os = require('os');
const path = require('path');
const readline = require('readline');

// ───────────────────────────────────────────────────────────────
// 기준점 (Reference Points) — Python 구현과 동일하게 유지
// ───────────────────────────────────────────────────────────────
const REFERENCE_POINTS = [
  { tokens: 10_000_000, topPct: 50.0, label: 'Max 일반 유저' },
  { tokens: 100_000_000, topPct: 10.0, label: 'Max 20x 헤비층' },
  { tokens: 3_200_000_000, topPct: 1.0, label: '공개 자가신고 (mrz)' },
  { tokens: 17_400_000_000, topPct: 0.5, label: '공개 자가신고 (alairjt)' },
];

const MAX_HEAVY_TOKENS = 100_000_000;

// ───────────────────────────────────────────────────────────────
// 인자 파싱
// ───────────────────────────────────────────────────────────────
function parseArgs(argv) {
  const args = {
    days: 30,
    logDir: null,
    json: false,
    help: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--days') {
      args.days = parseInt(argv[++i], 10);
    } else if (a === '--log-dir') {
      args.logDir = argv[++i];
    } else if (a === '--json') {
      args.json = true;
    } else if (a === '--help' || a === '-h') {
      args.help = true;
    }
  }
  return args;
}

function printHelp() {
  console.log(`
claude-token-meter — Claude Code 월간 실질 토큰 사용량 측정기

사용법:
  npx claude-token-meter [옵션]

옵션:
  --days <N>        측정 기간 (일 단위, 기본 30)
  --log-dir <경로>   Claude 로그 디렉토리 (기본: ~/.claude/projects)
  --json            JSON 형태로 출력 (자동화용)
  --help, -h        이 도움말 표시

예시:
  npx claude-token-meter
  npx claude-token-meter --days 7
  npx claude-token-meter --json > usage.json
`);
}

// ───────────────────────────────────────────────────────────────
// 로그 디렉토리
// ───────────────────────────────────────────────────────────────
function resolveLogDir(custom) {
  if (custom) {
    const p = custom.startsWith('~')
      ? path.join(os.homedir(), custom.slice(1))
      : path.resolve(custom);
    if (!fs.existsSync(p)) {
      throw new Error(`지정된 경로가 존재하지 않습니다: ${p}`);
    }
    return p;
  }
  const def = path.join(os.homedir(), '.claude', 'projects');
  if (!fs.existsSync(def)) {
    throw new Error(
      `Claude 로그 디렉토리를 찾을 수 없습니다: ${def}\n   Claude Code가 설치되어 있고 한 번이라도 사용했는지 확인해주세요.`
    );
  }
  return def;
}

// ───────────────────────────────────────────────────────────────
// 재귀적으로 .jsonl 파일 찾기
// ───────────────────────────────────────────────────────────────
async function findJsonlFiles(dir) {
  const results = [];
  const entries = await fsp.readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      const sub = await findJsonlFiles(full);
      results.push(...sub);
    } else if (entry.isFile() && entry.name.endsWith('.jsonl')) {
      results.push(full);
    }
  }
  return results;
}

// ───────────────────────────────────────────────────────────────
// JSONL 파일 스트리밍 파싱
// ───────────────────────────────────────────────────────────────
function extractUsage(entry) {
  if (entry && typeof entry === 'object') {
    if (entry.message && typeof entry.message === 'object' && entry.message.usage) {
      return entry.message.usage;
    }
    if (entry.usage && typeof entry.usage === 'object') {
      return entry.usage;
    }
  }
  return null;
}

function parseTimestamp(tsStr) {
  if (!tsStr) return null;
  const t = new Date(tsStr);
  if (isNaN(t.getTime())) return null;
  return t;
}

async function scanFile(filePath, cutoff, totals, counters) {
  return new Promise((resolve) => {
    const stream = fs.createReadStream(filePath, { encoding: 'utf8' });
    const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });

    rl.on('line', (line) => {
      const trimmed = line.trim();
      if (!trimmed) return;
      let entry;
      try {
        entry = JSON.parse(trimmed);
      } catch (_) {
        counters.errors++;
        return;
      }

      const ts = parseTimestamp(entry.timestamp);
      if (!ts) return;
      if (ts < cutoff) return;

      const usage = extractUsage(entry);
      if (!usage) return;

      totals.input += Number(usage.input_tokens || 0);
      totals.output += Number(usage.output_tokens || 0);
      totals.cache_creation += Number(usage.cache_creation_input_tokens || 0);
      totals.cache_read += Number(usage.cache_read_input_tokens || 0);
      counters.messages++;
    });

    rl.on('close', resolve);
    rl.on('error', (err) => {
      counters.errors++;
      console.error(`⚠️  파일 읽기 실패: ${path.basename(filePath)}: ${err.message}`);
      resolve();
    });
  });
}

async function scanLogs(logDir, days) {
  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  const files = await findJsonlFiles(logDir);

  const totals = { input: 0, output: 0, cache_creation: 0, cache_read: 0 };
  const counters = { messages: 0, errors: 0 };

  for (const f of files) {
    await scanFile(f, cutoff, totals, counters);
  }

  return {
    totals,
    messageCount: counters.messages,
    fileCount: files.length,
    errorCount: counters.errors,
    periodDays: days,
  };
}

// ───────────────────────────────────────────────────────────────
// 상위 % 추정 — 로그 공간 선형 보간
// ───────────────────────────────────────────────────────────────
function estimatePercentile(effective) {
  if (effective <= 0) return 99.9;

  const pts = [...REFERENCE_POINTS].sort((a, b) => a.tokens - b.tokens);

  if (effective <= pts[0].tokens) {
    const ratio = effective / pts[0].tokens;
    return Math.min(99.0, 50.0 + (1 - ratio) * 40.0);
  }
  if (effective >= pts[pts.length - 1].tokens) {
    return pts[pts.length - 1].topPct;
  }

  for (let i = 0; i < pts.length - 1; i++) {
    const x0 = pts[i].tokens;
    const x1 = pts[i + 1].tokens;
    if (effective >= x0 && effective <= x1) {
      const logX = Math.log10(effective);
      const logX0 = Math.log10(x0);
      const logX1 = Math.log10(x1);
      const logY0 = Math.log10(pts[i].topPct);
      const logY1 = Math.log10(pts[i + 1].topPct);
      const t = (logX - logX0) / (logX1 - logX0);
      const logY = logY0 + t * (logY1 - logY0);
      return Math.pow(10, logY);
    }
  }
  return 50.0;
}

// ───────────────────────────────────────────────────────────────
// 포매팅
// ───────────────────────────────────────────────────────────────
function formatNumber(n) {
  const abs = Math.abs(n);
  const commas = n.toLocaleString('en-US');
  if (abs >= 1e9) return `${(n / 1e9).toFixed(3)}B (${commas})`;
  if (abs >= 1e6) return `${(n / 1e6).toFixed(2)}M (${commas})`;
  if (abs >= 1e3) return `${(n / 1e3).toFixed(1)}K (${commas})`;
  return commas;
}

function printReport(result) {
  const { totals, periodDays } = result;
  const effective = totals.input + totals.output + totals.cache_creation;
  const grand = effective + totals.cache_read;
  const cacheRatio = grand > 0 ? (totals.cache_read / grand) * 100 : 0;
  const multiplier = effective / MAX_HEAVY_TOKENS;
  const pct = estimatePercentile(effective);

  const sep = '='.repeat(66);
  const line = '─'.repeat(66);

  console.log(sep);
  console.log('  🧪 Claude Token Meter — 측정 결과');
  console.log(sep);
  console.log();
  console.log(`📁 스캔한 파일       : ${result.fileCount.toLocaleString()}개`);
  console.log(`💬 집계한 메시지     : ${result.messageCount.toLocaleString()}개`);
  console.log(`📅 측정 기간         : 최근 ${periodDays}일`);
  if (result.errorCount > 0) {
    console.log(`⚠️  파싱 오류        : ${result.errorCount}건`);
  }
  console.log();
  console.log(line);
  console.log('  📊 토큰 분류별 합계');
  console.log(line);
  console.log(`  input               : ${formatNumber(totals.input)}`);
  console.log(`  output              : ${formatNumber(totals.output)}`);
  console.log(`  cache_creation      : ${formatNumber(totals.cache_creation)}`);
  console.log(`  cache_read          : ${formatNumber(totals.cache_read)}  ← 비교에서 제외`);
  console.log(`  ─────────────────────────`);
  console.log(`  총합                : ${formatNumber(grand)}`);
  console.log(`  cache_read 비율     : ${cacheRatio.toFixed(1)}%`);
  console.log();
  console.log(line);
  console.log('  ✅ 실질 사용량 (세계 비교용)');
  console.log(line);
  console.log(`  effective = input + output + cache_creation`);
  console.log(`  = ${formatNumber(effective)}`);
  console.log();
  console.log(line);
  console.log('  🌍 세계 분포에서의 위치 (추정)');
  console.log(line);
  console.log(`  Max 20x 헤비층 대비 : ${multiplier.toFixed(2)}배`);
  console.log(`  세계 상위 추정      : 약 ${pct.toFixed(1)}%`);
  console.log();
  console.log('  [참조점]');
  for (const p of REFERENCE_POINTS) {
    const near =
      Math.abs(Math.log10(Math.max(effective, 1)) - Math.log10(p.tokens)) < 0.15
        ? ' ← 당신의 위치'
        : '';
    const lbl = p.label.padEnd(30);
    const val = formatNumber(p.tokens).padEnd(30);
    console.log(`    • ${lbl} : ${val}  (상위 ${p.topPct}%)${near}`);
  }
  console.log();
  console.log(line);
  console.log('  ⚠️  측정의 한계 (반드시 함께 읽어주세요)');
  console.log(line);
  console.log('  1. 4개 참조점 기반 추정이라 ±5% 편차 가능');
  console.log('  2. 공개 자가신고자는 상위에 치우침 → 상위 % 추정은 보수적');
  console.log('  3. Claude 단일 측정. ChatGPT/Copilot 등 타 AI는 미포함');
  console.log('  4. cache_read 포함/제외 정의는 비교 대상마다 다를 수 있음');
  console.log();
  console.log(sep);
}

function printJson(result) {
  const { totals, periodDays } = result;
  const effective = totals.input + totals.output + totals.cache_creation;
  const grand = effective + totals.cache_read;

  const output = {
    period_days: periodDays,
    file_count: result.fileCount,
    message_count: result.messageCount,
    tokens: {
      input: totals.input,
      output: totals.output,
      cache_creation: totals.cache_creation,
      cache_read: totals.cache_read,
      grand_total: grand,
      effective,
    },
    comparison: {
      vs_max20x_heavy_multiplier: Number((effective / MAX_HEAVY_TOKENS).toFixed(3)),
      estimated_top_percentile: Number(estimatePercentile(effective).toFixed(2)),
    },
    reference_points: REFERENCE_POINTS.map((p) => ({
      label: p.label,
      tokens: p.tokens,
      top_percentile: p.topPct,
    })),
    disclaimers: [
      '4점 기반 추정으로 ±5% 오차 가능',
      '공개 자가신고자는 상위에 치우쳐 상위 % 추정은 보수적',
      'Claude 단일 측정이며 타 AI 도구 사용량 미포함',
      'cache_read 포함/제외 정의는 비교 대상마다 다를 수 있음',
    ],
  };
  console.log(JSON.stringify(output, null, 2));
}

// ───────────────────────────────────────────────────────────────
// 엔트리포인트
// ───────────────────────────────────────────────────────────────
async function run(argv) {
  const args = parseArgs(argv);
  if (args.help) {
    printHelp();
    return;
  }

  const logDir = resolveLogDir(args.logDir);
  if (!args.json) {
    console.log(`🔍 로그 스캔 중: ${logDir}`);
    console.log();
  }

  const result = await scanLogs(logDir, args.days);

  if (args.json) {
    printJson(result);
  } else {
    printReport(result);
  }
}

module.exports = { run, estimatePercentile, REFERENCE_POINTS };
