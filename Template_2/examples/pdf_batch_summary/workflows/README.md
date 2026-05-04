# Template_2 Workflow Pack (Single Import)

Use one file only:

- `wf_template2_unified.json`
: single n8n workflow containing all required paths:
  - `POST /webhook/summaries/run` (runtime)
  - `POST /webhook/benchmarks/run`
  - explicit service blocks for:
    - OpenAI Responses API (`OpenAI Responses (Sync)` HTTP node)
    - OpenAI Batch create (`OpenAI Create Batch` HTTP node)
    - Postgres state/result writes (`Sync * (Postgres)` and `Batch * (Postgres)` nodes)

## Import
1. Import `wf_template2_unified.json` in n8n.
2. Activate the workflow.
3. Run `./Template_2/scripts/test_uniform_ui.sh`.

## Required n8n Environment Variables
- `INTERNAL_API_TOKEN`
- `OPENAI_API_KEY`
- `OPENAI_MODEL`
- `N8N_WEBHOOK_BASE`
- `N8N_RUN_WEBHOOK_URL` (app/runtime wiring)
- `APP_INTERNAL_BASE_URL` (default in workflows: `http://app:8080`)
- `OPENAI_INPUT_TOKEN_PRICE_PER_MILLION_USD`
- `OPENAI_OUTPUT_TOKEN_PRICE_PER_MILLION_USD`
