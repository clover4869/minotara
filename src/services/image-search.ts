/**
 * Image search — Phase 2 "Ảnh" tab.
 *
 * DuckDuckGo has no official public Image Search API. This reverse-engineers
 * its internal endpoint (verified working directly against the live service
 * while planning this feature — see specs/improvement.md). No SLA: treat it
 * exactly like services/vi-meaning.ts treats its own external API —
 * cache-first, short timeout, one retry, fail soft, never throw to the UI.
 *
 * Flow: fetch the HTML search page to pull out a `vqd` token, then use that
 * token to call the JSON results endpoint. DDG's image results are
 * themselves Bing-sourced under the hood (`source: "Bing"`).
 */
import type { DbLike } from '../db/types';
import { getCachedImages, cacheImages } from '../db/user';

const TOKEN_URL = 'https://duckduckgo.com/';
const RESULTS_URL = 'https://duckduckgo.com/i.js';

/**
 * 8s, không phải 3s như vi-meaning.ts. Ở đây bước 1 phải tải cả một trang HTML
 * kết quả (~18KB) rồi mới gọi tiếp được; đo trên mạng dây mất 0,73s, còn 4G
 * thì vượt 3s là bình thường — và timeout thì hiện ra thành "Cần mạng để xem
 * ảnh", tức là đổ lỗi cho mạng của người dùng.
 */
const TIMEOUT_MS = 8000;

/**
 * Cache ảnh hết hạn sau 30 ngày. Trước đây câu SELECT không nhìn `fetched_at`
 * nên cache sống mãi: endpoint chết rồi mà vài từ vẫn có ảnh (cache cũ), từ
 * mới thì báo lỗi — nhìn ra như lỗi ngắt quãng thay vì một nguồn đã hỏng.
 */
export const IMAGE_CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36';

export interface ImageResult {
    image: string;
    thumbnail: string;
    title: string;
    source: string;
    sourceUrl: string;
    width: number;
    height: number;
}

async function fetchWithTimeout(fetchImpl: typeof fetch, url: string, init: RequestInit): Promise<Response> {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
    try {
        return await fetchImpl(url, { ...init, signal: ctrl.signal });
    } finally {
        clearTimeout(timer);
    }
}

async function fetchVqdToken(fetchImpl: typeof fetch, query: string): Promise<string | null> {
    const url = `${TOKEN_URL}?q=${encodeURIComponent(query)}&iar=images&iax=images&ia=images`;
    const res = await fetchWithTimeout(fetchImpl, url, { headers: { 'User-Agent': USER_AGENT } });
    if (!res.ok) return null;
    const html = await res.text();
    const m = html.match(/vqd=['"]([\d-]+)['"]/);
    return m?.[1] ?? null;
}

async function fetchResultsPage(fetchImpl: typeof fetch, query: string, page: number, vqd: string): Promise<ImageResult[]> {
    const url = `${RESULTS_URL}?q=${encodeURIComponent(query)}&o=json&vqd=${vqd}&p=${page}&f=,,,,,`;
    const res = await fetchWithTimeout(fetchImpl, url, {
        headers: { 'User-Agent': USER_AGENT, Referer: 'https://duckduckgo.com/' },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    const rows: any[] = Array.isArray(json?.results) ? json.results : [];
    return rows
        .map((r): ImageResult => ({
            image: r.image, thumbnail: r.thumbnail, title: r.title ?? '',
            source: r.source ?? '', sourceUrl: r.url ?? '',
            width: r.width ?? 0, height: r.height ?? 0,
        }))
        .filter((r) => r.image && r.thumbnail);
}

/**
 * Cache-first fetch. Fail soft, không bao giờ throw ra UI — cùng hợp đồng với
 * getViMeanings() trong vi-meaning.ts. `fetchImpl` tiêm vào để test.
 *
 * `failed: true` chỉ có nghĩa "không lấy được ảnh", KHÔNG có nghĩa mất mạng:
 * nó bật lên cho cả 403, timeout, regex vqd không khớp, JSON hỏng. Chỗ gọi
 * phải tự kiểm tra mạng trước khi nói với người dùng là do mạng — nói sai
 * nguyên nhân thì họ đi sửa Wi-Fi trong khi lỗi nằm ở endpoint.
 */
export async function searchImages(
    userDb: DbLike,
    rawQuery: string,
    page = 1,
    fetchImpl: typeof fetch = fetch,
): Promise<{ results: ImageResult[]; fromCache: boolean; failed: boolean }> {
    const query = rawQuery.trim().toLowerCase();
    if (!query) return { results: [], fromCache: false, failed: false };

    const cached = await getCachedImages(userDb, query, page, IMAGE_CACHE_TTL_MS);
    if (cached) {
        try {
            return { results: JSON.parse(cached), fromCache: true, failed: false };
        } catch {
            // corrupt cache row — fall through to a fresh fetch instead of failing outright
        }
    }

    for (let attempt = 0; attempt < 2; attempt++) { // timeout per try, 1 retry
        try {
            const vqd = await fetchVqdToken(fetchImpl, query);
            if (!vqd) {
                if (attempt === 0) continue;
                return { results: [], fromCache: false, failed: true };
            }
            const results = await fetchResultsPage(fetchImpl, query, page, vqd);
            await cacheImages(userDb, query, page, JSON.stringify(results));
            return { results, fromCache: false, failed: false };
        } catch {
            if (attempt === 0) continue;
            return { results: [], fromCache: false, failed: true };
        }
    }
    return { results: [], fromCache: false, failed: true };
}
