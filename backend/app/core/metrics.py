"""Bounded in-process HTTP histograms; labels are route templates, never request IDs or query values."""

from collections import defaultdict
from threading import Lock

lock = Lock()
counters = defaultdict(int)
sums = defaultdict(float)
buckets = defaultdict(lambda: [0] * 6)
bounds = [0.05, 0.1, 0.25, 0.5, 1.0, 5.0]


def record(route: str, status: int, seconds: float) -> None:
    key = (route, status)
    with lock:
        counters[key] += 1
        sums[key] += seconds
        for index, bound in enumerate(bounds):
            if seconds <= bound:
                buckets[key][index] += 1


def render() -> str:
    import json

    lines = ["# TYPE insta_http_requests_total counter", "# TYPE insta_http_duration_seconds histogram"]
    with lock:
        for (route, status), count in counters.items():
            labels = f'route={json.dumps(route)},status="{status}"'
            lines.append(f"insta_http_requests_total{{{labels}}} {count}")
            for index, bound in enumerate(bounds):
                lines.append(
                    f'insta_http_duration_seconds_bucket{{{labels},le="{bound}"}} {buckets[(route, status)][index]}'
                )
            lines.extend(
                [
                    f'insta_http_duration_seconds_bucket{{{labels},le="+Inf"}} {count}',
                    f"insta_http_duration_seconds_count{{{labels}}} {count}",
                    f"insta_http_duration_seconds_sum{{{labels}}} {sums[(route, status)]}",
                ]
            )
    return "\n".join(lines) + "\n"


def record_job(kind: str, seconds: float) -> None:
    if kind not in {"connect", "sync", "import", "comparison", "export", "parsing"}:
        return
    from redis import Redis

    from app.core.config import get_settings

    try:
        connection = Redis.from_url(get_settings().redis_url, socket_connect_timeout=1, socket_timeout=1)
        connection.eval(
            "redis.call('HINCRBY',KEYS[1],'count',1);redis.call('HINCRBY',KEYS[1],'microseconds',ARGV[1]);return 1",
            1,
            "metrics:job:" + kind,
            int(max(0, seconds) * 1000000),
        )
    except Exception:
        pass
