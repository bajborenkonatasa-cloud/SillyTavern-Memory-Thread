# Living Lorebook — Phase 2 (read-only UI)

Adds a **Лорбук** tab with a read-only projection of current-branch, source-verified character/place/item memories. Does not add new requests, prompt injection, storage, or World Info writes. Existing memory workflows are unchanged.

## GitHub update

Replace: `index.js` only.
Add: `LIVING-LOREBOOK-PHASE2.md`.
Keep existing `living-lorebook.js` and all other files untouched.

## Testing

Run `node --test tests/living-lorebook.test.js`. In SillyTavern open Memory Thread → Лорбук. Old chats show cards if saved memories have category character/place/item and valid sources. Empty is expected otherwise.
