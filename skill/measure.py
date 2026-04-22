#!/usr/bin/env python3
"""
Claude Token Meter
~/.claude/projects/ 아래의 JSONL 로그를 스캔하여
월간 실질 토큰 사용량과 세계 분포에서의 상대 위치를 추정합니다.

사용법:
    python3 measure.py
    python3 measure.py --days 30
    python3 measure.py --log-dir ~/custom/claude/projects
    python3 measure.py --json

외부 의존성: 없음 (Python 3.8+ 표준 라이브러리만 사용)
"""

import argparse
import json
import math
import os
import sys
from collections import defaultdict
from datetime import datetime, timedelta, timezone
from pathlib import Path


# ───────────────────────────────────────────────────────────────
# 기준점 (Reference Points)
# 공식 2점 + 공개 자가 신고 2점 = 총 4점
# ───────────────────────────────────────────────────────────────
REFERENCE_POINTS = [
    # (월간 토큰, 상위 %, 라벨)
    (10_000_000, 50.0, "Max 일반 유저"),
    (100_000_000, 10.0, "Max 20x 헤비층"),
    (3_200_000_000, 1.0, "공개 자가신고 (mrz)"),
    (17_400_000_000, 0.5, "공개 자가신고 (alairjt)"),
]

MAX_HEAVY_TOKENS = 100_000_000  # Max 20x 헤비층 기준


def find_log_dir(custom_dir: str = None) -> Path:
    """Claude Code 로그 디렉토리를 찾는다."""
    if custom_dir:
        p = Path(custom_dir).expanduser()
        if not p.exists():
            print(f"❌ 지정된 경로가 존재하지 않습니다: {p}", file=sys.stderr)
            sys.exit(1)
        return p

    default = Path.home() / ".claude" / "projects"
    if not default.exists():
        print(f"❌ Claude 로그 디렉토리를 찾을 수 없습니다: {default}", file=sys.stderr)
        print("   Claude Code가 설치되어 있고 한 번이라도 사용했는지 확인해주세요.", file=sys.stderr)
        sys.exit(1)
    return default


def iter_jsonl_files(log_dir: Path):
    """로그 디렉토리의 모든 .jsonl 파일을 순회한다."""
    for path in log_dir.rglob("*.jsonl"):
        if path.is_file():
            yield path


def parse_timestamp(ts_str: str):
    """타임스탬프 문자열을 datetime으로 파싱한다."""
    try:
        # ISO 형식 (Z 표기 포함)
        if ts_str.endswith("Z"):
            ts_str = ts_str[:-1] + "+00:00"
        return datetime.fromisoformat(ts_str)
    except (ValueError, TypeError):
        return None


def extract_usage(entry: dict):
    """
    JSONL 한 줄에서 usage 정보를 추출한다.
    Claude Code의 로그 포맷은 버전에 따라 다를 수 있으므로 방어적으로 처리.
    """
    # 패턴 1: entry["message"]["usage"]
    msg = entry.get("message", {})
    if isinstance(msg, dict):
        usage = msg.get("usage")
        if isinstance(usage, dict):
            return usage

    # 패턴 2: entry["usage"] (직접)
    usage = entry.get("usage")
    if isinstance(usage, dict):
        return usage

    return None


def scan_logs(log_dir: Path, days: int):
    """
    로그를 스캔해서 기간별 토큰 합계를 반환한다.
    """
    cutoff = datetime.now(timezone.utc) - timedelta(days=days)

    totals = defaultdict(int)  # input, output, cache_creation, cache_read
    message_count = 0
    file_count = 0
    error_count = 0

    for jsonl_path in iter_jsonl_files(log_dir):
        file_count += 1
        try:
            with open(jsonl_path, "r", encoding="utf-8") as f:
                for line in f:
                    line = line.strip()
                    if not line:
                        continue
                    try:
                        entry = json.loads(line)
                    except json.JSONDecodeError:
                        error_count += 1
                        continue

                    # 타임스탬프 체크
                    ts_str = entry.get("timestamp")
                    if not ts_str:
                        continue
                    ts = parse_timestamp(ts_str)
                    if ts is None:
                        continue
                    # timezone-naive 대응
                    if ts.tzinfo is None:
                        ts = ts.replace(tzinfo=timezone.utc)
                    if ts < cutoff:
                        continue

                    usage = extract_usage(entry)
                    if not usage:
                        continue

                    totals["input"] += int(usage.get("input_tokens", 0) or 0)
                    totals["output"] += int(usage.get("output_tokens", 0) or 0)
                    totals["cache_creation"] += int(
                        usage.get("cache_creation_input_tokens", 0) or 0
                    )
                    totals["cache_read"] += int(
                        usage.get("cache_read_input_tokens", 0) or 0
                    )
                    message_count += 1
        except (IOError, OSError) as e:
            print(f"⚠️  파일 읽기 실패: {jsonl_path.name}: {e}", file=sys.stderr)
            error_count += 1

    return {
        "totals": dict(totals),
        "message_count": message_count,
        "file_count": file_count,
        "error_count": error_count,
        "period_days": days,
    }


