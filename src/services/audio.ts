/**
 * Pronunciation audio — 3-tier strategy from spec §0.3:
 * (1) offline pack BLOB [phase 2, needs ATTACH] → (2) stream URL then cache
 * to file → (3) nothing: caller disables the speaker icon.
 * Failures are silent by contract — never an error popup mid-review (05B-03b).
 */
import * as FileSystem from 'expo-file-system/legacy';
import * as Crypto from 'expo-crypto';
import { createAudioPlayer, type AudioPlayer, type AudioStatus } from 'expo-audio';

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
let statusSub: { remove(): void } | null = null;

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
 * Lặp NỐI ĐUÔI, không khoảng chờ: phát xong là phát lại ngay (sự kiện
 * didJustFinish), và mỗi vòng ĐỌC NHANH thêm một chút — 1.00x, 1.05x, 1.10x…
 * trần 1.5x (chạm trần sau 10 vòng). Trần là bắt buộc: không trần thì một
 * phút sau giọng thành sóc chuột. `shouldCorrectPitch` giữ cao độ giọng khi
 * tăng tốc trên Android; tham số 'high' của setPlaybackRate là bản iOS của
 * cùng việc đó. Sang thẻ mới thì playRepeating gọi lại → về 1.0x.
 *
 * Không dùng `player.loop`: loop tự nối vòng ở tầng native nên không có chỗ
 * chen setPlaybackRate giữa các vòng — phải tự seekTo(0) + play() trong
 * listener. seekTo là async: play() nằm trong .then, không thì lệnh play chạy
 * trước khi con trỏ về đầu và vòng đó bị nuốt.
 */
const RATE_STEP = 0.05;
const RATE_MAX = 1.5;

/**
 * 05B-03b: lặp cho tới khi stopRepeat() (gọi lúc chấm điểm/lật/unmount).
 *
 * stopRepeat() phải chạy NGAY đầu hàm, trước mọi await — playUrl() `return
 * false` sớm khi url null hoặc tải fail, nên nếu không dừng trước thì thẻ mới
 * không có audio sẽ để vòng lặp của thẻ cũ sống tiếp.
 */
export async function playRepeating(url: string | null | undefined): Promise<void> {
    stopRepeat();
    if (!url) return;
    const mine = generation;
    const local = await ensureCached(url);
    if (!local || mine !== generation) return; // offline chưa cache → im lặng / đã sang thẻ khác
    try {
        player?.remove();
        const p = createAudioPlayer(local);
        player = p;
        p.shouldCorrectPitch = true;
        let rate = 1.0;
        p.setPlaybackRate(rate, 'high');
        // addListener có thật lúc chạy — AudioPlayer kế thừa SharedObject →
        // EventEmitter, và docs expo-audio chỉ đúng cách này. Nhưng npm đặt
        // expo-modules-core NESTED trong expo/ (không hoist), nên câu import
        // type bên trong expo-audio không resolve và TS mất chuỗi kế thừa —
        // cast tại đúng một chỗ này với type tối thiểu thay vì tắt strict.
        statusSub = (p as unknown as {
            addListener(e: 'playbackStatusUpdate', cb: (st: AudioStatus) => void): { remove(): void };
        }).addListener('playbackStatusUpdate', (st) => {
            if (mine !== generation || !st.didJustFinish) return;
            rate = Math.min(RATE_MAX, rate + RATE_STEP);
            p.setPlaybackRate(rate, 'high');
            p.seekTo(0).then(() => { if (mine === generation) p.play(); }).catch(() => {});
        });
        p.play();
    } catch {
        stopRepeat();
    }
}

/**
 * Dừng hẳn: huỷ timer VÀ dừng tiếng đang phát. Trước đây chỉ huỷ timer, nên
 * chấm điểm giữa lúc đang phát thì đoạn đó vẫn chạy hết trên thẻ tiếp theo.
 */
export function stopRepeat(): void {
    generation++;
    statusSub?.remove();
    statusSub = null;
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
