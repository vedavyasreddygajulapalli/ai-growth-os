# M7 SEO & AI Visibility acceptance

Updated 11 October 2026. Code and CI acceptance are separate from live provider acceptance.

## Available workspace behavior

The SEO workspace uses the selected organization and verified website scope. Overview and issue triage use persisted crawl snapshots, crawl pages, and technical issues. Provider status, schema drafts, CMS targets, and publication jobs are read from MongoDB and the existing content/CMS workflow.

The provider catalog defines typed adapters for Search Console, keyword rankings, and AI visibility. A provider is reported as disconnected unless an adapter has been registered. Connection requests record `authorization_required`; they do not claim OAuth success, persist credentials, or create measurements. No ranking, indexing, search traffic, or AI citation data is inferred from crawl evidence.

The schema editor accepts only the restricted Organization, WebPage, and Article JSON-LD shape. It enforces website URL scope, strict properties, versions, role authorization, independent approval, and audit events. A schema edit invalidates prior approval. Publishing requires an approved version, a current published WordPress content item, matching website and CMS origin, a verified website, a registered REST meta key, and an enabled publishing worker.

## WordPress publication setup

Install `integrations/wordpress/ai-growth-os-schema-adapter.php` on the target WordPress site. The plugin registers the REST-visible `aigrowthos_jsonld` post meta field, validates the supported schema keys and URL host, checks edit permissions, and emits validated JSON-LD in the page head. Configure the API environment variable:

```sh
CMS_SCHEMA_META_KEY=aigrowthos_jsonld
```

Connect WordPress through the existing encrypted CMS credential flow. A publish target must already be a successfully published content item. The worker checks the remote page and modification timestamp, writes only to the registered meta field, reads the value back, and records the outcome. If the remote outcome is uncertain, it moves the job to review; reconciliation is read-only and never repeats a write.

## Provider acceptance boundary

The abstractions and disconnected/authorization-required states are implemented. OAuth consent, token refresh/revocation, provider APIs, provider webhooks, and real data ingestion are not implemented or claimed. These require provider credentials and provider-specific acceptance. Until then the workspace must show an empty/unavailable provider state, never sample metrics.

## CI coverage

CI tests cover provider state without fabricated metrics, tenant and website boundaries, audit behavior, strict schema validation and approval, version fencing, publication target checks, WordPress metadata write/read-back, uncertain outcome reconciliation, and the live SEO workspace rendering. Test transports are isolated fixtures and do not represent real provider or WordPress acceptance.

## Remaining live gates

- Install the WordPress adapter on a verified test site and confirm meta registration, permissions, structured data output, remote write/read-back, and read-only reconciliation.
- Perform authenticated Owner/Admin/Marketing Manager publish acceptance and confirm denied roles cannot publish.
- Connect Search Console, a ranking provider, and an AI visibility source only after their OAuth/API contracts and credentials are available; verify provenance, freshness, revocation, and empty states.
- Review desktop/mobile layouts and accessibility with an authenticated tenant.
- Deploy SEO with M8 after both modules pass CI. No separate M7 deployment is intended.
