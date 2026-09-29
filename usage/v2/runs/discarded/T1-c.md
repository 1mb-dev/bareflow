# BackgroundTasks vs. Celery/ARQ

No documentation file was attached for this question, so everything below is [memory].

## The boundary

`BackgroundTasks` runs your function inside the same process as the web server, after the
response is sent, with no broker, no persistence, and no separate worker pool. [memory] That
makes it a good fit only when all four of these hold:

1. **Short duration** — the task finishes in roughly the same order of magnitude as a request
   (sub-second to a few seconds), not tens of seconds or minutes. [memory]
2. **No durability requirement** — it's acceptable for the task to be silently lost if the
   worker process restarts or is redeployed mid-task, since the task lives only in that
   process's memory, not in a broker. [memory]
3. **No retry/observability requirement** — if the task raises, FastAPI/Starlette just logs an
   unhandled exception; there's no built-in retry, backoff, dead-lettering, or status API to
   ask "is it done yet." [memory]
4. **No independent scaling need** — the task runs on whatever worker handled the request, so
   you can't scale task throughput separately from HTTP throughput, and CPU-bound work
   competes with the ASGI event loop for the same process's resources. [memory]

Video processing (transcoding, thumbnailing, format conversion) fails essentially all four:
it's long-running, must survive a deploy without being silently dropped, benefits from
retries on transient failures (codec errors, storage hiccups), and typically needs to scale
and be hardware-provisioned (CPU/GPU) independently of the API tier. That's the case for
Celery or ARQ, not `BackgroundTasks`. [memory]

### A sharper operational reason

If your task function is `async def`, it runs directly on the same event loop that serves
every other request on that worker — a CPU-bound `async def` task (e.g., doing video encoding
inline) will block that loop and stall unrelated requests until it finishes. [memory] If it's
a plain `def`, Starlette offloads it to a thread pool so it won't block the event loop, but it
still shares that worker's limited thread pool with any other blocking work (sync DB calls,
file I/O), so a slow task starves the rest. [memory] Neither path gives you the process
isolation that a dedicated worker (Celery/ARQ) gives you.

## Rule of thumb

- **`BackgroundTasks`**: fire-and-forget, sub-few-second work coupled to a single request —
  sending a confirmation email, writing an audit log line, invalidating a cache key. [memory]
- **Celery/ARQ**: anything CPU- or I/O-heavy enough to run for seconds-to-minutes-plus, where
  you need retries, durability across restarts, independent worker scaling, or a way to query
  job status/progress/result. Video processing belongs here. [memory]

## BackgroundTasks example (for the cases it does fit)

```python
from fastapi import BackgroundTasks, FastAPI

app = FastAPI()

def write_notification(email: str, message=""):
    with open("log.txt", mode="a") as f:
        f.write(f"notification for {email}: {message}\n")

@app.post("/send-notification/{email}")
async def send_notification(email: str, background_tasks: BackgroundTasks):
    background_tasks.add_task(write_notification, email, message="some notification")
    return {"message": "Notification sent in the background"}
```

This is the canonical use case FastAPI itself gives — logging/notification, not heavy
compute. [memory]

## ARQ example (asyncio-native, Redis-only, lighter weight than Celery)

```python
# worker.py
from arq import cron
from arq.connections import RedisSettings

async def process_video(ctx, video_id: str):
    # long-running, CPU-bound work happens in the worker process, not the API process
    ...
    return {"status": "done", "video_id": video_id}

class WorkerSettings:
    functions = [process_video]
    redis_settings = RedisSettings(host="localhost", port=6379)
    max_jobs = 4  # bound concurrent video jobs independently of API worker count
```

```python
# main.py
from arq import create_pool
from arq.connections import RedisSettings
from fastapi import FastAPI

app = FastAPI()

@app.on_event("startup")
async def startup():
    app.state.redis = await create_pool(RedisSettings())

@app.post("/videos/{video_id}/process")
async def process(video_id: str):
    job = await app.state.redis.enqueue_job("process_video", video_id)
    return {"job_id": job.job_id}
```

Run the worker separately: `arq worker.WorkerSettings`. [memory]

## Celery example (broader ecosystem, more brokers, heavier setup)

```python
# tasks.py
from celery import Celery

celery_app = Celery("app", broker="redis://localhost:6379/0", backend="redis://localhost:6379/1")

@celery_app.task(bind=True, max_retries=3, default_retry_delay=30)
def process_video(self, video_id: str):
    try:
        ...  # transcoding logic runs in a Celery worker process
    except TransientEncodeError as exc:
        raise self.retry(exc=exc)
    return {"status": "done", "video_id": video_id}
```

```python
# main.py
from fastapi import FastAPI
from celery.result import AsyncResult
from tasks import process_video, celery_app

app = FastAPI()

@app.post("/videos/{video_id}/process")
def process(video_id: str):
    task = process_video.delay(video_id)
    return {"task_id": task.id}

@app.get("/tasks/{task_id}")
def task_status(task_id: str):
    result = AsyncResult(task_id, app=celery_app)
    return {"state": result.state, "result": result.result if result.ready() else None}
```

Run workers separately: `celery -A tasks worker --loglevel=info`. [memory]

## ARQ vs. Celery, briefly

ARQ is asyncio-native and Redis-only — simpler to run alongside an async FastAPI app, fewer
moving parts, less mature ecosystem/tooling. [memory] Celery supports multiple brokers
(RabbitMQ, Redis, others), has a larger feature set (periodic tasks via Celery Beat, task
chaining/canvas, Flower for monitoring), and is more operationally heavyweight. [memory] For
video processing specifically, either works; the choice is usually driven by whether you
already run Redis-only infra (favor ARQ) or need Celery's broker flexibility and mature
monitoring tooling (favor Celery). [memory]
