---
name: claude-token-meter
description: Use this skill when the user wants to measure their monthly Claude Code token usage, calculate their position in the global distribution, or compare their usage against Anthropic's Max plan benchmarks. Triggers include phrases like "measure my Claude usage", "how many tokens did I use", "token meter", "Claude 사용량 측정", "내 토큰 몇 개 썼지", or when the user wants a fair apples-to-apples comparison that excludes cache_read tokens. Scans ~/.claude/projects/ JSONL logs and produces a percentile estimate against public data points.
---

# Claude Token Meter Skill

이 Skill은 Claude Code 유료 사용자의 **월간 실질 토큰 사용량**을 측정하고,
공개된 참조점(Anthropic 공식 가이드 + 공개 자가 신고 2명)과 비교해
**세계 분포에서의 상대 위치(상위 %)**를 추정합니다.

## 핵심 원칙

1. **cache_read는 제외한다** — Anthropic 요금표에서 cache_read는 일반 입력의 1/10 가격으로,
   "재사용" 분량이기 때문에 공정한 비교를 위해 반드시 제외해야 합니다.
2. **측정 대상 토큰 = input + output + cache_creation**
3. **최근 30일** 범위로 집계
4. **외부 의존 제로** — Python 표준 라이브러리만 사용

## 사용 방법

### Step 1: 스크립트 실행

```bash
python3 measure.py
```

사용자의 `~/.claude/projects/` 디렉토리 아래 모든 JSONL 로그를 스캔합니다.
로그 위치가 다른 경우 `--log-dir` 옵션으로 지정할 수 있습니다.

### Step 2: 출력 해석

스크립트는 다음 정보를 출력합니다:

- **총 토큰** (input, output, cache_creation, cache_read 각각)
- **실질 사용량** (cache_read 제외)
- **Max 20x 헤비층 대비 배수**
- **세계 상위 % 추정치**
- **경고 메시지** (측정 한계점 요약)

## 측정 로직 상세

### 토큰 카운팅

Claude Code의 JSONL 로그에는 각 assistant 메시지마다 다음 필드가 포함됩니다:

```json
{
  "message": {
    "usage": {
      "input_tokens": 123,
      "output_tokens": 456,
      "cache_creation_input_tokens": 789,
      "cache_read_input_tokens": 10000
    }
  },
  "timestamp": "2026-04-01T12:34:56.000Z"
}
```

실질 사용량은:
```
effective = input_tokens + output_tokens + cache_creation_input_tokens
```

### 퍼센타일 추정

4개 기준점을 로그 공간에서 선형 보간합니다:

| 참조점 | 월 토큰 | 상위 % (추정) |
|--------|---------|---------------|
| Max 일반 | 10M | 50% |
| Max 20x 헤비 | 100M | 10% |
| 공개 자가 신고 (mrz) | 3.2B | 1% |
| 공개 자가 신고 (alairjt) | 17.4B | 0.5% |

※ 이 곡선은 4점 기반이므로 ±5% 오차 가능.

## 한계와 주의사항

스크립트 실행 시 다음 경고를 반드시 함께 출력합니다:

- 4점 기반 추정이라 진짜 분포와 ±5% 편차 가능
- 공개 데이터는 상위에 치우치므로 상위 % 추정은 보수적
- 기타 사용자가 cache_read를 포함해 신고했다면 실제 순위는 더 높음
- Claude 단일 측정이며, ChatGPT/Copilot 등 타 AI 사용량은 포함되지 않음

## 사용자와의 대화 패턴

**사용자**: "내 Claude 사용량 얼마나 되는지 확인해줘"

**Claude의 응답 패턴**:
1. `measure.py`를 실행
2. 결과에서 핵심 숫자 추출 (실질 사용량, 상위 %)
3. Max 20x 헤비층 대비 배수로 직관적 맥락 제공
4. 한계점 3가지를 간결하게 함께 제시
5. 절대 과장하지 않음. 보수적으로 표현

**금지 사항**:
- "당신은 세계 0.5%!" 같은 낚시성 표현 금지
- cache_read 포함한 숫자로 비교하는 것 금지
- 샘플 수가 부족한 국가별 순위 추정 금지
