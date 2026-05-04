# Cloud Workflow Templates on Azure

## 1. Project Overview
This repository contains two complete Azure workflow templates for building, deploying, and operating AI-assisted application workflows.

The templates share a common cloud architecture:
- Azure Container Apps for the frontend/API and workflow runtime services
- n8n for workflow orchestration
- Azure Database for PostgreSQL Flexible Server for application and n8n persistence
- Azure Container Registry for application images
- Azure Key Vault and Container App secrets for runtime secret handling
- Log Analytics for runtime observability
- Terraform for repeatable infrastructure provisioning
- Checkpoint-driven guides and traceback logs for deployment troubleshooting

Each template includes application code, profile/workflow examples, database migrations, Terraform infrastructure, and documentation for local and cloud operation.

## 2. Templates

### Template 1 - Classification Workflow
Template 1 is a profile-driven classification workflow for Azure.

It provides:
- A frontend + API service for triggering classification jobs and viewing outputs
- n8n orchestration for workflow execution
- PostgreSQL persistence with logical DB separation (`classifier`, `n8ndb`)
- Profile-driven request mapping for source/reference URL classification workflows
- Terraform infrastructure for Azure deployment

Template documentation:
- [Template 1 README](./Template_1/readme.md)

### Template 2 - Sync and Batch PDF Summarization Workflow
Template 2 is a multi-user PDF summarization workflow for Azure.

It provides:
- A frontend + API service for authentication, PDF upload, job creation, and result viewing
- n8n-only AI execution for both sync and batch summarization paths
- PostgreSQL persistence with logical DB separation (`template2`, `n8ndb`)
- Azure Blob Storage for uploaded PDF documents in cloud deployment
- Admin/God UI visibility into jobs, batch windows, queue state, benchmark runs, and cost metrics
- OpenAI Responses API sync execution
- OpenAI Batch API async execution with batch windows and result ingestion
- Terraform infrastructure for Azure Container Apps, PostgreSQL, Blob Storage, ACR, Key Vault, identities, RBAC, and observability

Template documentation:
- [Template 2 README](./Template_2/readme.md)

## 3. Repository Structure
```text
.
  Template_1/
    app/
    examples/
    infra/terraform/
    scripts/
    docs/
    readme.md

  Template_2/
    app/
    examples/
    infra/terraform/
    scripts/
    storage/
    docs/
    readme.md

  extras/
    docs/
      template_1/
      template_2/
```

## 4. Operating Model
The repository uses a checkpoint-based workflow for cloud deployment:

1. Build and verify the local application behavior.
2. Align Terraform with the final runtime configuration.
3. Build and push container images to ACR.
4. Export sensitive `TF_VAR_*` values in the current shell.
5. Create and review a saved Terraform plan.
6. Apply the plan.
7. Run cloud database migrations.
8. Import and activate n8n workflows.
9. Run cloud smoke tests.
10. Record errors and fixes in the template traceback document.

For detailed commands, use each template README and the guides under `extras/docs`.
