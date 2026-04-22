#!/usr/bin/env node
/**
 * claude-token-meter
 *
 * Claude Code의 ~/.claude/projects/ JSONL 로그를 스캔하여
 * 월간 실질 토큰 사용량(cache_read 제외)과 세계 분포 상의 위치를 추정합니다.
 *
 * 외부 의존성: 없음 (Node.js 18+ 내장 모듈만 사용)
 */

'use strict';

const { run } = require('../src/index.js');

run(process.argv.slice(2)).catch((err) => {
  console.error('❌ 오류:', err.message);
  process.exit(1);
});
