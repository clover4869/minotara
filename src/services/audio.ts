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
let repeatTimer: ReturnType<typeof setInterval> | null = null;

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

/** Play a pronunciation URL once. Returns false when unplayable (offline, 404). */
export async function playUrl(url: string | null | undefined): Promise<boolean> {
    if (!url) return false;
    const local = await ensureCached(url);
    if (!local) return false;
    try {
        stopRepeat();
        player?.remove();
        player = createAudioPlayer(local);
        player.play();
        return true;
    } catch {
        return false;
    }
}

/** 05B-03b: repeat every 3s until stopRepeat() (called on grade/flip/unmount). */
export async function playRepeating(url: string | null | undefined): Promise<void> {
    const ok = await playUrl(url);
    if (!ok) return; // offline without cache → silence, no error
    repeatTimer = setInterval(() => {
        try { player?.seekTo(0); player?.play(); } catch { stopRepeat(); }
    }, 3000);
}

export function stopRepeat(): void {
    if (repeatTimer) { clearInterval(repeatTimer); repeatTimer = null; }
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
