#!/usr/bin/env node
/**
 * claude-token-meter 스킬을 Claude Desktop 앱에 설치할 수 있도록
 * 업로드용 .zip 파일을 생성합니다.
 *
 *   node bin/install-claude-desktop.js          # dist/claude-token-meter-skill.zip 생성
 *   node bin/install-claude-desktop.js --open   # 생성 후 Finder에서 해당 폴더 열기
 *
 * Claude Desktop은 스킬을 앱 UI의 Capabilities → Skills 화면에서
 * .zip 파일로 업로드하는 방식을 사용합니다.
 */

'use strict';

const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const { spawnSync } = require('child_process');

const SKILL_NAME = 'token-meter';
const SRC_DIR = path.resolve(__dirname, '..', 'skill');
const DIST_DIR = path.resolve(__dirname, '..', 'dist');
const ZIP_PATH = path.join(DIST_DIR, `${SKILL_NAME}-skill.zip`);

function parseArgs(argv) {
  const args = { open: false, help: false };
  for (const a of argv) {
    if (a === '--open') args.open = true;
    else if (a === '--help' || a === '-h') args.help = true;
  }
  return args;
}

function printHelp() {
  console.log(`
claude-token-meter 스킬을 Claude Desktop 앱용 .zip으로 패키징합니다.

사용법:
  node bin/install-claude-desktop.js [옵션]

옵션:
  --open        생성 후 Finder에서 dist 폴더 열기 (macOS)
  --help, -h    이 도움말 표시

생성 위치: ${ZIP_PATH}
`);
}

function buildZip() {
  const result = spawnSync(
    'zip',
    ['-r', '-q', ZIP_PATH, SKILL_NAME],
    { cwd: path.dirname(SRC_DIR), stdio: 'inherit' }
  );
  if (result.error) {
    throw new Error(`zip 명령 실행 실패: ${result.error.message}`);
  }
  if (result.status !== 0) {
    throw new Error(`zip 명령이 종료 코드 ${result.status}로 실패했습니다.`);
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printHelp();
    return;
  }

  if (!fs.existsSync(SRC_DIR)) {
    throw new Error(`소스 스킬 폴더를 찾을 수 없습니다: ${SRC_DIR}`);
  }
  if (!fs.existsSync(path.join(SRC_DIR, 'SKILL.md'))) {
    throw new Error(`SKILL.md가 없습니다: ${path.join(SRC_DIR, 'SKILL.md')}`);
  }

  // 폴더명이 SKILL_NAME과 달라도 zip 내부 이름은 SKILL_NAME이 되도록 임시 복사
  await fsp.mkdir(DIST_DIR, { recursive: true });

  const parent = path.dirname(SRC_DIR);
  const expectedPath = path.join(parent, SKILL_NAME);
  let usedTempRename = false;

  if (path.basename(SRC_DIR) !== SKILL_NAME) {
    if (fs.existsSync(expectedPath)) {
      throw new Error(`임시 경로가 이미 존재합니다: ${expectedPath}`);
    }
    await fsp.symlink(SRC_DIR, expectedPath, 'dir');
    usedTempRename = true;
  }

  try {
    if (fs.existsSync(ZIP_PATH)) await fsp.unlink(ZIP_PATH);
    buildZip();
  } finally {
    if (usedTempRename) {
      try { await fsp.unlink(expectedPath); } catch {}
    }
  }

  const stat = await fsp.stat(ZIP_PATH);
  console.log(`📦 패키지 생성 완료: ${ZIP_PATH} (${(stat.size / 1024).toFixed(1)} KB)`);
  console.log();
  console.log('✅ Claude Desktop 업로드용 .zip 파일이 준비되었습니다!');
  console.log();
  console.log('다음 단계:');
  console.log('  1. Claude Desktop 앱을 엽니다.');
  console.log('  2. 설정(Settings) → Capabilities → Skills로 이동합니다.');
  console.log('  3. "Add Skill" 또는 업로드 버튼을 눌러 아래 파일을 선택합니다:');
  console.log(`     ${ZIP_PATH}`);
  console.log('  4. 업로드 후 "내 Claude 사용량 측정해줘" 같은 요청으로 스킬이 발동됩니다.');
  console.log();
  console.log('참고: Claude Desktop의 Skills UI가 아직 활성화되어 있지 않다면,');
  console.log('      설정 화면의 실험적 기능 또는 Capabilities 토글을 먼저 확인하세요.');

  if (args.open) {
    spawnSync('open', [DIST_DIR], { stdio: 'inherit' });
  }
}

main().catch((err) => {
  console.error('❌ 오류:', err.message);
  process.exit(1);
});
