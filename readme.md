# Cloud Workflow Templates (Azure)

## 1. Project Overview
This repository contains cloud workflow templates designed for production-oriented Azure deployments. The templates standardize orchestration, persistence, secret management, monitoring, and API integration so workflows can be implemented and deployed consistently with Terraform.

The architecture direction for this repository uses:
- Azure Container Apps for runtime services
- Azure Database for PostgreSQL Flexible Server for persistence
- Azure Key Vault for secret management
- Log Analytics for observability
- Terraform for reproducible infrastructure provisioning
- Externalized environment configuration for environment portability

## 2. Templates in This Repository

### Template 1 - Classification Workflow (Implemented)
Template 1 is an Azure-based classification workflow that accepts source and reference website inputs, processes them through n8n orchestration, performs AI-driven classification, and stores structured output in PostgreSQL.

Current status:
- Implemented and validated as an end-to-end cloud template
- Includes API, frontend, profile-driven execution, and cloud-ready runtime wiring

Template documentation:
- [Template 1 README](./Template_1/readme.md)

### Template 2 - AI Job Scheduling Workflow (Design Scope)
Template 2 is designed as an asynchronous AI job scheduling pattern for cost-efficient execution of batched user requests.

Planned architecture intent:
- Database-backed job tracking
- Cloud orchestration for delayed or batched execution
- Scalable deployment model aligned with the same Azure platform primitives

Current status:
- Architecture direction defined
- Implementation is planned as the next template track
