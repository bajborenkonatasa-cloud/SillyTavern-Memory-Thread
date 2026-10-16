# Phase 13 — Smart Budget

- Automatic recall prioritizes records relevant to the visible current conversation before the broad overview.
- A high importance flag by itself no longer injects unrelated records.
- Manually forced and pinned memories retain their priority.
- The Context tab displays an approximate budget breakdown (header, scene, pinned, recall, overview, flashback).
- Existing memory data, history, sources, fork checks and budget setting are unchanged.
- The overview may be omitted when it cannot fit; the original stored overview is never edited or deleted.
- No additional model requests.

Tests: `npm test`.
