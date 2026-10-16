# Phase 17 — Knowledge Scope & Non-Omniscient Actor

- The `knownTo` field now restricts injection of **all record categories** when it contains explicit character names, not just `secret` records.
- Unknown/empty `knownTo` for **non-secret** records remains unclassified (not automatically private) for compatibility with existing archives. Empty `knownTo` for `secret` remains private.
- Pinned and forced recall obey the same audience restrictions.
- When any restricted record is unavailable to the answering character, free-text overview, scene, and batch summaries are withheld, since those legacy texts have no sentence-level audience provenance.
- The context header explicitly discourages omniscient acting, guessing hidden thoughts, and treating narrator information as character knowledge.
- No new API calls, no schema migration, no memory deletion, and no change to the token budget.

## Known limitations

- Free-text summaries are withheld conservatively; they are not yet divided into public and private fragments.
- Unclassified non-secret entries and visible chat may still include private information. `knownTo` must be correctly filled to enforce per-character privacy.
- Audience identification depends on the SillyTavern character name. Multi-character responses and aliases are not fully supported.
- Prompts guide model behavior but cannot guarantee it will never infer information.
