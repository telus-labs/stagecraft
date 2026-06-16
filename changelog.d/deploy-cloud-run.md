---
type: feat
---

- Add `cloud-run` deploy adapter (`core/deploy/cloud-run.md`): builds a Docker image, pushes to GCP Artifact Registry, deploys a Cloud Run revision, smoke-tests the live URL, and writes a compliant stage-08 gate with `deploy_completed`, `smoke_tests_passed`, and `rollback_executed` fields.
