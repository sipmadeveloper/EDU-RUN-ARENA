import {
  doc,
  getDoc,
  onSnapshot,
  serverTimestamp,
  setDoc,
  type Unsubscribe,
} from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from '../firebase';

export type StadiumLedSlideType = 'text' | 'image';

export interface StadiumLedSlide {
  id: string;
  type: StadiumLedSlideType;
  enabled: boolean;
  label: string;
  text: string;
  bgHex: string;
  textHex: string;
  accentHex: string;
  imageUrl: string;
  durationSec: number;
  scrollSpeed: number;
}

export interface StadiumLedConfig {
  enabled: boolean;
  brightness: number;
  repeatCount: number;
  approxBytes: number;
  slides: StadiumLedSlide[];
  updatedBy?: string;
  updatedAtMs?: number;
}

export const STADIUM_LED_DOC_PATH = 'settings/stadiumLed';
export const MAX_LED_SLIDES = 10;
export const MAX_LED_DOC_BYTES = 320_000; // Hard cap: 320 KB (<0.03% of Spark 1 GiB quota)
export const MAX_SPONSOR_IMAGE_BYTES = 32_768; // Hard cap: 32 KB per uploaded sponsor banner
const LOCAL_CACHE_KEY = 'edurun_stadium_led_config_v1';

export const DEFAULT_STADIUM_LED_CONFIG: StadiumLedConfig = {
  enabled: true,
  brightness: 1.05,
  repeatCount: 24,
  approxBytes: 0,
  slides: [
    {
      id: 'default-edu-run',
      type: 'text',
      enabled: true,
      label: 'Headline Stadion',
      text: 'EDU RUN ARENA 3D · KOMPETISI BALAP LARI EDUKATIF MULTIPLAYER · CEPAT · TEPAT · SPORTIF',
      bgHex: '#071530',
      textHex: '#FFFFFF',
      accentHex: '#FACC15',
      imageUrl: '',
      durationSec: 10,
      scrollSpeed: 4,
    },
    {
      id: 'default-championship',
      type: 'text',
      enabled: true,
      label: 'Info Kejuaraan',
      text: 'JAWAB SOAL DENGAN BENAR UNTUK SPEED BOOST! · RAIH PODIUM JUARA 1, 2, 3 & 4 DI TENGAH STADION!',
      bgHex: '#0F2957',
      textHex: '#FEF08A',
      accentHex: '#FF6B1A',
      imageUrl: '',
      durationSec: 10,
      scrollSpeed: 5,
    },
    {
      id: 'default-fairplay',
      type: 'text',
      enabled: true,
      label: 'Semangat Belajar',
      text: 'BELAJAR JADI SERU DI ARENA 3D · 30 LINTASAN ATLETIK · INTEGRASI GOOGLE DRIVE & CLOUD',
      bgHex: '#064E3B',
      textHex: '#FFFFFF',
      accentHex: '#34D399',
      imageUrl: '',
      durationSec: 9,
      scrollSpeed: 4,
    },
  ],
};

function clampInt(n: number, min: number, max: number, fallback: number): number {
  const v = Math.round(Number(n));
  if (!Number.isFinite(v)) return fallback;
  return Math.max(min, Math.min(max, v));
}

function clampFloat(n: number, min: number, max: number, fallback: number): number {
  const v = Number(n);
  if (!Number.isFinite(v)) return fallback;
  return Math.max(min, Math.min(max, v));
}

function cleanHex(val: unknown, fallback: string): string {
  const s = typeof val === 'string' ? val.trim() : '';
  return /^#[0-9a-fA-F]{6}$/.test(s) ? s.toUpperCase() : fallback;
}

function sanitizeSlideId(id: unknown, idx: number): string {
  const raw = typeof id === 'string' ? id.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 40) : '';
  return raw || `slide-${idx + 1}`;
}

export function sanitizeSlide(raw: Partial<StadiumLedSlide>, idx: number): StadiumLedSlide {
  const type: StadiumLedSlideType = raw.type === 'image' ? 'image' : 'text';
  const imageUrl =
    typeof raw.imageUrl === 'string'
      ? raw.imageUrl.trim().slice(0, 48_000)
      : '';
  return {
    id: sanitizeSlideId(raw.id, idx),
    type,
    enabled: raw.enabled !== false,
    label: (typeof raw.label === 'string' ? raw.label.trim() : '').slice(0, 60) || `Slide ${idx + 1}`,
    text: (typeof raw.text === 'string' ? raw.text.trim() : '').slice(0, 220),
    bgHex: cleanHex(raw.bgHex, '#071530'),
    textHex: cleanHex(raw.textHex, '#FFFFFF'),
    accentHex: cleanHex(raw.accentHex, '#FACC15'),
    imageUrl,
    durationSec: clampInt(raw.durationSec ?? 8, 4, 30, 8),
    scrollSpeed: clampInt(raw.scrollSpeed ?? (type === 'text' ? 4 : 1), 0, 10, type === 'text' ? 4 : 1),
  };
}