def estimate_percentile(effective_tokens: int) -> float:
    """
    4점 기반 로그 보간으로 상위 % 추정.
    log(토큰) ↔ log(상위 %) 공간에서 선형 보간.
    """
    if effective_tokens <= 0:
        return 99.9

    pts = sorted(REFERENCE_POINTS, key=lambda x: x[0])

    # 범위 밖 처리
    if effective_tokens <= pts[0][0]:
        # 최소점 이하: 대략적 추정
        ratio = effective_tokens / pts[0][0]
        # 상위 % = 50% 이상 (더 아래)
        return min(99.0, 50.0 + (1 - ratio) * 40.0)

    if effective_tokens >= pts[-1][0]:
        return pts[-1][1]

    # 두 점 사이에서 로그 선형 보간
    for i in range(len(pts) - 1):
        x0, y0, _ = pts[i]
        x1, y1, _ = pts[i + 1]
        if x0 <= effective_tokens <= x1:
            log_x = math.log10(effective_tokens)
            log_x0 = math.log10(x0)
            log_x1 = math.log10(x1)
            log_y0 = math.log10(y0)
            log_y1 = math.log10(y1)
            t = (log_x - log_x0) / (log_x1 - log_x0)
            log_y = log_y0 + t * (log_y1 - log_y0)
            return 10 ** log_y

    return 50.0  # fallback


def format_number(n: int) -> str:
    """숫자를 읽기 좋은 형태로 포맷."""
    if n >= 1_000_000_000:
        return f"{n/1_000_000_000:.3f}B ({n:,})"
    if n >= 1_000_000:
        return f"{n/1_000_000:.2f}M ({n:,})"
    if n >= 1_000:
        return f"{n/1_000:.1f}K ({n:,})"
    return f"{n:,}"


