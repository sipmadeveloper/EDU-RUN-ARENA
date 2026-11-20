import * as THREE from 'three';
import {
  DEFAULT_STADIUM_LED_CONFIG,
  type StadiumLedConfig,
  type StadiumLedSlide,
} from '../services/stadiumLedStore';

export interface PerimeterLedController {
  texture: THREE.CanvasTexture;
  material: THREE.MeshBasicMaterial;
  setConfig: (config: StadiumLedConfig) => void;
  update: (dt: number) => void;
  dispose: () => void;
}

const CANVAS_W = 2048;
const CANVAS_H = 256;
const TRANSITION_SEC = 0.45;

export function createPerimeterLedController(
  initialConfig: StadiumLedConfig = DEFAULT_STADIUM_LED_CONFIG
): PerimeterLedController {
  const canvas = document.createElement('canvas');
  canvas.width = CANVAS_W;
  canvas.height = CANVAS_H;
  const ctx = canvas.getContext('2d')!;

  // Scratch canvases for smooth cross-fade transitions between slides (allocated once, zero GC in tick)
  const prevCanvas = document.createElement('canvas');
  prevCanvas.width = CANVAS_W;
  prevCanvas.height = CANVAS_H;
  const prevCtx = prevCanvas.getContext('2d')!;

  const nextCanvas = document.createElement('canvas');
  nextCanvas.width = CANVAS_W;
  nextCanvas.height = CANVAS_H;
  const nextCtx = nextCanvas.getContext('2d')!;

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.anisotropy = 4;

  const material = new THREE.MeshBasicMaterial({
    map: texture,
    color: new THREE.Color(1, 1, 1),
  });

  // Cache loaded sponsor HTMLImageElements by URL
  const imageCache = new Map<string, { status: 'loading' | 'ready' | 'error'; img?: HTMLImageElement }>();

  let config: StadiumLedConfig = initialConfig;
  let activeSlides: StadiumLedSlide[] = [];
  let currentIdx = 0;
  let slideElapsed = 0;
  let dirty = true;
  let wasTransitioning = false;
  let transitionDrawAccum = 0;
  let disposed = false;

  function ensureImageLoaded(url: string) {
    if (!url || imageCache.has(url)) return;
    const entry: { status: 'loading' | 'ready' | 'error'; img?: HTMLImageElement } = {
      status: 'loading',
    };
    imageCache.set(url, entry);

    const img = new Image();
    if (!url.startsWith('data:')) {
      img.crossOrigin = 'anonymous';
    }
    img.onload = () => {
      if (disposed) return;
      entry.status = 'ready';
      entry.img = img;
      dirty = true;
    };
    img.onerror = () => {
      if (disposed) return;
      entry.status = 'error';
      dirty = true;
    };
    img.src = url;
  }

  function drawLedScanlines(targetCtx: CanvasRenderingContext2D) {
    targetCtx.fillStyle = 'rgba(0, 0, 0, 0.14)';
    for (let y = 0; y < CANVAS_H; y += 8) {
      targetCtx.fillRect(0, y, CANVAS_W, 2);
    }
  }

  function drawSlideToContext(targetCtx: CanvasRenderingContext2D, slide: StadiumLedSlide) {
    const bg = slide.bgHex || '#071530';
    const accent = slide.accentHex || '#FACC15';
    const textCol = slide.textHex || '#FFFFFF';

    targetCtx.clearRect(0, 0, CANVAS_W, CANVAS_H);
    targetCtx.fillStyle = bg;
    targetCtx.fillRect(0, 0, CANVAS_W, CANVAS_H);

    // Subtle stadium horizontal gradient sheen
    const grad = targetCtx.createLinearGradient(0, 0, 0, CANVAS_H);
    grad.addColorStop(0, 'rgba(255,255,255,0.08)');
    grad.addColorStop(0.5, 'rgba(255,255,255,0.0)');
    grad.addColorStop(1, 'rgba(0,0,0,0.22)');
    targetCtx.fillStyle = grad;
    targetCtx.fillRect(0, 0, CANVAS_W, CANVAS_H);

    // Top & bottom glowing LED trim bars
    targetCtx.fillStyle = accent;
    targetCtx.fillRect(0, 0, CANVAS_W, 16);
    targetCtx.fillRect(0, CANVAS_H - 16, CANVAS_W, 16);

    if (slide.type === 'image' && slide.imageUrl) {
      ensureImageLoaded(slide.imageUrl);
      const cached = imageCache.get(slide.imageUrl);
      if (cached && cached.status === 'ready' && cached.img) {
        // Draw 2 side-by-side crisp sponsor panels across the 2048x256 ribbon (each 1024x224)
        const panelW = CANVAS_W / 2;
        const innerY = 20;
        const innerH = CANVAS_H - 40;
        const padX = 28;
        const maxW = panelW - padX * 2;
        const img = cached.img;
        const scale = Math.min(maxW / img.width, innerH / img.height);
        const drawW = Math.max(1, img.width * scale);
        const drawH = Math.max(1, img.height * scale);

        for (let p = 0; p < 2; p++) {
          const offsetX = p * panelW;
          const dx = offsetX + (panelW - drawW) / 2;
          const dy = innerY + (innerH - drawH) / 2;
          targetCtx.drawImage(img, dx, dy, drawW, drawH);

          // Crisp vertical LED divider bar between repeated sponsor banners
          targetCtx.fillStyle = accent;
          targetCtx.globalAlpha = 0.55;
          targetCtx.fillRect(offsetX, 24, 6, CANVAS_H - 48);
          targetCtx.globalAlpha = 1;
        }
        drawLedScanlines(targetCtx);
        return;
      }
    }

    // Running text slide (or clean branded fallback while an external sponsor URL loads)
    const rawMsg =
      slide.type === 'image'
        ? slide.label || 'SPONSOR RESMI EDU RUN ARENA 3D'
        : slide.text || slide.label || 'EDU RUN ARENA 3D';
    const message = rawMsg.toUpperCase();

    targetCtx.textBaseline = 'middle';
    targetCtx.textAlign = 'center';

    // Choose font size adaptively so long messages stay crisp and readable around the perimeter
    let fontSize = 86;
    targetCtx.font = `900 ${fontSize}px Outfit, system-ui, -apple-system, sans-serif`;
    const measured = targetCtx.measureText(message).width;
    if (measured > CANVAS_W - 180) {
      fontSize = Math.max(48, Math.floor((fontSize * (CANVAS_W - 180)) / measured));
      targetCtx.font = `900 ${fontSize}px Outfit, system-ui, -apple-system, sans-serif`;
    }

    // Glowing diamond emblem dividers at left & right edges for seamless 360° wrap
    targetCtx.fillStyle = accent;
    targetCtx.beginPath();
    targetCtx.moveTo(46, CANVAS_H / 2 - 22);
    targetCtx.lineTo(68, CANVAS_H / 2);
    targetCtx.lineTo(46, CANVAS_H / 2 + 22);
    targetCtx.lineTo(24, CANVAS_H / 2);
    targetCtx.closePath();
    targetCtx.fill();

    targetCtx.save();
    targetCtx.shadowColor = accent;
    targetCtx.shadowBlur = 18;
    targetCtx.fillStyle = textCol;
    targetCtx.fillText(message, CANVAS_W / 2, CANVAS_H / 2 + 4, CANVAS_W - 150);
    targetCtx.restore();

    drawLedScanlines(targetCtx);
  }

  function applyConfig(nextCfg: StadiumLedConfig) {
    config = nextCfg;
    const enabledSlides = nextCfg.slides.filter((s) => s.enabled);
    activeSlides =
      enabledSlides.length > 0 ? enabledSlides : DEFAULT_STADIUM_LED_CONFIG.slides;

    if (currentIdx >= activeSlides.length) {
      currentIdx = 0;
      slideElapsed = 0;
    }

    // Preload any sponsor images immediately
    for (const s of activeSlides) {
      if (s.type === 'image' && s.imageUrl) {
        ensureImageLoaded(s.imageUrl);
      }
    }

    // Negative repeat.x makes text & sponsor logos read naturally LEFT-TO-RIGHT on inward-facing oval walls
    const repeat = Math.max(12, Math.min(40, Math.round(nextCfg.repeatCount || 24)));
    texture.repeat.set(-repeat, 1);

    const b = Math.max(0.6, Math.min(1.4, nextCfg.brightness || 1.05));
    material.color.setRGB(b, b, b);
    material.visible = nextCfg.enabled !== false;

    dirty = true;
    wasTransitioning = false;
  }

  applyConfig(initialConfig);

  function update(dt: number) {
    if (disposed || !config.enabled || activeSlides.length === 0) return;

    const currentSlide = activeSlides[currentIdx];
    const dur = Math.max(4, currentSlide.durationSec || 8);
    slideElapsed += dt;

    if (slideElapsed >= dur && activeSlides.length > 1) {
      slideElapsed = slideElapsed % dur;
      currentIdx = (currentIdx + 1) % activeSlides.length;
      dirty = true;
      wasTransitioning = false;
    }

    const slide = activeSlides[currentIdx];
    const hasMultiple = activeSlides.length > 1;
    const timeRemaining = Math.max(0, Math.max(4, slide.durationSec || 8) - slideElapsed);
    const inTransition = hasMultiple && timeRemaining <= TRANSITION_SEC;

    // Smooth GPU UV marquee scroll (leftward across viewer eyes)
    const speed = Math.max(0, Math.min(10, slide.scrollSpeed ?? 0));
    if (speed > 0) {
      texture.offset.x = (texture.offset.x + speed * 0.048 * dt) % 1;
    }

    if (inTransition) {
      transitionDrawAccum += dt;
      if (!wasTransitioning) {
        // Render both source and destination slides ONCE at transition start
        const nextSlide = activeSlides[(currentIdx + 1) % activeSlides.length];
        drawSlideToContext(prevCtx, slide);
        drawSlideToContext(nextCtx, nextSlide);
      }
      if (!wasTransitioning || transitionDrawAccum >= 0.05) {
        transitionDrawAccum = 0;
        wasTransitioning = true;
        const alpha = THREE.MathUtils.clamp(1 - timeRemaining / TRANSITION_SEC, 0, 1);
        ctx.clearRect(0, 0, CANVAS_W, CANVAS_H);
        ctx.drawImage(prevCanvas, 0, 0);
        ctx.save();
        ctx.globalAlpha = alpha;
        ctx.drawImage(nextCanvas, 0, 0);
        ctx.restore();
        texture.needsUpdate = true;
      }
      return;
    }

    if (dirty || wasTransitioning) {
      dirty = false;
      wasTransitioning = false;
      drawSlideToContext(ctx, slide);
      texture.needsUpdate = true;
    }
  }

  // Paint initial frame immediately
  update(0);

  return {
    texture,
    material,
    setConfig: applyConfig,
    update,
    dispose: () => {
      disposed = true;
      imageCache.clear();
      texture.dispose();
      material.dispose();
    },
  };
}
