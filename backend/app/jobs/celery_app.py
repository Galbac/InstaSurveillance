from celery import Celery
from celery.signals import heartbeat_sent

from app.core.config import get_settings
from app.core.logging import configure

configure()

celery = Celery(
    "instasurveillance",
    broker=get_settings().celery_broker_url or get_settings().redis_url,
    include=["app.jobs.tasks"],
)
celery.conf.update(
    task_serializer="json",
    accept_content=["json"],
    result_serializer="json",
    task_ignore_result=True,
    task_acks_late=True,
    task_reject_on_worker_lost=True,
    broker_connection_retry_on_startup=True,
    worker_prefetch_multiplier=1,
    task_time_limit=1800,
    task_soft_time_limit=1200,
    task_routes={
        "app.jobs.tasks.dispatch": {"queue": "maintenance"},
        "app.jobs.tasks.schedule": {"queue": "maintenance"},
    },
    beat_schedule={
        "outbox": {"task": "app.jobs.tasks.dispatch", "schedule": 3.0},
        "schedule": {"task": "app.jobs.tasks.schedule", "schedule": 60.0},
    },
)


# Bounded operational heartbeat, no hostname/account identifiers in metrics labels.


@heartbeat_sent.connect
def operational_heartbeat(**kwargs):
    import os

    from redis import Redis

    kind = os.environ.get("WORKER_KIND", "default")
    if kind not in {"default", "auth", "maintenance"}:
        return
    try:
        Redis.from_url(get_settings().redis_url, socket_connect_timeout=1, socket_timeout=1).set(
            "worker:alive:" + kind, "1", ex=90
        )
    except Exception:
        pass
