- **Complete autonomous-driver transition extraction** (audit P2-2, roadmap PR
  3.2c). Moves fix/retry and convergence outcomes, Principal-ruling boundaries, and
  merge results into pure handlers returning the common transition result. The
  effectful coordinator retains archive and gate writes, Principal and host dispatch,
  state persistence, locking, loop control, and final cleanup. Current backlog,
  design, and comparative guidance now record the completed three-PR decomposition.
  *Honest scope note:* this is a behavior-preserving structural change and adds no
  autonomous capability or gate/event vocabulary.
