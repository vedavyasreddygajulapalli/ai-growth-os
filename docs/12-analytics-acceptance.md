# M9 Analytics acceptance

Analytics measures are tenant and website scoped. CRM-based lead and won-value measures are read from MongoDB lead records. Traffic, GA4 sessions, Search Console clicks/impressions, rankings, and AI visibility return unavailable/null until a real provider connection and successful sync exist; an empty result is not rendered as a measured zero.

- Verify tenant and active website scope on each analytics endpoint.
- Verify GA4 and Search Console status is exposed without credentials or fabricated observations.
- Verify CRM lead cohorts use lead creation timestamps and preserve source labels.
- Verify revenue read access is Owner/Admin only; values are integer minor units with coverage.
- Verify conversion definition writes are strict, scoped, versioned through the audit log, and reject duplicate keys.
- Verify reports snapshot actual CRM counts and mark provider sources unavailable.
- Verify provider connection credentials are never stored in analytics records.
- Verify CI build, unit, MongoDB replica-set integration, and frontend production build.
