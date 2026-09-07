### 1. Product purpose (1 sentence)

Looks up English–English Oxford entries and inflected forms fully offline on a phone, then drills saved words with Leitner flashcards; Vietnamese glosses are an online overlay, never the dictionary.

### 2. Primary user (1 sentence)

A Vietnamese English learner, one-handed on a phone: lookup mid-reading, then a 5–15 minute daily review session.

### 3. Three to five principles (the operating beliefs)

1. **English first, network never blocks.** Render Oxford immediately; Vietnamese meanings fail-soft and never gate the screen.
2. **The typed form is the truth.** Form-of banner leads; the lemma is a next step, not a rewrite of the query.
3. **Your gloss beats Oxford on cards.** `user_meaning` wins on flashcards and the saved list; SCR-02 still shows Oxford senses in full.
4. **Two buttons, not ease hell.** Binary remembered / not remembered. Scheduler may change later; the two-button UI does not.
5. **The entry is the chrome.** Word, IPA, and senses carry the screen. No card-stacking every section, no decorative noise.

When two principles apply, the lower number wins.

### 4. Success metric for the surface (1-2 sentences)

From an empty search bar, the user types, taps one suggestion, and can read the intended entry (including form-of) with IPA — without waiting on the network.

### 5. Out of scope (bullet list)

- Vietnamese–English as the primary dictionary
- Embedded YouGlish / YouTube widgets
- Mic search and long-press mini-lookup (phase 2)
- Four-button FSRS grading (scheduler may change; two buttons stay)
- Social, leaderboards, or gamification chrome

### 6. Learned constraints (optional, append-only)

- **2026-08-19** — No emoji as functional icons (search, bookmark, speaker, tabs, history, import, grades). *Why:* emoji chrome reads as a prototype. **Do not go icon-less.** Use one consistent vector set (Lucide, Phosphor, or Heroicons — pick one, never mix). Adding an icon package is expected.
- **2026-08-19** — Do not default the accent to template blue (`#3B6AD8` and kin). *Why:* anti-slop; brand color is not yet chosen — decide in `/tokens`, then use that one accent.

### 7. Fold classes used (append-only, written by `/craft`)

- **2026-08-19** — `type-forward` — search + word detail. Sacrificed card-stacking and filled form-of banners; form-of is a typeset sentence with a 2px terracotta spine.
