/**
 * Import parser — spec 04-B.
 * Lenient by design: each line is `word`, `word,meaning` or `word<TAB>meaning`.
 * Split at the FIRST comma/tab only, so meanings may contain commas.
 */
export interface ParsedLine {
    word: string;          // normalized lowercase
    meaning: string | null;
}

export const IMPORT_LIMIT = 500;

export function parseImportText(text: string): { items: ParsedLine[]; skipped: number } {
    const seen = new Map<string, ParsedLine>();
    let skipped = 0;

    for (const rawLine of text.split(/\r?\n/)) {
        const line = rawLine.trim();
        if (!line) continue;

        const sep = ((): number => {
            const c = line.indexOf(',');
            const t = line.indexOf('\t');
            if (c === -1) return t;
            if (t === -1) return c;
            return Math.min(c, t);
        })();

        const word = (sep === -1 ? line : line.slice(0, sep))
            .trim().toLowerCase().replace(/\u2019/g, "'");
        const meaning = sep === -1 ? null : line.slice(sep + 1).trim() || null;

        if (!word) continue;
        // header row from the template
        if (word === 'word' && (meaning ?? '').toLowerCase().startsWith('meaning')) continue;

        if (seen.has(word)) {
            // duplicate: keep first occurrence, but adopt a meaning if the
            // first one lacked it
            const prev = seen.get(word)!;
            if (!prev.meaning && meaning) prev.meaning = meaning;
            skipped++;
            continue;
        }
        if (seen.size >= IMPORT_LIMIT) { skipped++; continue; }
        seen.set(word, { word, meaning });
    }
    return { items: [...seen.values()], skipped };
}

/** Match rate for the B2b low-match rescue banner (>50% unmatched → show help). */
export function shouldSuggestTemplate(total: number, matched: number): boolean {
    return total > 0 && matched / total < 0.5;
}
