# Phase 9 — Hidden history safeguards

- `/hide` changes whether SillyTavern includes a message in ordinary chat context. It does not remove the message from the chat data and does not invalidate saved Memory Thread sources.
- Memory Thread's recall query now ignores `is_hidden` messages. A hidden message can still be the *source* of a saved fact; a visible recent mention can recall that fact.
- `/unhide` does not duplicate saved records.
- Deletion, editing and branching continue to invalidate facts whose source ID/hash is absent or changed.
- No new API requests, token budget, UI or storage schema changes.

## Scope and limitation

These checks use SillyTavern's `is_hidden` message flag. The tests are unit tests; behavior must still be confirmed with the user's installed SillyTavern version. A hidden message that is part of a previously saved broad summary may still be represented by that summary, as intended.
