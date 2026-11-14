# Notion connector

Standard Fetch API client for Node.js 22+ and Cloudflare Workers. PlantDesk uses this package for polling sync; the package has no PlantDesk database, Cloudflare binding, or credential-storage dependency.

The implementation pins Notion API version `2026-03-11`. It supports connection checks, data sources, cursor queries, page creation/update, typed property conversion, bounded request batches, rate-limit reporting, and field-level three-way merge.

```js
import {NotionConnector, threeWayMerge} from './index.mjs';

const notion = new NotionConnector({
  token: process.env.NOTION_TOKEN,
  maxRequests: 30,
  minIntervalMs: 400
});
const batch = await notion.queryPage(process.env.NOTION_DATA_SOURCE_ID, {
  pageSize: 25,
  cursor: savedCursor
});
// Process batch.results, then durably save batch.next_cursor.
const merge = threeWayMerge(lastSyncedFields, localFields, notionFields);
if (merge.conflicts.length) {
  // Ask the user which version to keep; do not blindly overwrite it.
}
```

`PollBudgetExceeded` indicates that the host should save its cursor and continue on its next scheduled run. `NotionError.retryAfter` carries a rate-limit delay. The client does not silently retry writes after a network error: the caller must look up the stable external ID before attempting creation again.

`propertySchema`, `encodeProperty`, and `decodeProperty` support text/title, number, date, checkbox, select/multi-select, URL, relations, and JSON stored in rich text. Relation conversion takes host-provided ID resolvers. Unmapped properties and page content are left to the host.

The package exports an API client and codecs; it does not persist tokens, register webhooks, or install a scheduler. PlantDesk supplies encrypted credential storage, tenant isolation, polling leases, checkpoints, record mapping, conflict review, and UI in `cloudflare/notion/` and `frontend/notion-sync.jsx`.

This source package is included in GitHub. It has not been published to npm.
