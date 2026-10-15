// Living Lorebook phase 1: read-only, branch-safe projection of existing memories.
// No persistence, no additional model requests, and no extra prompt injection.
import {activeRecords, sourceMap, validSources, norm} from './core.js';
const TYPES = new Set(['character','place','item']);
export function previewLorebook(memory, chat) {
  const current = sourceMap(chat);
  const cards = new Map();
  for (const record of activeRecords(memory, chat)) {
    if (!TYPES.has(record.category)) continue;
    // Do not promote manually entered, unanchored records into branch-dependent lore.
    if (!validSources(record.sources, current)) continue;
    const identity = `${record.category}:${norm(record.key || record.title)}`;
    const previous = cards.get(identity);
    if (!previous || (record.created || 0) >= (previous.created || 0)) {
      cards.set(identity, {
        id: record.id, key: record.key, title: record.title,
        category: record.category, text: record.text,
        keywords: [...new Set(record.keywords || [])],
        sources: record.sources.map(s => ({...s})), created: record.created
      });
    }
  }
  return [...cards.values()];
}

// Shared contextual matching lives in the core context builder.
export {matchLoreTrigger} from './core.js';
