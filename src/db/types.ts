/**
 * Minimal database interface, shaped after expo-sqlite's async API.
 *
 * Every service takes DbLike instead of a concrete driver, which buys two
 * things: (1) unit tests run against better-sqlite3 on a dev machine with no
 * simulator, (2) swapping expo-sqlite for op-sqlite later touches one file
 * (src/db/open.ts), not the services.
 */
export interface DbLike {
    getAllAsync<T = any>(sql: string, ...params: any[]): Promise<T[]>;
    getFirstAsync<T = any>(sql: string, ...params: any[]): Promise<T | null>;
    runAsync(sql: string, ...params: any[]): Promise<{ changes: number }>;
    execAsync(sql: string): Promise<void>;
    closeAsync(): Promise<void>;
}

// ---- dictionary rows ----
export interface EntryRow {
    id: number;
    headword: string;
    pos: string | null;
    cefr: string | null;
    data: string; // JSON — parse with parseEntryData
}

export interface FormRow {
    form: string;
    form_type: string;
    label_vi: string | null;
    label_en: string | null;
    sort: number | null;
    ipa_uk: string | null;
    ipa_us: string | null;
    audio_uk: string | null;
    audio_us: string | null;
    lemma: string;
    lemma_pos: string | null;
    entry_id: number | null;
    headword: string | null; // lemma's Oxford headword
    pos: string | null;      // lemma's Oxford pos
}

export interface SuggestRow {
    display: string;
    sub: string | null;
    kind: 'headword' | 'form';
    entry_id: number | null;
}

/** Shape of entries.data produced by the crawler. Only fields the UI uses. */
export interface EntryData {
    word: string | null;
    homograph: number | null;
    pos: string | null;
    cefr: string | null;
    grammar: string | null;
    labels: string | null;
    pronunciations?: {
        uk?: { phon: string | null; audio_mp3: string | null } | null;
        us?: { phon: string | null; audio_mp3: string | null } | null;
    };
    senses: Array<{
        definition: string;
        cefr: string | null;
        guideword: string | null;
        grammar: string | null;
        labels: string | null;
        examples: Array<{ text: string; label?: string; labels?: string }>;
        synonyms: string[];
        xrefs: Array<{ text: string; url: string | null }>;
    }>;
    idioms: Array<{
        idiom: string;
        senses: Array<{ definition: string; labels: string | null; examples: Array<{ text: string }> }>;
    }>;
    phrasal_verbs: Array<{ text: string; url: string | null }>;
    see_also: Array<{ text: string; url: string | null }>;
    word_origin: string | null;
}

function asXref(x: any): { text: string; url: string | null } | null {
    if (!x) return null;
    if (typeof x === 'string') return { text: x, url: null };
    const text = x.text ?? x.word ?? x.headword ?? null;
    if (!text) return null;
    return { text, url: x.url ?? null };
}

/**
 * `entries.data` lưu `audio_mp3` dạng RÚT GỌN — cắt bỏ tiền tố này, vì nó lặp
 * y hệt ở hơn 130k URL và một mình nó chiếm ~7MB của file người dùng phải tải.
 * Ghép lại ngay lúc parse, nên mọi thứ phía sau (`playUrl`, cache key SHA-256,
 * UI) không hề biết URL từng bị rút gọn.
 */
const AUDIO_PREFIX = 'https://www.oxfordlearnersdictionaries.com/media/english/';

/**
 * URL đã tuyệt đối thì trả nguyên. Nhờ nhánh này, máy nào đã tải bản DB cũ
 * (lưu URL đầy đủ) vẫn chạy bình thường — đổi cách lưu không bắt ai tải lại.
 */
function absAudio(u: unknown): string | null {
    if (typeof u !== 'string' || !u) return null;
    return /^https?:\/\//.test(u) ? u : AUDIO_PREFIX + u;
}

function rehydratePronunciations(p: any): EntryData['pronunciations'] {
    if (!p) return {};
    const one = (x: any) => (x ? { phon: x.phon ?? null, audio_mp3: absAudio(x.audio_mp3) } : null);
    return { uk: one(p.uk), us: one(p.us) };
}

export function parseEntryData(json: string): EntryData {
    const d = JSON.parse(json);
    return {
        // word/pos/cefr không còn được lưu trong data (đã có sẵn thành cột của
        // bảng entries) — giữ `?? null` để bản DB cũ vẫn parse được.
        word: d.word ?? null,
        homograph: d.homograph ?? d.hom ?? null,
        pos: d.pos ?? null,
        cefr: d.cefr ?? null,
        grammar: d.grammar ?? null,
        labels: d.labels ?? null,
        pronunciations: rehydratePronunciations(d.pronunciations),
        senses: (d.senses ?? []).map((s: any) => ({
            ...s,
            synonyms: s.synonyms ?? [],
            xrefs: (s.xrefs ?? []).map(asXref).filter((x: ReturnType<typeof asXref>): x is NonNullable<ReturnType<typeof asXref>> => x != null),
        })),
        idioms: d.idioms ?? [],
        phrasal_verbs: (d.phrasal_verbs ?? []).map((p: any) =>
            typeof p === 'string' ? { text: p, url: null } : { text: p.text ?? p.word ?? '', url: p.url ?? null }),
        see_also: (d.see_also ?? []).map(asXref).filter((x: ReturnType<typeof asXref>): x is NonNullable<ReturnType<typeof asXref>> => x != null),
        word_origin: d.word_origin ?? null,
    };
}
