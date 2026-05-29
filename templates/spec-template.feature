# Executable spec — pipeline/spec.feature
#
# G2 contract: every AC-N in pipeline/brief.md gets ONE Scenario in this
# file tagged @AC-N. Tests in stage-06 map 1:1 to these Scenarios. The
# `devteam spec verify` command catches drift between brief.md, this
# file, and pipeline/test-report.md.
#
# Tips:
#   - Tag each Scenario with @AC-N on its own line (preferred) OR
#     include AC-N in the Scenario name. Either works for verification.
#   - One Scenario per AC. If a criterion has multiple paths, split it
#     into AC-1a, AC-1b first in brief.md so the mapping stays 1:1.
#   - The Given/When/Then steps are for human + tooling readers. Steps
#     don't have to execute (this is documentation-as-spec); QA writes
#     the actual tests in stage-06.
#
# `devteam spec generate` will scaffold this file from brief.md.

Feature: <Feature name>

  @AC-1
  Scenario: AC-1 — <one-line restating the criterion>
    Given <precondition>
    When  <action>
    Then  <observable outcome>

  @AC-2
  Scenario: AC-2 — <one-line restating the criterion>
    Given <precondition>
    When  <action>
    Then  <observable outcome>
