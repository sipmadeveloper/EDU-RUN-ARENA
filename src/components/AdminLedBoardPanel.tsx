import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Tv,
  Plus,
  Image as ImageIcon,
  Type,
  Trash2,
  ArrowUp,
  ArrowDown,
  Save,
  RotateCcw,
  Upload,
  Link2,
  Loader2,
  Eye,
  EyeOff,
  HardDrive,
  CheckCircle2,
  AlertTriangle,
} from 'lucide-react';
import { formatFriendlyFirestoreError } from '../firebase';
import {
  compressSponsorImageForLed,
  DEFAULT_STADIUM_LED_CONFIG,
  estimateLedConfigBytes,
  loadStadiumLedConfig,
  MAX_LED_DOC_BYTES,
  MAX_LED_SLIDES,
  saveStadiumLedConfig,
  type StadiumLedConfig,
  type StadiumLedSlide,
} from '../services/stadiumLedStore';

interface AdminLedBoardPanelProps {
  adminUid: string;
  onNotify: (kind: 'ok' | 'err', text: string) => void;
}

const COLOR_PRESETS = [
  { name: 'Navy Emas', bgHex: '#071530', textHex: '#FFFFFF', accentHex: '#FACC15' },
  { name: 'Biru Stadion', bgHex: '#0F2957', textHex: '#FEF08A', accentHex: '#38BDF8' },
  { name: 'Oranye Juara', bgHex: '#7C2D12', textHex: '#FFFFFF', accentHex: '#FF6B1A' },
  { name: 'Hijau Arena', bgHex: '#064E3B', textHex: '#FFFFFF', accentHex: '#34D399' },
  { name: 'Putih Sponsor', bgHex: '#F8FAFC', textHex: '#0F172A', accentHex: '#1D4ED8' },
];

function formatKb(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  return `${(bytes / 1024).toFixed(1)} KB`;
}

function makeSlideId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
}

