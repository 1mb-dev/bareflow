# FastAPI BackgroundTasks vs. Celery/ARQ: where's the boundary?

## The rule from FastAPI's own docs

The attached page (FastAPI's Background Tasks tutorial) states the boundary directly in its "Caveat" section [doc]:

- If you need to perform heavy background computation and don't necessarily need it to run in the same process (i.e., you don't need to share memory/variables with the request-handling process), you'll likely benefit from a bigger tool like Celery [doc].
- Those tools need more setup -- a message/job queue broker like RabbitMQ or Redis -- but in exchange let you run background tasks across multiple processes, and especially across multiple servers [doc].
- If you only need to access variables/objects from the same FastAPI app, or the task is small (the doc's own example: sending an email notification), plain `BackgroundTasks` is enough [doc].

So FastAPI's own line is: same-process + small work -> `BackgroundTasks`. Cross-process/cross-server + heavy work -> a real queue.

Supporting details from the doc: `BackgroundTasks` is Starlette's `BackgroundTask` re-exported by FastAPI [doc], the task function can be `async def` or plain `def` [doc], and it runs *after* the response is returned to the client [doc] -- it's a "fire something once the response is on the wire" mechanism, not a job system.

## Why video processing falls on the queue side

The doc doesn't mention video specifically, but applying its stated boundary to that case [memory]:

- A `BackgroundTasks` job runs in the same process, on the same worker, that handled the HTTP request -- there's no separate pool it hands off to [memory, following from the doc's statement [doc] that it comes straight from `starlette.background` and executes in the request/response lifecycle].
- CPU/GPU-heavy encoding will either block the event loop (if declared `async def`) or eat a thread from the shared threadpool (if declared `def`), competing directly with the threads/loop serving live requests [memory].
- If the process restarts, redeploys, or crashes mid-job -- a real risk for something running minutes to hours -- the task is silently lost. There's no persistence, no retry [memory].
- It doesn't scale independently: with multiple Uvicorn/Gunicorn workers, a task is pinned to whichever worker took the request; there's no shared queue across workers or machines [doc, generalized from "multiple processes, and especially, in multiple servers" being what you *gain* by moving to Celery-class tools].
- No built-in progress reporting, dead-letter handling, concurrency limits, or job-status querying -- you'd hand-roll all of that on top of `BackgroundTasks` [memory].

Celery/ARQ solve each of these: a durable broker means jobs survive API restarts, workers scale independently of the API tier, retries/backoff are built in, and clients can poll job state (queued/started/succeeded/failed) [memory].

## Practical checklist

Use `BackgroundTasks` when all of these hold [memory, extrapolating the doc's stated conditions]:
- Work finishes in low single-digit seconds.
- Losing the task on a server restart is acceptable.
- No need for retries, progress reporting, or later status queries.
- One process is enough; you're not scaling job workers separately from API instances.
- The task needs direct access to in-process objects from the same running app [doc].

Move to Celery or ARQ when any of these hold [memory]:
- Runtime is long (video transcoding, large batch/ML jobs).
- The job must survive a deploy, restart, or crash.
- You need retries, rate limits, scheduling, or chained/dependent tasks.
- You want to scale workers horizontally, independent of API instance count.
- Clients need to poll progress or final status (e.g., "processing 40%").

Video processing typically fails several of these at once (long runtime, crash tolerance, progress reporting, independent scaling), which is why it's a canonical "use a queue" case rather than a BackgroundTasks case [memory].

## Celery vs. ARQ, briefly (not in the attached doc; from general knowledge [memory])

- **Celery**: mature, broker-agnostic (Redis or RabbitMQ), full feature set (Celery Beat for scheduling, chains/chords/groups for pipelines, multiple result backends), heavier to operate and configure.
- **ARQ**: Redis-only, asyncio-native, much smaller surface area -- a natural fit when your FastAPI app is already async and you don't need Celery's full pipeline/scheduling machinery.

## Sketch: video processing via a queue instead of BackgroundTasks

Illustrative only, not run/tested [memory]:

```python
# api.py -- enqueue only, return a job id immediately
from fastapi import FastAPI
from arq import create_pool
from arq.connections import RedisSettings

app = FastAPI()

@app.post("/videos/{video_id}/process")
async def process_video(video_id: str):
    redis = await create_pool(RedisSettings())
    job = await redis.enqueue_job("transcode_video", video_id)
    return {"job_id": job.job_id, "status": "queued"}

@app.get("/jobs/{job_id}")
async def job_status(job_id: str):
    redis = await create_pool(RedisSettings())
    job = Job(job_id, redis)
    return await job.status()
```

```python
# worker.py -- separate process/deployment, scales independently of the API
async def transcode_video(ctx, video_id: str):
    # long-running ffmpeg/GPU work; arq retries on failure per its job policy
    ...

class WorkerSettings:
    functions = [transcode_video]
    redis_settings = RedisSettings()
```

Compare against the doc's `BackgroundTasks` example [doc], which is deliberately small (writing one log line synchronously) -- the contrast in shape (fire-and-forget function call vs. enqueue + separate worker + status endpoint) is itself evidence of the boundary.

## Bottom line

FastAPI's own docs already draw the line at "same process, small work" vs. "cross-process/cross-server, heavy work" [doc]. Video processing is long-running, needs to survive restarts, and benefits from independent worker scaling and progress/status tracking -- so it belongs on Celery or ARQ, not `BackgroundTasks` [memory].
