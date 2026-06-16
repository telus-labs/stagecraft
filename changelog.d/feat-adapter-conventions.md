- Feat: adapter conventions auto-injected into pipeline/context.md.
  When deploy.adapter is set, devteam run and devteam stage (requirements/design/build)
  write a deploy-target context block into pipeline/context.md before the first agent
  dispatches. The block is idempotent and adapter-specific (gizmos, cloud-run have
  full conventions files). --feature strings no longer need to repeat stack details
  implied by the deploy adapter.