export function AdminLedBoardPanel({ adminUid, onNotify }: AdminLedBoardPanelProps) {
  const [enabled, setEnabled] = useState(true);
  const [brightness, setBrightness] = useState(1.05);
  const [repeatCount, setRepeatCount] = useState(24);
  const [slides, setSlides] = useState<StadiumLedSlide[]>(DEFAULT_STADIUM_LED_CONFIG.slides);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [compressingId, setCompressingId] = useState<string | null>(null);
  const [compressionNotes, setCompressionNotes] = useState<Record<string, string>>({});
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [lastSavedMs, setLastSavedMs] = useState<number | undefined>(undefined);

  // Live preview state
  const previewCanvasRef = useRef<HTMLCanvasElement>(null);
  const [previewMeta, setPreviewMeta] = useState<{ index: number; total: number; label: string; type: string }>({
    index: 1,
    total: 1,
    label: '-',
    type: 'text',
  });

  const loadConfig = useCallback(async () => {
    setLoading(true);
    setErrorMsg(null);
    try {
      const cfg = await loadStadiumLedConfig();
      setEnabled(cfg.enabled);
      setBrightness(cfg.brightness);
      setRepeatCount(cfg.repeatCount);
      setSlides(cfg.slides);
      setLastSavedMs(cfg.updatedAtMs);
      setDirty(false);
    } catch (err) {
      setErrorMsg(formatFriendlyFirestoreError(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadConfig().catch(() => {});
  }, [loadConfig]);

  const approxBytes = useMemo(
    () => estimateLedConfigBytes({ enabled, brightness, repeatCount, slides }),
    [enabled, brightness, repeatCount, slides]
  );

  const budgetPct = Math.min(100, Math.round((approxBytes / MAX_LED_DOC_BYTES) * 100));
  const overBudget = approxBytes > MAX_LED_DOC_BYTES;

  // Live animated mini LED ticker preview matching the 3D stadium behavior
  useEffect(() => {
    const canvas = previewCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const active = slides.filter((s) => s.enabled);
    const list = active.length > 0 ? active : DEFAULT_STADIUM_LED_CONFIG.slides;

    const imgMap = new Map<string, HTMLImageElement>();
    for (const s of list) {
      if (s.type === 'image' && s.imageUrl) {
        const img = new Image();
        if (!s.imageUrl.startsWith('data:')) img.crossOrigin = 'anonymous';
        img.src = s.imageUrl;
        imgMap.set(s.id, img);
      }
    }

    let raf = 0;
    let lastTs = performance.now();
    let idx = 0;
    let slideTime = 0;
    let scrollPx = 0;
    let lastMetaIdx = -1;

    const W = canvas.width;
    const H = canvas.height;

    const renderFrame = (now: number) => {
      const dt = Math.min(0.05, (now - lastTs) / 1000);
      lastTs = now;

      if (!enabled) {
        ctx.fillStyle = '#090f1d';
        ctx.fillRect(0, 0, W, H);
        ctx.fillStyle = '#64748B';
        ctx.font = 'bold 16px sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('LAYAR LED TRIBUN DINONAKTIFKAN', W / 2, H / 2);
        return;
      }

      const current = list[idx % list.length];
      const dur = Math.max(4, current.durationSec || 8);
      slideTime += dt;
      if (slideTime >= dur && list.length > 1) {
        slideTime = 0;
        idx = (idx + 1) % list.length;
        scrollPx = 0;
      }

      const slide = list[idx % list.length];
      if (lastMetaIdx !== idx) {
        lastMetaIdx = idx;
        setPreviewMeta({
          index: idx + 1,
          total: list.length,
          label: slide.label || `Slide ${idx + 1}`,
          type: slide.type === 'image' ? 'Gambar Sponsor' : 'Running Text',
        });
      }

      const speed = Math.max(0, Math.min(10, slide.scrollSpeed ?? 0));
      scrollPx = (scrollPx + speed * 28 * dt) % W;

      ctx.fillStyle = slide.bgHex || '#071530';
      ctx.fillRect(0, 0, W, H);
      ctx.fillStyle = slide.accentHex || '#FACC15';
      ctx.fillRect(0, 0, W, 6);
      ctx.fillRect(0, H - 6, W, 6);

      if (slide.type === 'image' && slide.imageUrl) {
        const img = imgMap.get(slide.id);
        if (img && img.complete && img.naturalWidth > 0) {
          const panelW = W / 2;
          const innerH = H - 18;
          const scale = Math.min((panelW - 24) / img.naturalWidth, innerH / img.naturalHeight);
          const dw = img.naturalWidth * scale;
          const dh = img.naturalHeight * scale;
          for (let copy = -1; copy <= 2; copy++) {
            const baseX = copy * panelW - (scrollPx % panelW);
            ctx.drawImage(img, baseX + (panelW - dw) / 2, 9 + (innerH - dh) / 2, dw, dh);
            ctx.fillStyle = slide.accentHex || '#FACC15';
            ctx.globalAlpha = 0.45;
            ctx.fillRect(baseX, 10, 3, H - 20);
            ctx.globalAlpha = 1;
          }
        } else {
          ctx.fillStyle = slide.textHex || '#FFFFFF';
          ctx.font = 'bold 16px sans-serif';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText(
            slide.imageUrl ? 'Memuat gambar sponsor...' : 'Belum ada gambar sponsor',
            W / 2,
            H / 2
          );
        }
      } else {
        const msg = `${(slide.text || slide.label || 'EDU RUN ARENA 3D').toUpperCase()}   ✦   `;
        ctx.font = '900 28px Outfit, sans-serif';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        const tw = Math.max(260, ctx.measureText(msg).width);
        const offset = speed > 0 ? scrollPx % tw : 0;

        ctx.save();
        ctx.shadowColor = slide.accentHex || '#FACC15';
        ctx.shadowBlur = 8;
        ctx.fillStyle = slide.textHex || '#FFFFFF';
        if (speed === 0) {
          ctx.textAlign = 'center';
          ctx.fillText(
            (slide.text || slide.label || 'EDU RUN ARENA 3D').toUpperCase(),
            W / 2,
            H / 2 + 1,
            W - 36
          );
        } else {
          for (let x = -offset; x < W + tw; x += tw) {
            ctx.fillText(msg, x, H / 2 + 1);
          }
        }
        ctx.restore();
      }

      // Subtle LED scanlines
      ctx.fillStyle = 'rgba(0,0,0,0.14)';
      for (let y = 0; y < H; y += 4) {
        ctx.fillRect(0, y, W, 1);
      }

      raf = requestAnimationFrame(renderFrame);
    };

    raf = requestAnimationFrame(renderFrame);
    return () => cancelAnimationFrame(raf);
  }, [enabled, slides]);

  function markDirty() {
    setDirty(true);
    setErrorMsg(null);
  }

  function updateSlide(id: string, patch: Partial<StadiumLedSlide>) {
    setSlides((prev) => prev.map((s) => (s.id === id ? { ...s, ...patch } : s)));
    markDirty();
  }

  function addTextSlide() {
    if (slides.length >= MAX_LED_SLIDES) {
      onNotify('err', `Maksimal ${MAX_LED_SLIDES} slide agar database Firebase tetap ringan.`);
      return;
    }
    const next: StadiumLedSlide = {
      id: makeSlideId('txt'),
      type: 'text',
      enabled: true,
      label: `Running Text #${slides.length + 1}`,
      text: 'SELAMAT BERTANDING DI EDU RUN ARENA 3D · JUNJUNG TINGGI SPORTIVITAS!',
      bgHex: '#071530',
      textHex: '#FFFFFF',
      accentHex: '#FACC15',
      imageUrl: '',
      durationSec: 10,
      scrollSpeed: 4,
    };
    setSlides((prev) => [...prev, next]);
    markDirty();
  }

  function addSponsorSlide() {
    if (slides.length >= MAX_LED_SLIDES) {
      onNotify('err', `Maksimal ${MAX_LED_SLIDES} slide agar database Firebase tetap ringan.`);
      return;
    }
    const next: StadiumLedSlide = {
      id: makeSlideId('spn'),
      type: 'image',
      enabled: true,
      label: `Sponsor #${slides.length + 1}`,
      text: '',
      bgHex: '#0F2957',
      textHex: '#FFFFFF',
      accentHex: '#38BDF8',
      imageUrl: '',
      durationSec: 8,
      scrollSpeed: 2,
    };
    setSlides((prev) => [...prev, next]);
    markDirty();
  }

  function moveSlide(idx: number, dir: -1 | 1) {
    const target = idx + dir;
    if (target < 0 || target >= slides.length) return;
    setSlides((prev) => {
      const next = [...prev];
      const [item] = next.splice(idx, 1);
      next.splice(target, 0, item);
      return next;
    });
    markDirty();
  }

  function removeSlide(id: string) {
    if (slides.length <= 1) {
      onNotify('err', 'Minimal harus tersisa 1 slide pada layar LED stadion.');
      return;
    }
    setSlides((prev) => prev.filter((s) => s.id !== id));
    markDirty();
  }

  async function handleUploadSponsorFile(slide: StadiumLedSlide, file: File) {
    setCompressingId(slide.id);
    setErrorMsg(null);
    try {
      const res = await compressSponsorImageForLed(file, slide.bgHex);
      updateSlide(slide.id, { imageUrl: res.dataUrl });
      const savedPct =
        res.originalBytes > 0
          ? Math.max(0, Math.round((1 - res.compressedBytes / res.originalBytes) * 100))
          : 0;
      setCompressionNotes((prev) => ({
        ...prev,
        [slide.id]: `Asli ${formatKb(res.originalBytes)} → ${formatKb(res.compressedBytes)} (${res.width}×${res.height} ${res.format.toUpperCase()}, hemat ${savedPct}%)`,
      }));
      onNotify(
        'ok',
        `Gambar sponsor dikompresi ke ${formatKb(res.compressedBytes)} agar hemat storage Firebase.`
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Gagal memproses gambar sponsor.';
      setErrorMsg(msg);
      onNotify('err', msg);
    } finally {
      setCompressingId(null);
    }
  }

  function handleResetDefault() {
    setEnabled(DEFAULT_STADIUM_LED_CONFIG.enabled);
    setBrightness(DEFAULT_STADIUM_LED_CONFIG.brightness);
    setRepeatCount(DEFAULT_STADIUM_LED_CONFIG.repeatCount);
    setSlides(DEFAULT_STADIUM_LED_CONFIG.slides);
    setCompressionNotes({});
    markDirty();
  }

  async function handleSave() {
    if (overBudget) {
      onNotify('err', 'Total ukuran melebihi batas hemat 320 KB. Hapus sebagian gambar atau pakai URL gambar.');
      return;
    }
    setSaving(true);
    setErrorMsg(null);
    try {
      const saved: StadiumLedConfig = await saveStadiumLedConfig(adminUid, {
        enabled,
        brightness,
        repeatCount,
        slides,
      });
      setSlides(saved.slides);
      setLastSavedMs(saved.updatedAtMs);
      setDirty(false);
      onNotify(
        'ok',
        `Pengaturan layar LED tribun (${formatKb(saved.approxBytes)}) berhasil disimpan & langsung tayang di stadion 3D!`
      );
    } catch (err) {
      const msg = formatFriendlyFirestoreError(err);
      setErrorMsg(msg);
      onNotify('err', msg);
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="p-8 rounded-2xl bg-[#0F2957] border border-blue-400/25 flex items-center justify-center gap-2 text-sm text-blue-200">
        <Loader2 className="w-4 h-4 animate-spin text-[#FACC15]" />
        <span>Memuat pengaturan layar LED tribun stadion...</span>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {/* Header + Live Preview + Firebase Storage Budget */}
      <div className="p-5 rounded-2xl bg-[#0F2957] border border-[#FACC15]/35 space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-start gap-3">
            <div className="w-11 h-11 rounded-xl bg-amber-500/20 border border-[#FACC15]/50 flex items-center justify-center shrink-0">
              <Tv className="w-5 h-5 text-[#FACC15]" />
            </div>
            <div>
              <h3 className="font-display font-bold text-lg text-white">
                Layar LED Pembatas Bawah Tribun 360° (Running Text & Sponsor)
              </h3>
              <p className="text-xs text-blue-200/80">
                Memutari penuh sekeliling lapangan di bawah tribun penonton. Semua slide aktif bergantian tampil otomatis secara real-time.
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={handleResetDefault}
              disabled={saving}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-[#081226] border border-white/15 hover:bg-white/10 text-xs font-semibold text-slate-200 cursor-pointer"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span>Reset Default</span>
            </button>
            <button
              type="button"
              onClick={handleSave}
              disabled={saving || overBudget}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-[#FF6B1A] hover:bg-[#e85d10] disabled:opacity-50 text-xs sm:text-sm font-bold text-white cursor-pointer shadow-lg"
            >
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
              <span>{dirty ? 'Simpan & Tayangkan ke Stadion*' : 'Simpan & Tayangkan'}</span>
            </button>
          </div>
        </div>

        {/* Live Animated LED Preview Strip */}
        <div className="rounded-xl bg-[#081226] border border-white/15 p-3 space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-2 text-[11px]">
            <span className="font-bold text-[#FACC15] uppercase tracking-wide">
              Pratinjau Live Layar LED 360°
            </span>
            <span className="text-slate-300">
              Menampilkan Slide {previewMeta.index}/{previewMeta.total}:{' '}
              <strong className="text-white">{previewMeta.label}</strong> ({previewMeta.type})
            </span>
          </div>
          <canvas
            ref={previewCanvasRef}
            width={920}
            height={92}
            className="w-full h-16 sm:h-20 rounded-lg border border-white/10 bg-[#050c1a]"
          />
        </div>

        {/* Firebase Storage Efficiency Bar + Global Controls */}
        <div className="grid lg:grid-cols-12 gap-4 pt-1">
          <div className="lg:col-span-6 p-3.5 rounded-xl bg-[#081226] border border-emerald-400/30 space-y-2">
            <div className="flex items-center justify-between text-xs">
              <span className="inline-flex items-center gap-1.5 font-semibold text-emerald-300">
                <HardDrive className="w-3.5 h-3.5" />
                <span>Penggunaan Database Firebase (1 Dokumen Tunggal)</span>
              </span>
              <span className={`font-mono font-bold ${overBudget ? 'text-red-400' : 'text-white'}`}>
                {formatKb(approxBytes)} / {formatKb(MAX_LED_DOC_BYTES)}
              </span>
            </div>
            <div className="h-2 rounded-full bg-slate-800 overflow-hidden">
              <div
                className={`h-full transition-all ${
                  overBudget ? 'bg-red-500' : budgetPct > 75 ? 'bg-amber-400' : 'bg-emerald-400'
                }`}
                style={{ width: `${Math.max(3, budgetPct)}%` }}
              />
            </div>
            <p className="text-[11px] text-slate-300 leading-relaxed">
              Setiap gambar sponsor yang di-upload otomatis dikompresi ke <strong>WebP 512×128 px (maks. 32 KB)</strong> agar tidak membebani kuota gratis Firebase (1 GB). Gunakan <strong>URL Gambar</strong> untuk <strong>0 KB</strong> beban storage gambar!
            </p>
          </div>

          <div className="lg:col-span-6 p-3.5 rounded-xl bg-[#081226] border border-white/10 grid sm:grid-cols-3 gap-3 items-center">
            <label className="flex items-center gap-2.5 text-xs font-semibold text-white cursor-pointer">
              <input
                type="checkbox"
                checked={enabled}
                onChange={(e) => {
                  setEnabled(e.target.checked);
                  markDirty();
                }}
                className="w-4 h-4 accent-[#FF6B1A] cursor-pointer"
              />
              <span>Aktifkan Layar LED</span>
            </label>

            <div>
              <div className="flex justify-between text-[11px] text-slate-300 mb-1">
                <span>Kecerahan</span>
                <span className="font-mono text-white">{Math.round(brightness * 100)}%</span>
              </div>
              <input
                type="range"
                min={0.65}
                max={1.35}
                step={0.05}
                value={brightness}
                onChange={(e) => {
                  setBrightness(Number(e.target.value));
                  markDirty();
                }}
                className="w-full accent-[#FACC15] cursor-pointer"
              />
            </div>

            <div>
              <div className="flex justify-between text-[11px] text-slate-300 mb-1">
                <span>Panel Keliling 360°</span>
                <span className="font-mono text-white">{repeatCount}×</span>
              </div>
              <input
                type="range"
                min={14}
                max={36}
                step={2}
                value={repeatCount}
                onChange={(e) => {
                  setRepeatCount(Number(e.target.value));
                  markDirty();
                }}
                className="w-full accent-cyan-400 cursor-pointer"
              />
            </div>
          </div>
        </div>

        {errorMsg && (
          <div className="p-3 rounded-xl bg-red-500/15 border border-red-400/40 text-xs text-red-200 flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 shrink-0" />
            <span>{errorMsg}</span>
          </div>
        )}

        {lastSavedMs && !dirty && (
          <div className="text-[11px] text-emerald-300 flex items-center gap-1.5">
            <CheckCircle2 className="w-3.5 h-3.5" />
            <span>
              Tersinkronisasi ke Firebase pada {new Date(lastSavedMs).toLocaleString('id-ID')}
            </span>
          </div>
        )}
      </div>

      {/* Playlist Slides Editor */}
      <div className="p-5 rounded-2xl bg-[#0F2957] border border-blue-400/25 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h4 className="font-display font-bold text-base text-white">
              Daftar Playlist Bergantian ({slides.length}/{MAX_LED_SLIDES} Slide)
            </h4>
            <p className="text-xs text-blue-200/80">
              Urutkan slide teks berjalan dan gambar sponsor agar tampil bergantian di layar bawah tribun.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={addTextSlide}
              disabled={slides.length >= MAX_LED_SLIDES}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-[#1D4ED8] hover:bg-blue-600 disabled:opacity-50 text-xs font-semibold text-white cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5" />
              <Type className="w-3.5 h-3.5" />
              <span>Tambah Running Text</span>
            </button>
            <button
              type="button"
              onClick={addSponsorSlide}
              disabled={slides.length >= MAX_LED_SLIDES}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-xs font-semibold text-white cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5" />
              <ImageIcon className="w-3.5 h-3.5" />
              <span>Tambah Gambar Sponsor</span>
            </button>
          </div>
        </div>

        <div className="space-y-3">
          {slides.map((slide, idx) => {
            const slideBytes = new TextEncoder().encode(JSON.stringify(slide)).length;
            const isDataImage = slide.imageUrl.startsWith('data:');
            return (
              <div
                key={slide.id}
                className={`p-4 rounded-xl border transition-colors ${
                  slide.enabled
                    ? 'bg-[#081226] border-blue-400/30'
                    : 'bg-[#081226]/55 border-white/10 opacity-75'
                }`}
              >
                {/* Slide Top Bar */}
                <div className="flex flex-wrap items-center justify-between gap-2 pb-3 mb-3 border-b border-white/10">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="px-2 py-0.5 rounded-md bg-white/10 font-mono text-xs font-bold text-[#FACC15]">
                      #{idx + 1}
                    </span>
                    <span
                      className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-md text-[11px] font-bold ${
                        slide.type === 'image'
                          ? 'bg-emerald-500/20 text-emerald-300'
                          : 'bg-blue-500/20 text-cyan-300'
                      }`}
                    >
                      {slide.type === 'image' ? (
                        <ImageIcon className="w-3 h-3" />
                      ) : (
                        <Type className="w-3 h-3" />
                      )}
                      <span>{slide.type === 'image' ? 'Gambar Sponsor' : 'Running Text'}</span>
                    </span>
                    <input
                      type="text"
                      value={slide.label}
                      maxLength={60}
                      onChange={(e) => updateSlide(slide.id, { label: e.target.value })}
                      placeholder="Nama slide..."
                      className="px-2.5 py-1 rounded-lg bg-[#0F2957] border border-white/15 text-xs font-semibold text-white w-44 sm:w-56"
                    />
                    <span className="text-[11px] font-mono text-slate-400">
                      {formatKb(slideBytes)}
                      {slide.type === 'image' && slide.imageUrl && !isDataImage ? ' (URL · 0 KB gambar)' : ''}
                    </span>
                  </div>

                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => updateSlide(slide.id, { enabled: !slide.enabled })}
                      className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-semibold cursor-pointer ${
                        slide.enabled
                          ? 'bg-emerald-500/20 text-emerald-300 hover:bg-emerald-500/30'
                          : 'bg-slate-700/60 text-slate-300 hover:bg-slate-700'
                      }`}
                      title={slide.enabled ? 'Sembunyikan slide ini' : 'Tampilkan slide ini'}
                    >
                      {slide.enabled ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5" />}
                      <span>{slide.enabled ? 'Aktif' : 'Nonaktif'}</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => moveSlide(idx, -1)}
                      disabled={idx === 0}
                      className="p-1.5 rounded-lg bg-white/5 hover:bg-white/15 disabled:opacity-30 text-slate-200 cursor-pointer"
                      title="Naikkan urutan"
                    >
                      <ArrowUp className="w-3.5 h-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => moveSlide(idx, 1)}
                      disabled={idx === slides.length - 1}
                      className="p-1.5 rounded-lg bg-white/5 hover:bg-white/15 disabled:opacity-30 text-slate-200 cursor-pointer"
                      title="Turunkan urutan"
                    >
                      <ArrowDown className="w-3.5 h-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => removeSlide(slide.id)}
                      disabled={slides.length <= 1}
                      className="p-1.5 rounded-lg bg-red-500/15 hover:bg-red-500/30 disabled:opacity-30 text-red-300 cursor-pointer"
                      title="Hapus slide"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>

                {/* Slide Content Body */}
                {slide.type === 'text' ? (
                  <div className="space-y-3">
                    <div>
                      <label className="block text-[11px] font-semibold text-blue-200 mb-1">
                        Isi Running Text ({slide.text.length}/220 karakter)
                      </label>
                      <input
                        type="text"
                        maxLength={220}
                        value={slide.text}
                        onChange={(e) => updateSlide(slide.id, { text: e.target.value })}
                        placeholder="Contoh: SELAMAT DATANG DI OLIMPIADE EDU RUN ARENA 3D · DIDUKUNG OLEH..."
                        className="w-full px-3 py-2 rounded-lg bg-[#0F2957] border border-white/15 text-sm text-white"
                      />
                    </div>
                  </div>
                ) : (
                  <div className="grid md:grid-cols-12 gap-3 items-start">
                    <div className="md:col-span-7 space-y-2.5">
                      <div className="flex flex-wrap items-center gap-2">
                        <label className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-xs font-semibold text-white cursor-pointer">
                          {compressingId === slide.id ? (
                            <Loader2 className="w-3.5 h-3.5 animate-spin" />
                          ) : (
                            <Upload className="w-3.5 h-3.5" />
                          )}
                          <span>Upload Gambar (Auto-Kompres ≤ 32 KB)</span>
                          <input
                            type="file"
                            accept="image/png,image/jpeg,image/webp"
                            className="hidden"
                            onChange={(e) => {
                              const file = e.target.files?.[0];
                              e.target.value = '';
                              if (file) handleUploadSponsorFile(slide, file);
                            }}
                          />
                        </label>
                        {slide.imageUrl && (
                          <button
                            type="button"
                            onClick={() => updateSlide(slide.id, { imageUrl: '' })}
                            className="px-2.5 py-2 rounded-lg bg-white/5 hover:bg-white/15 text-[11px] text-slate-300 cursor-pointer"
                          >
                            Hapus Gambar
                          </button>
                        )}
                      </div>

                      {compressionNotes[slide.id] && (
                        <div className="text-[11px] text-emerald-300 font-medium">
                          {compressionNotes[slide.id]}
                        </div>
                      )}

                      <div>
                        <label className="flex items-center gap-1 text-[11px] font-semibold text-blue-200 mb-1">
                          <Link2 className="w-3 h-3" />
                          <span>Atau Tempel URL Gambar Sponsor (0 KB Storage Firebase)</span>
                        </label>
                        <input
                          type="url"
                          value={isDataImage ? '' : slide.imageUrl}
                          onChange={(e) => updateSlide(slide.id, { imageUrl: e.target.value.trim() })}
                          placeholder={
                            isDataImage
                              ? 'Saat ini memakai gambar terkompresi (tempel URL jika ingin ganti ke link)'
                              : 'https://contoh.com/banner-sponsor.png'
                          }
                          className="w-full px-3 py-1.5 rounded-lg bg-[#0F2957] border border-white/15 text-xs text-white"
                        />
                      </div>
                    </div>

                    <div className="md:col-span-5">
                      <div className="text-[11px] font-semibold text-blue-200 mb-1">
                        Pratinjau Banner LED (4:1)
                      </div>
                      <div
                        className="w-full h-20 rounded-lg border-2 flex items-center justify-center overflow-hidden p-1.5"
                        style={{
                          backgroundColor: slide.bgHex,
                          borderColor: slide.accentHex,
                        }}
                      >
                        {slide.imageUrl ? (
                          <img
                            src={slide.imageUrl}
                            alt={slide.label}
                            referrerPolicy="no-referrer"
                            className="max-w-full max-h-full object-contain"
                          />
                        ) : (
                          <span className="text-[11px] text-slate-400 text-center px-2">
                            Upload gambar logo/banner sponsor atau tempel URL
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                )}

                {/* Timing, Speed, and Color Controls */}
                <div className="grid sm:grid-cols-12 gap-3 pt-3 mt-3 border-t border-white/10 items-center">
                  <div className="sm:col-span-3">
                    <div className="flex justify-between text-[11px] text-slate-300 mb-1">
                      <span>Durasi Tampil</span>
                      <span className="font-mono text-white">{slide.durationSec} dtk</span>
                    </div>
                    <input
                      type="range"
                      min={4}
                      max={30}
                      step={1}
                      value={slide.durationSec}
                      onChange={(e) => updateSlide(slide.id, { durationSec: Number(e.target.value) })}
                      className="w-full accent-[#FACC15] cursor-pointer"
                    />
                  </div>

                  <div className="sm:col-span-3">
                    <div className="flex justify-between text-[11px] text-slate-300 mb-1">
                      <span>Kecepatan Gerak</span>
                      <span className="font-mono text-white">
                        {slide.scrollSpeed === 0 ? 'Diam' : `${slide.scrollSpeed}/10`}
                      </span>
                    </div>
                    <input
                      type="range"
                      min={0}
                      max={10}
                      step={1}
                      value={slide.scrollSpeed}
                      onChange={(e) => updateSlide(slide.id, { scrollSpeed: Number(e.target.value) })}
                      className="w-full accent-cyan-400 cursor-pointer"
                    />
                  </div>

                  <div className="sm:col-span-6 flex flex-wrap items-center gap-2 justify-between">
                    <div className="flex items-center gap-2 text-[11px] text-slate-300">
                      <label className="flex items-center gap-1 cursor-pointer">
                        <span>Latar</span>
                        <input
                          type="color"
                          value={slide.bgHex}
                          onChange={(e) => updateSlide(slide.id, { bgHex: e.target.value })}
                          className="w-6 h-6 rounded border-0 bg-transparent cursor-pointer"
                        />
                      </label>
                      {slide.type === 'text' && (
                        <label className="flex items-center gap-1 cursor-pointer">
                          <span>Teks</span>
                          <input
                            type="color"
                            value={slide.textHex}
                            onChange={(e) => updateSlide(slide.id, { textHex: e.target.value })}
                            className="w-6 h-6 rounded border-0 bg-transparent cursor-pointer"
                          />
                        </label>
                      )}
                      <label className="flex items-center gap-1 cursor-pointer">
                        <span>Garis LED</span>
                        <input
                          type="color"
                          value={slide.accentHex}
                          onChange={(e) => updateSlide(slide.id, { accentHex: e.target.value })}
                          className="w-6 h-6 rounded border-0 bg-transparent cursor-pointer"
                        />
                      </label>
                    </div>

                    <div className="flex flex-wrap items-center gap-1">
                      {COLOR_PRESETS.map((preset) => (
                        <button
                          key={preset.name}
                          type="button"
                          onClick={() =>
                            updateSlide(slide.id, {
                              bgHex: preset.bgHex,
                              textHex: preset.textHex,
                              accentHex: preset.accentHex,
                            })
                          }
                          title={preset.name}
                          className="w-5 h-5 rounded-md border border-white/30 cursor-pointer"
                          style={{
                            background: `linear-gradient(135deg, ${preset.bgHex} 55%, ${preset.accentHex} 55%)`,
                          }}
                        />
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
