# M10 Assisted agents acceptance

V1 supports Manual and Assisted policy modes. Agent proposals remain human reviewed; approval never executes an action autonomously. Autopilot is later scope.

- Policy is website scoped, defaults to Manual, and is changed by Owner/Admin with optimistic versioning and an audit event.
- A proposal is accepted only in Assisted mode, only when allowlisted, and within configured spend, page, and protected-URL limits.
- Approval is bound to the proposal input hash and version; self-approval is rejected.
- Decisions are audited in the same transaction as the status change.
- Growth inbox items are derived from real overdue CRM follow-ups. Acknowledge and snooze state is persisted, version checked, and audited; Sales users can only see their assigned records.
- AI Activity reads real persisted content AI requests. Retry creates a linked attempt against the same content version and revision, reruns only through the configured content AI provider, and records success or a redacted failure. The user supplies a fresh instruction; prompts are not retained for replay.
- Costs remain unknown until provider usage is measured. Cross-workspace and cross-website records are never returned.
- No provider output or action completion is generated without a connected provider/worker.
