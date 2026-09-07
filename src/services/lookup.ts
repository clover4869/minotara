/**
 * Lookup — the heart of SCR-02.
 *
 * Runs Q1 (direct entries) and Q2 (form-of rows) IN PARALLEL, never as a
 * fallback chain, because a word like "running" legitimately has both: its
 * own Oxford entries (noun, adjective) and a form-of relationship to "run".
 * The four cases in specs/init.md §SCR-02 fall out of which lists are empty.
 */
import type { DbLike, EntryRow, FormRow, SuggestRow } from '../db/types';

export type LookupCase = 'entry' | 'entry+form' | 'form-only' | 'miss';

export interface LookupResult {
    kind: LookupCase;
    query: string;       // normalized
    entries: EntryRow[]; // Q1, may be several (homographs run_1/run_2)
    formOf: FormRow[];   // Q2, may be several (walked → V2 + V3; read heteronym)
}

/** Normalize user input the same way search_index terms were normalized. */
export function normalizeQuery(raw: string): string {
    return raw.trim().toLowerCase().replace(/\u2019/g, "'").replace(/\s+/g, ' ');
}

const Q1 = `SELECT id, headword, pos, cefr, data FROM entries WHERE lower(headword) = ?`;

const Q2 = `
  SELECT f.form, f.form_type, l.vi AS label_vi, l.en AS label_en, l.sort,
         f.ipa_uk, f.ipa_us,
         COALESCE(f.audio_uk, f.audio_any) AS audio_uk,
         COALESCE(f.audio_us, f.audio_any) AS audio_us,
         f.lemma, f.lemma_pos, e.id AS entry_id, e.headword, e.pos
  FROM forms f
  LEFT JOIN entries e ON e.id = f.entry_id
  LEFT JOIN form_type_label l ON l.form_type = f.form_type
  WHERE f.form = ? AND f.form_type != 'other'
  ORDER BY l.sort`;

export async function lookup(db: DbLike, raw: string): Promise<LookupResult> {
    const query = normalizeQuery(raw);
    if (!query) return { kind: 'miss', query, entries: [], formOf: [] };

    const [entries, formOf] = await Promise.all([
        db.getAllAsync<EntryRow>(Q1, query),
        db.getAllAsync<FormRow>(Q2, query),
    ]);

    const kind: LookupCase =
        entries.length && formOf.length ? 'entry+form'
        : entries.length ? 'entry'
        : formOf.length ? 'form-only'
        : 'miss';

    return { kind, query, entries, formOf };
}

/** Open a specific homograph (saved-word tap / deep link with entry_id). */
export async function lookupByEntryId(db: DbLike, entryId: number): Promise<LookupResult> {
    const entry = await db.getFirstAsync<EntryRow>(
        'SELECT id, headword, pos, cefr, data FROM entries WHERE id = ?', entryId);
    if (!entry) return { kind: 'miss', query: '', entries: [], formOf: [] };
    const r = await lookup(db, entry.headword);
    if (!r.entries.some((e) => e.id === entryId)) {
        r.entries = [entry, ...r.entries];
        r.kind = r.formOf.length ? 'entry+form' : 'entry';
    }
    return r;
}

export async function entryByUrl(db: DbLike, url: string): Promise<{ id: number; headword: string } | null> {
    return db.getFirstAsync('SELECT id, headword FROM entries WHERE url = ?', url);
}

export async function randomB1B2(db: DbLike): Promise<{ headword: string; pos: string | null; cefr: string | null } | null> {
    return db.getFirstAsync(
        `SELECT headword, pos, cefr FROM entries WHERE cefr IN ('B1','B2') ORDER BY RANDOM() LIMIT 1`);
}

/**
 * 02-B: collapse rows that share form + lemma + IPA into one line
 * ("quá khứ (V2) · quá khứ phân từ (V3)"). Heteronyms with different IPA
 * stay on separate rows.
 */
export interface GroupedFormOf {
    form: string;
    lemma: string;
    lemma_pos: string | null;
    entry_id: number | null;
    labels: string[];
    ipa_uk: string | null;
    ipa_us: string | null;
    audio_uk: string | null;
    audio_us: string | null;
}

export function groupFormOf(rows: FormRow[]): GroupedFormOf[] {
    const groups: GroupedFormOf[] = [];
    for (const r of rows) {
        const keyIpa = `${r.ipa_uk ?? ''}|${r.ipa_us ?? ''}`;
        const existing = groups.find(
            (g) => g.form === r.form && g.lemma === r.lemma
                && `${g.ipa_uk ?? ''}|${g.ipa_us ?? ''}` === keyIpa);
        const label = r.label_vi ?? r.label_en ?? r.form_type;
        if (existing) {
            if (label && !existing.labels.includes(label)) existing.labels.push(label);
            continue;
        }
        groups.push({
            form: r.form,
            lemma: r.lemma,
            lemma_pos: r.lemma_pos,
            entry_id: r.entry_id,
            labels: label ? [label] : [],
            ipa_uk: r.ipa_uk,
            ipa_us: r.ipa_us,
            audio_uk: r.audio_uk,
            audio_us: r.audio_us,
        });
    }
    return groups;
}

/**
 * Which homograph tab should open first: when the user arrived via a form
 * ("running" → run), open the tab whose pos matches the form's lemma_pos —
 * the verb, not the noun.
 */
export function initialEntryIndex(entries: EntryRow[], formOf: FormRow[]): number {
    if (entries.length < 2) return 0;
    const wantedPos = formOf[0]?.lemma_pos?.toLowerCase();
    if (!wantedPos) return 0;
    const i = entries.findIndex((e) => (e.pos ?? '').toLowerCase().startsWith(wantedPos));
    return i >= 0 ? i : 0;
}

/** SCR-01 autocomplete. Prefix first; caller may re-query with fallbackContains. */
const SUGGEST = `
  SELECT DISTINCT display, sub, kind, entry_id FROM search_index
  WHERE term LIKE ? || '%'
  ORDER BY kind = 'headword' DESC, length(term)
  LIMIT 12`;
const SUGGEST_CONTAINS = `
  SELECT DISTINCT display, sub, kind, entry_id FROM search_index
  WHERE term LIKE '%' || ? || '%'
  ORDER BY kind = 'headword' DESC, length(term)
  LIMIT 5`;

export async function suggest(db: DbLike, raw: string): Promise<SuggestRow[]> {
    const q = normalizeQuery(raw);
    if (!q) return [];
    const rows = await db.getAllAsync<SuggestRow>(SUGGEST, q);
    if (rows.length) return rows;
    return db.getAllAsync<SuggestRow>(SUGGEST_CONTAINS, q); // 01-07 "ý bạn là"
}

/** 02-06: inflection table rows for one entry, ordered for display. */
const FORMS_OF_ENTRY = `
  SELECT f.form, f.form_type, l.vi AS label_vi, l.en AS label_en, l.sort,
         f.ipa_uk, f.ipa_us,
         COALESCE(f.audio_uk, f.audio_any) AS audio_uk,
         COALESCE(f.audio_us, f.audio_any) AS audio_us,
         f.lemma, f.lemma_pos, f.entry_id, NULL AS headword, NULL AS pos
  FROM forms f
  JOIN form_type_label l ON l.form_type = f.form_type
  WHERE f.entry_id = ? AND f.form_type != 'other'
  ORDER BY l.sort, f.form`;

export async function formsOfEntry(db: DbLike, entryId: number): Promise<FormRow[]> {
    return db.getAllAsync<FormRow>(FORMS_OF_ENTRY, entryId);
}
