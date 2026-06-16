# Deploy target: GCP Cloud Run

This project deploys to GCP Cloud Run via Artifact Registry. These constraints
are binding on requirements, design, and build decisions.

## Runtime

Any language supported by Docker. A `Dockerfile` at the project root is required
— the build stage must produce it.

## Required project structure

    Dockerfile        — at project root; required
    src/              — application source

The server must listen on the port given by the `PORT` environment variable;
Cloud Run sets this at runtime (default 8080).

## State and persistence

Cloud Run instances are stateless between requests. Use external GCP services:
- Cloud SQL or Spanner for relational data
- Cloud Storage for object storage
- Memorystore for caching

## Health check

Every app must expose `GET /healthz` returning HTTP 200. The deploy stage uses
this as the smoke test path after each revision deploy.
