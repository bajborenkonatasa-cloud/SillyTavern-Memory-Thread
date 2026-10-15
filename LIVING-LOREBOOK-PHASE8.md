# Phase 8 — contextual triggers (safe integration)

- Adds complete-word matching for character/place/item titles and stored keywords.
- Scores an already source-verified memory record in the existing context builder.
- Uses the same budget and same selected record; no separate lore prompt or extra API calls.
- Current and previous four eligible messages are scanned, including character responses.
- No auto-generation of new lore entries yet. No World Info writes.
- Branch rollback and edited-message source validation remain enforced.

## GitHub
Replace `core.js`, `living-lorebook.js`; add `tests/lore-triggers.test.js` and `LIVING-LOREBOOK-PHASE8.md`. Leave everything else unchanged.