export function estimateLedConfigBytes(config: Pick<StadiumLedConfig, 'enabled' | 'brightness' | 'repeatCount' | 'slides'>): number {
  try {
    const str = JSON.stringify({
      enabled: config.enabled,
      brightness: config.brightness,
      repeatCount: config.repeatCount,
      slides: config.slides,
    });
    return new TextEncoder().encode(str).length;
  } catch {
    return 0;
  }
}

export function normalizeStadiumLedConfig(raw: unknown): StadiumLedConfig {
  if (!raw || typeof raw !== 'object') {
    return {
      ...DEFAULT_STADIUM_LED_CONFIG,
      approxBytes: estimateLedConfigBytes(DEFAULT_STADIUM_LED_CONFIG),
    };
  }
  const r = raw as Record<string, unknown>;
  const rawSlides = Array.isArray(r.slides) ? r.slides.slice(0, MAX_LED_SLIDES) : [];
  const slides =
    rawSlides.length > 0
      ? rawSlides.map((s, idx) => sanitizeSlide((s ?? {}) as Partial<StadiumLedSlide>, idx))
      : DEFAULT_STADIUM_LED_CONFIG.slides;

  const base = {
    enabled: r.enabled !== false,
    brightness: Number(clampFloat(Number(r.brightness ?? 1.05), 0.6, 1.4, 1.05).toFixed(2)),
    repeatCount: clampInt(Number(r.repeatCount ?? 24), 12, 40, 24),
    slides,
  };
  const updatedAtObj = r.updatedAt as { toMillis?: () => number } | undefined;
  return {
    ...base,
    approxBytes: estimateLedConfigBytes(base),
    updatedBy: typeof r.updatedBy === 'string' ? r.updatedBy : undefined,
    updatedAtMs:
      updatedAtObj && typeof updatedAtObj.toMillis === 'function'
        ? updatedAtObj.toMillis()
        : typeof r.updatedAtMs === 'number'
        ? r.updatedAtMs
        : undefined,
  };
}

export function getCachedStadiumLedConfig(): StadiumLedConfig {
  try {
    const raw = localStorage.getItem(LOCAL_CACHE_KEY);
    if (raw) return normalizeStadiumLedConfig(JSON.parse(raw));
  } catch {
    // ignore cache errors
  }
  return normalizeStadiumLedConfig(DEFAULT_STADIUM_LED_CONFIG);
}

function writeLocalCache(cfg: StadiumLedConfig) {
  try {
    localStorage.setItem(LOCAL_CACHE_KEY, JSON.stringify(cfg));
  } catch {
    // ignore quota errors in private browsing
  }
}

export async function loadStadiumLedConfig(): Promise<StadiumLedConfig> {
  try {
    const snap = await getDoc(doc(db, 'settings', 'stadiumLed'));
    if (!snap.exists()) {
      return normalizeStadiumLedConfig(DEFAULT_STADIUM_LED_CONFIG);
    }
    const cfg = normalizeStadiumLedConfig(snap.data());
    writeLocalCache(cfg);
    return cfg;
  } catch {
    // Fallback cleanly to local cache or default config so 3D stadium never crashes offline
    return getCachedStadiumLedConfig();
  }
}

export function subscribeStadiumLedConfig(
  onConfig: (config: StadiumLedConfig) => void
): Unsubscribe {
  onConfig(getCachedStadiumLedConfig());
  const ref = doc(db, 'settings', 'stadiumLed');
  return onSnapshot(
    ref,
    (snap) => {
      if (snap.exists()) {
        const cfg = normalizeStadiumLedConfig(snap.data());
        writeLocalCache(cfg);
        onConfig(cfg);
      } else {
        onConfig(normalizeStadiumLedConfig(DEFAULT_STADIUM_LED_CONFIG));
      }
    },
    () => {
      // Keep rendering smoothly with cached/default LED ticker if offline
      onConfig(getCachedStadiumLedConfig());
    }
  );
}

