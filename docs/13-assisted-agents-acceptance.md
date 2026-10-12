# M10 Assisted agents acceptance

V1 supports Manual and Assisted policy modes. Agent proposals remain human reviewed; approved proposals are not autonomously executed. Autopilot is later scope.

- Policy is website scoped, defaults to Manual, and can be changed by Owner/Admin with optimistic versioning and an audit event.
- An action proposal is accepted only in Assisted mode, only when allowlisted, and within the configured spend cap.
- Approval is bound to the immutable input hash and current proposal version; self-approval is rejected.
- Decisions are audited in the same transaction as the status change.
- Cross-workspace and cross-website IDs are not returned.
- No provider output or action completion is generated without a connected provider/worker.
