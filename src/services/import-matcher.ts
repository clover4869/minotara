/**
 * Import matching — spec 04-B step B2/B3.
 * Each parsed word is matched via search_index: direct headword hit, or a
 * form hit resolved to its LEMMA entry ("ran" → save "run"; meaning follows).
 */
import type { DbLike } from '../db/types';
import type { ParsedLine } from './import-parser';

export interface HomographOption {
    entry_id: number;
    headword: string;
    pos: string | null;
    cefr: string | null;
}

export interface MatchedImport {
    inputWords: string[];       // every input word that resolved here, e.g. ["ran", "run"]
    meaning: string | null;
    entry_id: number;
    headword: string;           // what will be saved ("run")
    pos: string | null;
    cefr: string | null;
    viaForm: boolean;           // true when at least one input resolved through a form
    alreadySaved: boolean;
    homographs: HomographOption[]; // extra POS tabs; empty when unambiguous
}

export interface ImportMatchResult {
    matched: MatchedImport[];
    unmatched: string[];        // words not in the dictionary
}

export async function matchImport(
    dict: DbLike,
    user: DbLike,
    items: ParsedLine[],
): Promise<ImportMatchResult> {
    const matched: MatchedImport[] = [];
    const unmatched: string[] = [];
    const byEntry = new Map<number, MatchedImport>(); // two inputs resolving to same entry → merge, don't drop

    for (const item of items) {
        const hits = await dict.getAllAsync<{
            kind: string; entry_id: number | null;
        }>(
            `SELECT kind, entry_id FROM search_index
             WHERE term = ? AND entry_id IS NOT NULL
             ORDER BY kind = 'headword' DESC`,
            item.word);

        const ids: number[] = [];
        for (const h of hits) {
            if (h.entry_id && !ids.includes(h.entry_id)) ids.push(h.entry_id);
        }
        if (!ids.length) { unmatched.push(item.word); continue; }

        const entries: HomographOption[] = [];
        for (const id of ids) {
            const e = await dict.getFirstAsync<HomographOption>(
                'SELECT id AS entry_id, headword, pos, cefr FROM entries WHERE id = ?', id);
            if (e) entries.push(e);
        }
        if (!entries.length) { unmatched.push(item.word); continue; }

        const primary = entries[0];
        const viaForm = hits[0]?.kind === 'form';

        const existing = byEntry.get(primary.entry_id);
        if (existing) {
            existing.inputWords.push(item.word);
            existing.viaForm = existing.viaForm || viaForm;
            if (!existing.meaning && item.meaning) existing.meaning = item.meaning;
            continue;
        }

        const saved = await user.getFirstAsync(
            'SELECT 1 FROM saved_words WHERE entry_id = ?', primary.entry_id);

        const row: MatchedImport = {
            inputWords: [item.word],
            meaning: item.meaning,
            entry_id: primary.entry_id,
            headword: primary.headword,
            pos: primary.pos,
            cefr: primary.cefr,
            viaForm,
            alreadySaved: !!saved,
            homographs: entries,
        };
        byEntry.set(primary.entry_id, row);
        matched.push(row);
    }
    return { matched, unmatched };
}
