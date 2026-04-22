#!/usr/bin/env node
/**
 * claude-token-meter 스킬을 Claude Code에 설치합니다.
 *
 *   node bin/install-claude-code.js           # 파일 복사
 *   node bin/install-claude-code.js --link    # 심볼릭 링크 (개발용)
 *   node bin/install-claude-code.js --force   # 기존 설치 덮어쓰기
 *   node bin/install-claude-code.js --uninstall
 *
 * 설치 위치: ~/.claude/skills/claude-token-meter/
 */

'use strict';

const fs = require('fs');
const fsp = require('fs/promises');
const os = require('os');
const path = require('path');

const SKILL_NAME = 'claude-token-meter';
const SRC_DIR = path.resolve(__dirname, '..', 'skill');
const DEST_ROOT = path.join(os.homedir(), '.claude', 'skills');
const DEST_DIR = path.join(DEST_ROOT, SKILL_NAME);

function parseArgs(argv) {
  const args = { link: false, force: false, uninstall: false, help: false };
  for (const a of argv) {
    if (a === '--link') args.link = true;
    else if (a === '--force') args.force = true;
    else if (a === '--uninstall') args.uninstall = true;
    else if (a === '--help' || a === '-h') args.help = true;
  }
  return args;
}

function printHelp() {
  console.log(`
claude-token-meter 스킬을 Claude Code에 설치합니다.

사용법:
  node bin/install-claude-code.js [옵션]

옵션:
  --link        파일 복사 대신 심볼릭 링크 생성 (개발 중 권장)
  --force       기존 설치가 있어도 덮어쓰기
  --uninstall   설치된 스킬 제거
  --help, -h    이 도움말 표시

설치 위치: ${DEST_DIR}
`);
}

async function exists(p) {
  try {
    await fsp.lstat(p);
    return true;
  } catch {
    return false;
  }
}

async function copyDir(src, dest) {
  await fsp.mkdir(dest, { recursive: true });
  const entries = await fsp.readdir(src, { withFileTypes: true });
  for (const entry of entries) {
    const s = path.join(src, entry.name);
    const d = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      await copyDir(s, d);
    } else if (entry.isFile()) {
      await fsp.copyFile(s, d);
    }
  }
}

async function removeIfExists(p) {
  if (!(await exists(p))) return;
  const stat = await fsp.lstat(p);
  if (stat.isSymbolicLink() || stat.isFile()) {
    await fsp.unlink(p);
  } else {
    await fsp.rm(p, { recursive: true, force: true });
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printHelp();
    return;
  }

  if (args.uninstall) {
    if (!(await exists(DEST_DIR))) {
      console.log(`ℹ️  설치된 스킬이 없습니다: ${DEST_DIR}`);
      return;
    }
    await removeIfExists(DEST_DIR);
    console.log(`🗑️  제거 완료: ${DEST_DIR}`);
    return;
  }

  if (!fs.existsSync(SRC_DIR)) {
    throw new Error(`소스 스킬 폴더를 찾을 수 없습니다: ${SRC_DIR}`);
  }
  if (!fs.existsSync(path.join(SRC_DIR, 'SKILL.md'))) {
    throw new Error(`SKILL.md가 없습니다: ${path.join(SRC_DIR, 'SKILL.md')}`);
  }

  await fsp.mkdir(DEST_ROOT, { recursive: true });

  if (await exists(DEST_DIR)) {
    if (!args.force) {
      console.error(`❌ 이미 설치되어 있습니다: ${DEST_DIR}`);
      console.error(`   덮어쓰려면 --force 옵션을 사용하세요.`);
      process.exit(1);
    }
    await removeIfExists(DEST_DIR);
  }

  if (args.link) {
    await fsp.symlink(SRC_DIR, DEST_DIR, 'dir');
    console.log(`🔗 심볼릭 링크 생성: ${DEST_DIR} → ${SRC_DIR}`);
  } else {
    await copyDir(SRC_DIR, DEST_DIR);
    console.log(`📦 파일 복사 완료: ${DEST_DIR}`);
  }

  console.log();
  console.log('✅ Claude Code 스킬 설치 완료!');
  console.log();
  console.log('다음 단계:');
  console.log('  1. Claude Code를 재시작하거나 새 세션을 여세요.');
  console.log('  2. "내 Claude 사용량 측정해줘" 같은 요청으로 스킬이 발동됩니다.');
}

main().catch((err) => {
  console.error('❌ 오류:', err.message);
  process.exit(1);
});
