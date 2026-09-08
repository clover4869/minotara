/**
 * Pronunciation audio — 3-tier strategy from spec §0.3:
 * (1) offline pack BLOB [phase 2, needs ATTACH] → (2) stream URL then cache
 * to file → (3) nothing: caller disables the speaker icon.
 * Failures are silent by contract — never an error popup mid-review (05B-03b).
 */
import * as FileSystem from 'expo-file-system/legacy';
import * as Crypto from 'expo-crypto';
import { createAudioPlayer, type AudioPlayer } from 'expo-audio';

const CACHE_DIR = `${FileSystem.cacheDirectory}audio/`;

/**
 * SHA-256 of the URL, not a 32-bit hash: with ~150k+ distinct pronunciation
 * URLs in the dictionary, a 32-bit hash collides often enough in practice
 * (verified against the real oxford-app.db — 7 colliding pairs) that two
 * different words silently share a cache file and play each other's audio.
 */
async function cacheKey(url: string): Promise<string> {
    const digest = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, url);
    return `${CACHE_DIR}${digest}.mp3`;
}

let player: AudioPlayer | null = null;
let repeatTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * Tăng mỗi lần stopRepeat(). `playRepeating()` phải await tải file về, và
 * trong lúc await đó người dùng có thể đã chấm điểm sang thẻ khác. Không có
 * mốc này thì lời gọi cũ tỉnh lại sau khi tải xong sẽ phát từ CŨ và đặt một
 * timer mới đè lên thẻ mới — nghe ra là "từ trước cứ lặp mãi".
 */
let generation = 0;

async function ensureCached(url: string): Promise<string | null> {
    try {
        await FileSystem.makeDirectoryAsync(CACHE_DIR, { intermediates: true }).catch(() => {});
        const local = await cacheKey(url);
        const info = await FileSystem.getInfoAsync(local);
        if (info.exists) return local;
        const dl = await FileSystem.downloadAsync(url, local);
        return dl.status === 200 ? local : null;
    } catch {
        return null;
    }
}

/**
 * Tải rồi phát, bỏ giữa đường nếu `token` đã cũ. Tách riêng khỏi hai hàm công
 * khai vì cả hai đều gọi stopRepeat() trước — nếu hàm này cũng gọi thì mốc
 * generation bị tăng hai lần trong một lượt và phép so mốc luôn sai.
 */
async function loadAndPlay(url: string, token: number): Promise<boolean> {
    const local = await ensureCached(url);
    if (!local || token !== generation) return false;
    try {
        player?.remove();
        player = createAudioPlayer(local);
        player.play();
        return true;
    } catch {
        return false;
    }
}

/** Play a pronunciation URL once. Returns false when unplayable (offline, 404). */
export async function playUrl(url: string | null | undefined): Promise<boolean> {
    if (!url) return false;
    stopRepeat();
    return loadAndPlay(url, generation);
}

/**
 * Nhịp lặp dồn dần theo thời gian đứng trên MỘT thẻ: 3,0s → 2,8s → 2,6s → …
 * sàn 1,5s (chạm sàn sau ~16 giây). Đứng càng lâu — tức đang cố nhớ — thì từ
 * vang càng dày, như một cú thúc nhẹ; sang thẻ mới là về lại 3,0s. Phải có
 * sàn: không sàn thì đứng một phút là thành tiếng gõ liên hồi. Vì khoảng chờ
 * đổi theo từng lần nên dùng setTimeout nối đuôi, không dùng setInterval.
 */
const REPEAT_BASE_MS = 3000;
const REPEAT_STEP_MS = 200;
const REPEAT_FLOOR_MS = 1500;

/**
 * 05B-03b: lặp cho tới khi stopRepeat() (gọi lúc chấm điểm/lật/unmount).
 *
 * stopRepeat() phải chạy NGAY đầu hàm, trước mọi await. Trước đây nó chỉ chạy
 * bên trong playUrl(), mà playUrl() lại `return false` sớm khi url null hoặc
 * tải fail — nên nếu thẻ mới không có audio thì timer của thẻ cũ vẫn sống và
 * từ cũ lặp mãi trên thẻ mới.
 */
export async function playRepeating(url: string | null | undefined): Promise<void> {
    stopRepeat();
    if (!url) return;
    const mine = generation;
    if (!(await loadAndPlay(url, mine))) return; // offline mà chưa cache → im lặng, không báo lỗi
    if (mine !== generation) return;             // đã sang thẻ khác trong lúc tải
    let repeats = 0; // số lần đã lặp lại — quyết định khoảng chờ co dần
    const scheduleNext = () => {
        const delay = Math.max(REPEAT_FLOOR_MS, REPEAT_BASE_MS - REPEAT_STEP_MS * repeats);
        repeatTimer = setTimeout(() => {
            try {
                player?.seekTo(0);
                player?.play();
                repeats++;
                scheduleNext();
            } catch {
                stopRepeat();
            }
        }, delay);
    };
    scheduleNext();
}

/**
 * Dừng hẳn: huỷ timer VÀ dừng tiếng đang phát. Trước đây chỉ huỷ timer, nên
 * chấm điểm giữa lúc đang phát thì đoạn đó vẫn chạy hết trên thẻ tiếp theo.
 */
export function stopRepeat(): void {
    generation++;
    if (repeatTimer) { clearTimeout(repeatTimer); repeatTimer = null; }
    try { player?.pause(); } catch { /* player đã bị remove() — không có gì phải dừng */ }
}

export async function clearAudioCache(): Promise<void> {
    await FileSystem.deleteAsync(CACHE_DIR, { idempotent: true });
}

export function pickAudioUrl(
    row: { audio_uk?: string | null; audio_us?: string | null },
    dialect: 'uk' | 'us',
): string | null {
    return (dialect === 'us' ? row.audio_us ?? row.audio_uk : row.audio_uk ?? row.audio_us) ?? null;
}