def print_report(scan_result: dict):
    """측정 결과를 사람이 읽기 좋게 출력."""
    totals = scan_result["totals"]
    days = scan_result["period_days"]

    input_t = totals.get("input", 0)
    output_t = totals.get("output", 0)
    cache_create = totals.get("cache_creation", 0)
    cache_read = totals.get("cache_read", 0)
    grand_total = input_t + output_t + cache_create + cache_read
    effective = input_t + output_t + cache_create

    cache_read_ratio = (cache_read / grand_total * 100) if grand_total > 0 else 0
    multiplier_vs_max20x = effective / MAX_HEAVY_TOKENS if MAX_HEAVY_TOKENS > 0 else 0
    percentile = estimate_percentile(effective)

    print("=" * 66)
    print("  🧪 Claude Token Meter — 측정 결과")
    print("=" * 66)
    print()
    print(f"📁 스캔한 파일       : {scan_result['file_count']:,}개")
    print(f"💬 집계한 메시지     : {scan_result['message_count']:,}개")
    print(f"📅 측정 기간         : 최근 {days}일")
    if scan_result["error_count"] > 0:
        print(f"⚠️  파싱 오류        : {scan_result['error_count']}건")
    print()
    print("─" * 66)
    print("  📊 토큰 분류별 합계")
    print("─" * 66)
    print(f"  input               : {format_number(input_t)}")
    print(f"  output              : {format_number(output_t)}")
    print(f"  cache_creation      : {format_number(cache_create)}")
    print(f"  cache_read          : {format_number(cache_read)}  ← 비교에서 제외")
    print(f"  ─────────────────────────")
    print(f"  총합                : {format_number(grand_total)}")
    print(f"  cache_read 비율     : {cache_read_ratio:.1f}%")
    print()
    print("─" * 66)
    print("  ✅ 실질 사용량 (세계 비교용)")
    print("─" * 66)
    print(f"  effective = input + output + cache_creation")
    print(f"  = {format_number(effective)}")
    print()
    print("─" * 66)
    print("  🌍 세계 분포에서의 위치 (추정)")
    print("─" * 66)
    print(f"  Max 20x 헤비층 대비 : {multiplier_vs_max20x:.2f}배")
    print(f"  세계 상위 추정      : 약 {percentile:.1f}%")
    print()
    print("  [참조점]")
    for tokens, pct, label in REFERENCE_POINTS:
        marker = " ← 당신의 위치" if abs(math.log10(max(effective, 1)) - math.log10(tokens)) < 0.15 else ""
        print(f"    • {label:30s} : {format_number(tokens):30s}  (상위 {pct}%){marker}")
    print()
    print("─" * 66)
    print("  ⚠️  측정의 한계 (반드시 함께 읽어주세요)")
    print("─" * 66)
    print("  1. 4개 참조점 기반 추정이라 ±5% 편차 가능")
    print("  2. 공개 자가신고자는 상위에 치우침 → 상위 % 추정은 보수적")
    print("  3. Claude 단일 측정. ChatGPT/Copilot 등 타 AI는 미포함")
    print("  4. cache_read 포함/제외 정의는 비교 대상마다 다를 수 있음")
    print()
    print("=" * 66)


def print_json(scan_result: dict):
    """JSON 형태로 출력 (자동화/대시보드용)."""
    totals = scan_result["totals"]
    input_t = totals.get("input", 0)
    output_t = totals.get("output", 0)
    cache_create = totals.get("cache_creation", 0)
    cache_read = totals.get("cache_read", 0)
    effective = input_t + output_t + cache_create

    result = {
        "period_days": scan_result["period_days"],
        "file_count": scan_result["file_count"],
        "message_count": scan_result["message_count"],
        "tokens": {
            "input": input_t,
            "output": output_t,
            "cache_creation": cache_create,
            "cache_read": cache_read,
            "grand_total": input_t + output_t + cache_create + cache_read,
            "effective": effective,
        },
        "comparison": {
            "vs_max20x_heavy_multiplier": round(effective / MAX_HEAVY_TOKENS, 3)
            if MAX_HEAVY_TOKENS > 0 else None,
            "estimated_top_percentile": round(estimate_percentile(effective), 2),
        },
        "reference_points": [
            {"label": label, "tokens": tokens, "top_percentile": pct}
            for tokens, pct, label in REFERENCE_POINTS
        ],
        "disclaimers": [
            "4점 기반 추정으로 ±5% 오차 가능",
            "공개 자가신고자는 상위에 치우쳐 상위 % 추정은 보수적",
            "Claude 단일 측정이며 타 AI 도구 사용량 미포함",
            "cache_read 포함/제외 정의는 비교 대상마다 다를 수 있음",
        ],
    }
    print(json.dumps(result, indent=2, ensure_ascii=False))


def main():
    parser = argparse.ArgumentParser(
        description="Claude Code 월간 실질 토큰 사용량 측정기",
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    parser.add_argument(
        "--days",
        type=int,
        default=30,
        help="측정 기간 (일 단위, 기본값: 30)",
    )
    parser.add_argument(
        "--log-dir",
        type=str,
        default=None,
        help="Claude 로그 디렉토리 경로 (기본: ~/.claude/projects)",
    )
    parser.add_argument(
        "--json",
        action="store_true",
        help="JSON 형태로 출력 (자동화용)",
    )
    args = parser.parse_args()

    log_dir = find_log_dir(args.log_dir)
    if not args.json:
        print(f"🔍 로그 스캔 중: {log_dir}")
        print()

    scan_result = scan_logs(log_dir, args.days)

    if args.json:
        print_json(scan_result)
    else:
        print_report(scan_result)


if __name__ == "__main__":
    main()
