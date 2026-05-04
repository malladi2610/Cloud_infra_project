# Sync and Batch Execution Workflow Skeleton

This document describes a general workflow shape for building document-processing executions that can run in either `sync` mode or `batch` mode.

The same pattern can be used for summarization, extraction, classification, enrichment, or any task where each job produces a normalized result row.

## Core idea

A workflow should have one shared entry path and two execution paths:

1. `sync`: process one job immediately and return/update the result as soon as the model call finishes.
2. `batch`: queue jobs, claim a full batch window, submit all claimed jobs to the provider batch API, poll the batch, then persist each job result.

The important design goal is that both paths produce the same final result shape, even though they execute differently.

## Common entry path

Every execution should start with a common validation and context-building block.

Recommended steps:

1. Receive a request from the application/backend.
2. Validate the internal auth token.
3. Validate the required job fields.
4. Normalize `executionMode` to `sync` or `batch`.
5. Load runtime configuration from environment variables.
6. Build provider context such as model name, API key, pricing config, and completion window.
7. Route the job by execution mode.

Required input fields:

- `jobId`: unique job row to process or queue.
- `executionMode`: `sync` or `batch`.
- `batchStrategy`: queue strategy used for batch mode.

Recommended environment/config fields:

- `OPENAI_API_KEY`
- `OPENAI_MODEL`
- `OPENAI_BATCH_COMPLETION_WINDOW`
- `MAX_BATCH_SIZE`
- `MAX_WAIT_SECONDS`
- sync token prices
- batch token prices
- internal app/backend base URL
- internal auth token

## Execution mode split

After validation, the workflow should branch using `executionMode`.

If `executionMode == sync`:

- Run the sync path.

If `executionMode == batch`:

- Run the batch path.

This branch should be simple. It should only decide the execution type, not perform business logic.

## Sync execution path

The sync path is for immediate, one-job execution.

Recommended node/order pattern:

1. Mark the job as `processing`.
2. Prepare the provider input for that specific job.
3. Call the model API directly.
4. Parse the provider response.
5. Extract output text and token usage.
6. Calculate sync cost using sync pricing.
7. Upsert the result row.
8. Mark the job as `completed`.
9. If any step fails, mark the job as `failed` with an error message.

Typical status flow:

```text
queued -> processing -> completed
queued -> processing -> failed
```

Sync mode is useful when:

- The user expects a result immediately.
- The job count is small.
- Latency matters more than cost.
- The backend wants simple request/result behavior.

Sync mode should not try to group jobs. One workflow run should process one job.

## Batch execution path

The batch path is for delayed, lower-cost, multi-job execution.

Recommended node/order pattern:

1. Select candidate queued jobs.
2. Atomically claim a full batch window in the backend/database.
3. If no full batch is available, stop cleanly without failing the workflow.
4. Prepare one provider request per claimed job.
5. Build a JSONL batch input file.
6. Upload the batch input file.
7. Create the provider batch.
8. Persist provider batch IDs and move jobs to `processing`.
9. Poll the provider batch until terminal status or timeout.
10. Download the output file when the batch completes.
11. Parse each output line by `custom_id` or equivalent job correlation ID.
12. Upsert one result row per completed job.
13. Mark failed batch items individually where needed.
14. Mark the batch window as `completed`, `failed`, or `expired`.

Typical job status flow:

```text
queued -> batched -> processing -> completed
queued -> batched -> processing -> failed
queued -> batched -> processing -> expired
```

Typical batch window status flow:

```text
open/submitted -> processing -> completed
open/submitted -> processing -> failed
open/submitted -> processing -> expired
```

Batch mode is useful when:

- Many jobs can wait.
- Cost matters more than immediate latency.
- Work can be grouped into provider batch requests.
- The result can be collected asynchronously.

## Atomic batch claiming

Batch workflows must avoid duplicate job claiming.

The safest pattern is:

1. The workflow finds candidate queued jobs.
2. The workflow sends candidate IDs to the backend.
3. The backend claims jobs inside a single database transaction.
4. The backend uses row locking, for example `FOR UPDATE SKIP LOCKED`.
5. The backend creates the batch window and batch item rows.
6. The backend returns only the jobs it successfully claimed.