export async function saveStadiumLedConfig(
  adminUid: string,
  draft: Pick<StadiumLedConfig, 'enabled' | 'brightness' | 'repeatCount' | 'slides'>
): Promise<StadiumLedConfig> {
  const slides = draft.slides
    .slice(0, MAX_LED_SLIDES)
    .map((s, idx) => sanitizeSlide(s, idx));

  if (slides.length === 0) {
    throw new Error('Minimal harus ada 1 slide LED (teks berjalan atau gambar sponsor).');
  }

  for (const s of slides) {
    if (s.type === 'image' && s.imageUrl.startsWith('data:')) {
      const byteLen = new TextEncoder().encode(s.imageUrl).length;
      if (byteLen > MAX_SPONSOR_IMAGE_BYTES + 4096) {
        throw new Error(
          `Gambar pada "${s.label}" terlalu besar (${Math.round(byteLen / 1024)} KB). Upload ulang agar terkompresi otomatis di bawah 32 KB.`
        );
      }
    }
  }

  const normalized = {
    enabled: Boolean(draft.enabled),
    brightness: Number(clampFloat(draft.brightness, 0.6, 1.4, 1.05).toFixed(2)),
    repeatCount: clampInt(draft.repeatCount, 12, 40, 24),
    slides,
  };

  const approxBytes = estimateLedConfigBytes(normalized);
  if (approxBytes > MAX_LED_DOC_BYTES) {
    throw new Error(
      `Total ukuran konfigurasi LED (${(approxBytes / 1024).toFixed(1)} KB) melebihi batas hemat Firebase (${(MAX_LED_DOC_BYTES / 1024).toFixed(0)} KB). Kurangi jumlah gambar atau gunakan tautan URL gambar.`
    );
  }

  const payload = {
    enabled: normalized.enabled,
    brightness: normalized.brightness,
    repeatCount: normalized.repeatCount,
    approxBytes,
    slides: normalized.slides,
    updatedBy: adminUid,
    updatedAt: serverTimestamp(),
  };

  try {
    await setDoc(doc(db, 'settings', 'stadiumLed'), payload);
    const saved: StadiumLedConfig = {
      ...normalized,
      approxBytes,
      updatedBy: adminUid,
      updatedAtMs: Date.now(),
    };
    writeLocalCache(saved);
    return saved;
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, STADIUM_LED_DOC_PATH);
    throw err;
  }
}

export interface CompressedSponsorResult {
  dataUrl: string;
  originalBytes: number;
  compressedBytes: number;
  width: number;
  height: number;
  format: 'webp' | 'jpeg';
}

/**
 * Compresses any uploaded sponsor logo/banner into an ultra-lean stadium LED strip
 * (max 512x128 WebP/JPEG, strictly <= 32 KB) so Firestore Spark storage stays tiny.
 */
export async function compressSponsorImageForLed(
  file: File,
  bgHex = '#071530'
): Promise<CompressedSponsorResult> {
  const originalBytes = file.size;
  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const el = new Image();
    el.onload = () => {
      URL.revokeObjectURL(url);
      resolve(el);
    };
    el.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Gagal membaca file gambar. Gunakan format PNG, JPG, atau WebP.'));
    };
    el.src = url;
  });

  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas browser tidak tersedia untuk kompresi gambar.');

  // Test WebP encoding support once
  canvas.width = 4;
  canvas.height = 4;
  const supportsWebp = canvas.toDataURL('image/webp', 0.7).startsWith('data:image/webp');
  const mime = supportsWebp ? 'image/webp' : 'image/jpeg';

  // Progressive target sizes & quality levels to guarantee <= 32 KB
  const attempts: Array<{ w: number; h: number; q: number }> = [
    { w: 512, h: 128, q: 0.78 },
    { w: 512, h: 128, q: 0.64 },
    { w: 512, h: 128, q: 0.5 },
    { w: 512, h: 128, q: 0.38 },
    { w: 384, h: 96, q: 0.62 },
    { w: 384, h: 96, q: 0.45 },
    { w: 320, h: 80, q: 0.4 },
  ];

  let bestUrl = '';
  let bestBytes = Number.MAX_SAFE_INTEGER;
  let bestW = 512;
  let bestH = 128;

  for (const step of attempts) {
    canvas.width = step.w;
    canvas.height = step.h;

    // Clean solid LED panel background so transparent PNG logos look sharp
    ctx.fillStyle = cleanHex(bgHex, '#071530');
    ctx.fillRect(0, 0, step.w, step.h);

    // Fit image cleanly inside LED ribbon with slight safe padding
    const padX = Math.round(step.w * 0.04);
    const padY = Math.round(step.h * 0.08);
    const maxW = step.w - padX * 2;
    const maxH = step.h - padY * 2;
    const scale = Math.min(maxW / img.width, maxH / img.height);
    const drawW = Math.max(1, Math.round(img.width * scale));
    const drawH = Math.max(1, Math.round(img.height * scale));
    const dx = Math.round((step.w - drawW) / 2);
    const dy = Math.round((step.h - drawH) / 2);

    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, dx, dy, drawW, drawH);

    const dataUrl = canvas.toDataURL(mime, step.q);
    const bytes = new TextEncoder().encode(dataUrl).length;

    if (bytes < bestBytes) {
      bestUrl = dataUrl;
      bestBytes = bytes;
      bestW = step.w;
      bestH = step.h;
    }

    if (bytes <= MAX_SPONSOR_IMAGE_BYTES) {
      return {
        dataUrl,
        originalBytes,
        compressedBytes: bytes,
        width: step.w,
        height: step.h,
        format: supportsWebp ? 'webp' : 'jpeg',
      };
    }
  }

  return {
    dataUrl: bestUrl,
    originalBytes,
    compressedBytes: bestBytes,
    width: bestW,
    height: bestH,
    format: supportsWebp ? 'webp' : 'jpeg',
  };
}
