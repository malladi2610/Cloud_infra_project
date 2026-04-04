# Classification Core Workflow Skeleton

Use this as the standard block order for every profile-specific n8n workflow.

1. Webhook Trigger (POST)
2. Validate + Normalize Input
3. Build Job Context
4. Fetch Source Data
5. Fetch Reference Data
6. Clean + Prepare Payload
7. Build LLM Request
8. Call LLM Provider
9. Normalize Classification Output
10. Save Result + Update Job
11. Respond to Webhook
12. Error Path: Update Job as `failed` + Respond with failure payload

Required output JSON summary keys:
- `classified_count`
- `positive_count`
- `negative_count`

This skeleton remains constant; source/reference parsing and classifier prompt logic vary by profile.
