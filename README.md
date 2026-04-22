# claude-token-meter

Claude Code의 **월간 실질 토큰 사용량**을 측정하고,
공개된 참조점과 비교해 **세계 분포 상의 상대 위치(상위 %)**를 추정하는 CLI 도구입니다.

## 핵심 원칙

> **`cache_read`는 제외한다.**
> Anthropic 요금표에서 `cache_read`는 일반 입력의 **1/10 가격**으로, "재사용" 분량입니다.
> 공정한 비교를 위해 반드시 제외해야 합니다.

측정 대상 토큰:
```
effective = input_tokens + output_tokens + cache_creation_input_tokens
```

## 빠른 시작

```bash
# 별도 설치 없이 바로 실행
npx claude-token-meter

# 최근 7일만 집계
npx claude-token-meter --days 7

# JSON 출력 (자동화/대시보드용)
npx claude-token-meter --json > usage.json

# 로그 디렉토리 직접 지정
npx claude-token-meter --log-dir ~/custom/claude/projects
```

## 요구 사항

- Node.js 18 이상
- Claude Code가 한 번이라도 실행되어 `~/.claude/projects/` 디렉토리가 존재할 것

## Skill로 설치하기

`skill/` 폴더에는 이 도구를 Claude에 직접 "스킬"로 등록할 수 있는 Python 버전이 포함되어 있습니다.
스킬로 등록하면 `/claude-token-meter` 같은 명시적 호출 없이도
**"내 Claude 사용량 측정해줘"** 같은 자연어 요청으로 발동됩니다.

### Claude Code (CLI)에 설치

```bash
# 파일 복사 방식 (권장)
npm run install:code

# 또는 개발 중이라 스킬을 자주 수정한다면 심볼릭 링크 방식
node bin/install-claude-code.js --link

# 기존 설치를 덮어쓰려면
node bin/install-claude-code.js --force

# 제거
npm run uninstall:code
```

설치 위치: `~/.claude/skills/claude-token-meter/`
설치 후 새 Claude Code 세션을 열면 스킬이 자동으로 로드됩니다.

### Claude Desktop 앱에 설치

Claude Desktop은 스킬을 `.zip` 파일로 업로드하는 방식을 사용합니다.

```bash
# 업로드용 zip 생성 (dist/claude-token-meter-skill.zip)
npm run install:desktop

# macOS에서 Finder로 zip 위치 바로 열기
node bin/install-claude-desktop.js --open
```

생성된 zip 파일을 Claude Desktop 앱에서 업로드합니다:

1. Claude Desktop 앱 실행
2. 설정(Settings) → **Capabilities** → **Skills**
3. **Add Skill** 버튼 → `dist/claude-token-meter-skill.zip` 선택
4. 업로드 후 자연어로 사용량 측정 요청

> **참고**: Claude Desktop에서 Skills 메뉴가 보이지 않으면 앱을 최신 버전으로 업데이트하거나
> 설정의 실험적 기능/Capabilities 토글을 확인하세요.

## 출력 예시

```
==================================================================
  🧪 Claude Token Meter — 측정 결과
==================================================================

📁 스캔한 파일       : 127개
💬 집계한 메시지     : 4,832개
📅 측정 기간         : 최근 30일

──────────────────────────────────────────────────────────────────
  📊 토큰 분류별 합계
──────────────────────────────────────────────────────────────────
  input               : 12.30M (12,300,000)
  output              : 8.50M (8,500,000)
  cache_creation      : 223.20M (223,200,000)
  cache_read          : 7.520B (7,520,000,000)  ← 비교에서 제외
  ─────────────────────────
  총합                : 7.764B (7,764,000,000)
  cache_read 비율     : 96.9%

──────────────────────────────────────────────────────────────────
  ✅ 실질 사용량 (세계 비교용)
──────────────────────────────────────────────────────────────────
  effective = input + output + cache_creation
  = 244.00M (244,000,000)

──────────────────────────────────────────────────────────────────
  🌍 세계 분포에서의 위치 (추정)
──────────────────────────────────────────────────────────────────
  Max 20x 헤비층 대비 : 2.44배
  세계 상위 추정      : 약 5.4%
```

## 측정 방법론

### 4개 참조점

| 참조점 | 월 토큰 | 상위 % | 출처 |
|--------|---------|--------|------|
| Max 일반 유저 | 10M | 50% | Anthropic 헬프센터 |
| Max 20x 헤비층 | 100M | 10% | Anthropic 헬프센터 |
| 공개 자가신고 (mrz) | 3.2B | 1% | Threads 자가신고 |
| 공개 자가신고 (alairjt) | 17.4B | 0.5% | dev.to 공개 |

### 보간 방식

4점 사이를 **로그-로그 공간에서 선형 보간**합니다.
즉, `log(토큰) ↔ log(상위 %)` 평면에서 두 점 사이 직선 방정식을 사용합니다.

### 한계

1. 4점 기반 추정이므로 ±5% 편차 가능
2. 자가 신고자는 상위에 치우치므로 상위 % 추정은 보수적
3. Claude 단일 측정. ChatGPT/GitHub Copilot 등 병용 사용량 미포함
4. `cache_read` 포함/제외 정의가 비교 대상마다 다를 수 있음

## JSON 출력 스키마

```json
{
  "period_days": 30,
  "file_count": 127,
  "message_count": 4832,
  "tokens": {
    "input": 12300000,
    "output": 8500000,
    "cache_creation": 223200000,
    "cache_read": 7520000000,
    "grand_total": 7764000000,
    "effective": 244000000
  },
  "comparison": {
    "vs_max20x_heavy_multiplier": 2.44,
    "estimated_top_percentile": 5.4
  },
  "reference_points": [...],
  "disclaimers": [...]
}
```

## 데이터가 어디로도 전송되지 않습니다

이 도구는 **로컬에서만 동작**합니다.
네트워크 요청을 전혀 하지 않으며, 로그 파일을 외부로 전송하지 않습니다.
소스 코드는 전부 공개되어 있으니 직접 확인해 주세요.

## 라이선스

MIT
