# BackgroundTasks vs. Celery/ARQ for long-running work

No documentation file was attached to this task, so every claim below is marked [memory].

## The boundary

FastAPI's `BackgroundTasks` runs the callable in the same worker process as the request handler, after the response has been sent — sync functions go to a threadpool, async functions run on the same event loop [memory]. It has no broker, no persistence, no retry, and no job-status mechanism of its own [memory]. FastAPI's own docs on the feature draw the line explicitly: if the work needs "heavy background computation" or doesn't need to run in the same process (no shared memory/variables required), reach for a bigger tool like Celery instead [memory].

In practice the boundary comes down to five questions. Video processing (transcoding, thumbnailing, ffmpeg-driven work) answers "queue" on all five:

| Question | BackgroundTasks | Task queue (Celery/ARQ) |
|---|---|---|
| Duration | Sub-second to a few seconds | Seconds to minutes/hours — matches video encoding [memory] |
| Resource profile | Light I/O (send an email, write an audit log, fire a webhook) | CPU/memory-heavy work that would starve the web process's event loop or threadpool if run in-process [memory] |
| Durability | OK to silently lose the task on crash/redeploy | Must survive a restart; broker (Redis/RabbitMQ) persists the job so a deploy doesn't drop a user's upload [memory] |
| Status/observability | Client doesn't need to poll for progress | Client needs a job id to poll ("queued" -> "processing" -> "done"/"failed") — BackgroundTasks exposes nothing to poll, so you'd have to build this yourself anyway, at which point you've built half a task queue [memory] |
| Scaling | Fine coupled to web-tier scaling | Want to scale worker count (or worker hardware, e.g. more CPU/GPU) independently of API replica count [memory] |

Retries matter too: an uncaught exception in a `BackgroundTasks` callable is just logged — there's no backoff/retry, so a transient ffmpeg failure kills the job outright. Celery and ARQ both give you retry-with-backoff and dead-letter handling as first-class features [memory].

## Practical shape for video processing

1. Endpoint accepts the upload, writes a job row (status `queued`) to your DB, enqueues the task (`task.delay(...)` for Celery, `pool.enqueue_job(...)` for ARQ), and returns `202 Accepted` with the job id — it does not wait on the encode [memory].
2. A separate worker process (`celery -A app worker`, or `arq app.WorkerSettings`) does the actual ffmpeg/transcode work, updating job status and writing the output location when done [memory].
3. Client polls (or gets pushed, via websocket/webhook) the job status endpoint until it flips to `done`/`failed` [memory].

## Celery vs. ARQ, briefly

Celery is the heavier, more mature option: broader broker support (RabbitMQ, Redis, SQS), scheduling (`celery beat`), monitoring tooling (Flower), but more operational surface to run [memory]. ARQ is asyncio-native, Redis-only, and built by the same author as Pydantic — it fits FastAPI's async style more directly and is lighter to operate, but has a smaller ecosystem than Celery [memory]. Either clears the bar BackgroundTasks can't for video-processing-scale work; the choice between them is about ops overhead and async-native fit, not correctness.

## The anti-pattern to flag

Kicking off `ffmpeg` via `subprocess.Popen`/`asyncio.create_subprocess_exec` from inside a `BackgroundTasks` callable is a common shortcut, but it inherits every limitation above: it still shares the web process's resource envelope, has no retry, and a Uvicorn worker reload/restart can orphan or kill the subprocess mid-encode [memory]. If you find yourself doing this, it's the signal to move to a real queue.
