# Living Lorebook — phase 1 (safe foundation)

This release adds `living-lorebook.js`, a **read-only** projection of already extracted memories into character, place, and item cards. It is intentionally NOT connected to prompts, storage, UI, or automatic API calls yet. Existing summarization, extraction, context budgets, and chat behavior remain unchanged.

## Safety invariants
- Cards are derived only from existing source-anchored active records.
- Source fingerprints must match messages in the currently active chat.
- Deleted messages, edited/swiped messages and future messages beyond a fork are excluded.
- Unanchored manual notes are not silently converted to branch-dependent cards.
- No duplicated prompt injection and no extra model tokens or API costs.

## Next phase
Add an optional UI preview and a single shared memory budget; only after tests, consider selectively injecting cards with deduplication. Existing World Info stays untouched.

## Verification
`node --test tests/living-lorebook.test.js`
