# BackgroundTasks vs. Celery/ARQ for long-running work (e.g. video processing)

## What the FastAPI docs say

FastAPI's own docs state the boundary directly, in the "Caveat" section of the Background Tasks page:

> "If you need to perform heavy background computation and you don't necessarily need it to be run by the same process (for example, you don't need to share memory, variables, etc), you might benefit from using other bigger tools like Celery." [doc]

> "They tend to require more complex configurations, a message/job queue manager, like RabbitMQ or Redis, but they allow you to run background tasks in multiple processes, and especially, in multiple servers." [doc]

> "But if you need to access variables and objects from the same FastAPI app, or you need to perform small background tasks (like sending an email notification), you can simply just use BackgroundTasks." [doc]

So the docs' own line is drawn on two axes: (1) does the task need to share memory/state with the running app process, and (2) is it "small" (their example is an email notification) versus "heavy computation." [doc] `BackgroundTasks` itself is Starlette's `BackgroundTasks` class, executed in the same process, after the response is sent, and it accepts either an `async def` or a plain `def` function [doc] — there is nothing in the API about persistence, retries, distributed workers, or multiple servers; that's the implicit reason the docs point elsewhere for "heavy" work. [doc]

## Why that boundary matters concretely for video processing

The docs don't mention video specifically, but the underlying constraints map onto it directly:

- **No persistence / no crash safety.** A `BackgroundTasks` job lives only in the memory of the worker process that accepted the request. If that process restarts (deploy, crash, autoscaler recycle, OOM from a heavy encode) mid-task, the job is silently gone — no record, no retry. A message-queue-backed system (Celery with Redis/RabbitMQ, or ARQ with Redis) persists the job in the broker, so a worker restart just means another worker (or the same one on restart) picks it back up. [memory]
- **No retry or backoff semantics.** Video encoding fails for mundane operational reasons (transient S3/network errors, codec edge cases, out-of-memory on one worker). `BackgroundTasks` gives you nothing here — you'd hand-roll try/except and re-invocation logic. Celery and ARQ both have retry/backoff as first-class primitives. [memory]
- **No independent scaling.** Video transcoding is CPU- (or GPU-) heavy and often minutes long. Running it via `BackgroundTasks` means it competes for the same process/thread pool that's also serving HTTP requests, so a burst of uploads degrades API latency for unrelated requests. A task queue lets you run a separate fleet of workers (sized for CPU/GPU, scaled independently of the API tier) with the API only enqueuing lightweight messages. [memory] This is effectively what the docs mean by "multiple processes, and especially, in multiple servers." [doc]
- **No concurrency control / backpressure.** `BackgroundTasks` has no built-in limit on how many tasks run at once — the docs describe adding tasks, not throttling them. [doc] Enough concurrent uploads can exhaust memory/CPU on the API host itself. Task queues bound concurrency by worker count/pool size, which naturally provides backpressure. [memory]
- **No status/progress tracking or cancellation.** Video jobs typically need a "processing / done / failed" status (and often progress %) that a client polls or subscribes to. Celery has a result backend for this out of the box; ARQ stores job results/status in Redis. With `BackgroundTasks` you'd build and maintain that state table yourself regardless — which erodes most of the simplicity argument for using it in the first place. [memory]

## The practical rule of thumb

Use `BackgroundTasks` when **all** of these hold [memory, synthesizing the doc's stated boundary]:
- The work is short (roughly sub-second to a handful of seconds; the docs' own example is firing off a single email send). [doc]
- It's fine for the task to vanish if the process restarts — no durability requirement.
- It needs direct access to in-process objects/state (e.g., something already loaded in the FastAPI app's memory) rather than being fully expressible as serializable arguments. [doc]
- You don't need retries, scheduling, progress reporting, or to scale the work independently of the web tier.

Reach for Celery or ARQ once **any** of these apply — which is essentially always true for video processing [memory]:
- The job can run from minutes to hours.
- A failure should be retried rather than silently dropped.
- You want to scale workers (possibly on different, more powerful/GPU hardware) independently of your API replicas.
- You need a durable job record: status, progress, result, cancellation.
- The job must survive an API deploy or restart while in flight.

## Celery vs. ARQ, briefly

Not covered in the attached doc — from general knowledge: [memory]
- **ARQ** is asyncio-native, needs only Redis (no separate broker choice to make), and integrates naturally with an async FastAPI codebase — you `await` the enqueue call and write worker functions as `async def`. Lighter operationally; smaller ecosystem.
- **Celery** is broker-agnostic (Redis or RabbitMQ), more mature, with richer scheduling (`celery beat`), routing, and monitoring (Flower) — but its worker model is synchronous/thread- or process-based by default, so calling it from `async def` endpoints means using it as a black box behind `.delay()`/`.apply_async()` rather than awaiting anything natively.

For a video-processing pipeline specifically, either works; the choice usually comes down to whether the rest of the stack is async-first (favors ARQ) or you need Celery's broader tooling (scheduled jobs, multiple queues/priorities, existing operational familiarity).

## Minimal shape of the alternative (illustrative, not run)

```python
# API process: just enqueue and return immediately
from arq import create_pool
from arq.connections import RedisSettings

@app.post("/videos/{video_id}/process")
async def process_video(video_id: str):
    redis = await create_pool(RedisSettings())
    await redis.enqueue_job("transcode_video", video_id)
    return {"status": "queued", "video_id": video_id}

# worker.py: separate process/fleet, scaled independently
async def transcode_video(ctx, video_id: str):
    # long-running ffmpeg/encode work here, with its own retry policy
    ...

class WorkerSettings:
    functions = [transcode_video]
    redis_settings = RedisSettings()
    max_tries = 3  # retry semantics BackgroundTasks doesn't offer
```

This is the structural difference the doc's caveat is gesturing at: the API only ever does a fast, in-memory-cheap enqueue, and the actual "heavy background computation" runs in a separately deployed, separately scaled, retry-capable worker. [doc + memory]