This prevents two workflow executions from picking the same queued jobs at the same time.

The workflow should not rely only on a plain SQL select followed by later updates. That creates a race condition when multiple workflow executions run together.

## Full-batch enforcement

If the configured batch size is `MAX_BATCH_SIZE=2`, the batch path should only submit when two jobs can be claimed.

If fewer jobs are available:

- The backend should reject the claim or return a no-work response.
- The workflow should stop cleanly.
- The remaining queued jobs should wait for enough future jobs.

This keeps the batch behavior predictable and avoids accidental partial batches.

## Has-work guard

The batch path should include a guard after the claim/preparation step.

If `hasBatch == true`:

- Continue to provider batch creation.

If `hasBatch == false`:

- Stop the workflow without creating a provider batch.

This is not an error condition. It means the queue is not ready yet.

## Provider batch creation

After a batch is prepared, create the provider batch using:

- uploaded input file ID
- target endpoint
- completion window
- metadata linking the provider batch to the internal batch window

The response should be parsed into:

- internal batch ID
- provider batch ID
- batch-created flag
- SQL or API payload needed to persist state

If provider batch creation fails:

- Mark the batch window as `failed`.
- Mark all jobs in that batch window as `failed`.
- Store a useful error message.

## Polling and result application

The polling block should:

1. Poll the provider batch status.
2. Stop on terminal states such as `completed`, `failed`, `expired`, or `cancelled`.
3. Respect workflow/task-runner timeout limits.
4. Download output files only after provider completion.
5. Parse provider output by job correlation ID.
6. Build database updates or call backend result-ingest APIs.

For completed items, persist:

- output text
- provider name
- model
- input tokens
- output tokens
- total tokens
- estimated cost
- raw provider response

For failed items, persist:

- job status `failed`
- error message
- completion timestamp

## Cost calculation

Sync and batch executions should use separate pricing configuration.

Sync cost:

```text
(input_tokens / 1_000_000 * sync_input_price)
+ (output_tokens / 1_000_000 * sync_output_price)
```

Batch cost:

```text
(input_tokens / 1_000_000 * batch_input_price)
+ (output_tokens / 1_000_000 * batch_output_price)
```

Do not use a multiplier if the provider exposes actual sync and batch prices. Store both sets of prices explicitly in environment variables.

## Final result contract

Both sync and batch mode should write the same final result fields.

Required completed-job fields:

- `jobId`
- `summaryText` or task-specific output text
- `provider`
- `model`
- `inputTokens`
- `outputTokens`
- `totalTokens`
- `costEstUsd`
- `rawResponseJson`
- `completedAt`

Recommended job metadata:

- `executionMode`
- `batchId`
- `openaiRequestId` or provider request ID
- `openaiBatchId` or provider batch ID
- `errorMessage`

## Design rules

1. Keep validation shared between sync and batch.
2. Keep the execution mode branch simple.
3. Let sync process exactly one job.
4. Let batch process only claimed jobs.
5. Claim batch jobs atomically in the backend or database.
6. Treat `no batch work available` as a normal waiting condition, not as a failure.
7. Use separate sync and batch prices.
8. Make both execution paths write the same result schema.
9. Store enough raw provider response data to debug token usage and output issues.
10. Keep workflow nodes focused: validate, branch, prepare, call provider, parse, persist.

## Minimal workflow skeleton

```text
Unified Entry
  -> Validate + Build Context
  -> IF executionMode == sync

Sync true branch:
  -> Mark Job Processing
  -> Prepare Single Job Input
  -> Call Provider Directly
  -> Parse Direct Response
  -> Upsert Result
  -> Mark Job Completed

Batch false branch:
  -> Select Batch Candidates
  -> Atomic Claim + Prepare Batch Input
  -> IF hasBatch
     true:
       -> Create Provider Batch
       -> Parse Batch Create Response
       -> Persist Batch Processing State
       -> IF batchCreated
          true:
            -> Poll Provider Batch + Build Result Updates
            -> Apply Result Updates
          false:
            -> Stop after failure state is persisted
     false:
       -> Stop cleanly and wait for more queued jobs
```
