/**
 * Vietnamese meanings — ONLINE layer (spec §0.5).
 * Cache-first against user.db's vi_cache; API called with the LEMMA; UI must
 * never block on this. CC BY-SA — attribution lives in Settings 06-06.
 */
import type { DbLike } from '../db/types';

const API = 'https://dict.minhqnd.com/api/v1/lookup';
const TIMEOUT_MS = 3000;

export interface ViMeaning {
    definition: string;
    example: string | null;
    pos: string | null; // normalized to oxford-ish pos, or null
}

const POS_MAP: Record<string, string> = {
    'danh từ': 'noun',
    'động từ': 'verb',
    'tính từ': 'adjective',
    'phó từ': 'adverb',
    'trạng từ': 'adverb',
    'giới từ': 'preposition',
    'liên từ': 'conjunction',
    'thán từ': 'exclamation',
    'đại từ': 'pronoun',
};

export function normalizeViPos(viPos: string | null | undefined): string | null {
    if (!viPos) return null;
    return POS_MAP[viPos.trim().toLowerCase()] ?? null;
}

function extractMeanings(apiJson: any): ViMeaning[] {
    const out: ViMeaning[] = [];
    for (const result of apiJson?.results ?? []) {
        for (const m of result?.meanings ?? []) {
            if (m?.definition_lang !== 'vi' || !m?.definition) continue;
            out.push({
                definition: m.definition,
                example: m.example ?? null,
                pos: normalizeViPos(m.pos),
            });
        }
    }
    return out;
}

/**
 * Cache-first fetch. Returns [] on any failure — callers render the
 * "cần mạng" row instead of an error. `fetchImpl` injected for tests.
 */
export async function getViMeanings(
    userDb: DbLike,
    lemma: string,
    fetchImpl: typeof fetch = fetch,
): Promise<{ meanings: ViMeaning[]; fromCache: boolean; failed: boolean }> {
    const word = lemma.trim().toLowerCase();
    const cached = await userDb.getFirstAsync<{ json: string }>(
        'SELECT json FROM vi_cache WHERE word = ?', word);
    if (cached) return { meanings: extractMeanings(JSON.parse(cached.json)), fromCache: true, failed: false };

    const url = `${API}?word=${encodeURIComponent(word)}&lang=en&def_lang=vi`;
    for (let attempt = 0; attempt < 2; attempt++) { // timeout 3s, retry once (§0.5)
        try {
            const ctrl = new AbortController();
            const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
            const res = await fetchImpl(url, { signal: ctrl.signal });
            clearTimeout(timer);
            if (!res.ok) {
                if (attempt === 0) continue;
                return { meanings: [], fromCache: false, failed: true };
            }
            const json = await res.json();
            await userDb.runAsync(
                'INSERT OR REPLACE INTO vi_cache (word, json, fetched_at) VALUES (?, ?, ?)',
                word, JSON.stringify(json), new Date().toISOString());
            return { meanings: extractMeanings(json), fromCache: false, failed: false };
        } catch {
            if (attempt === 0) continue;
            return { meanings: [], fromCache: false, failed: true };
        }
    }
    return { meanings: [], fromCache: false, failed: true };
}

/** Filter meanings to the active homograph tab; unmatched pos → shown under all tabs. */
export function meaningsForPos(all: ViMeaning[], entryPos: string | null): ViMeaning[] {
    if (!entryPos) return all;
    const p = entryPos.toLowerCase();
    const matched = all.filter((m) => m.pos && p.startsWith(m.pos));
    const unposed = all.filter((m) => !m.pos);
    return matched.length ? [...matched, ...unposed] : all;
}

/** POS that does not match the open tab — render under "Nghĩa khác". */
export function meaningsOtherPos(all: ViMeaning[], entryPos: string | null): ViMeaning[] {
    if (!entryPos) return [];
    const p = entryPos.toLowerCase();
    return all.filter((m) => m.pos && !p.startsWith(m.pos));
}
