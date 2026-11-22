import * as THREE from 'three';

export interface PodiumBackdropWinner {
  rank: number;
  name: string;
  score: number;
}

export const PODIUM_APP_LOGO_SRC =
  '/assets/aistudio/file_0000000043908211ab498b6aee2c83f0_adb48a40.png';

function fitCanvasText(
  ctx: CanvasRenderingContext2D,
  raw: string,
  maxWidth: number
): string {
  const text = (raw || '').trim();
  if (!text) return '—';
  if (ctx.measureText(text).width <= maxWidth) return text;
  let end = text.length;
  while (end > 1 && ctx.measureText(`${text.slice(0, end)}…`).width > maxWidth) {
    end -= 1;
  }
  return `${text.slice(0, end)}…`;
}

function formatBackdropScore(score: number): string {
  const rounded = Number((score || 0).toFixed(1));
  return `${Number.isInteger(rounded) ? rounded : rounded.toFixed(1)}p`;
}

function drawRankingPanel(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  title: string,
  startRank: number,
  endRank: number,
  winnerByRank: Map<number, PodiumBackdropWinner>,
  accentHex: string
) {
  ctx.save();
  ctx.fillStyle = 'rgba(7, 19, 43, 0.84)';
  ctx.strokeStyle = 'rgba(250, 204, 21, 0.42)';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, 18);
  ctx.fill();
  ctx.stroke();

  const headerH = 56;
  const hGrad = ctx.createLinearGradient(x, y, x + w, y);
  hGrad.addColorStop(0, accentHex);
  hGrad.addColorStop(1, 'rgba(15, 42, 94, 0.95)');
  ctx.fillStyle = hGrad;
  ctx.beginPath();
  ctx.roundRect(x + 2, y + 2, w - 4, headerH, [16, 16, 4, 4]);
  ctx.fill();

  ctx.fillStyle = '#FFFFFF';
  ctx.font = '800 24px system-ui, -apple-system, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(title, x + w / 2, y + headerH / 2 + 2);

  const rowCount = endRank - startRank + 1;
  const listTop = y + headerH + 10;
  const listH = h - headerH - 18;
  const rowH = listH / rowCount;

  for (let i = 0; i < rowCount; i++) {
    const rank = startRank + i;
    const entry = winnerByRank.get(rank);
    const ry = listTop + i * rowH;
    const midY = ry + rowH / 2;

    const isTop3 = rank <= 3;
    ctx.fillStyle = isTop3
      ? rank === 1
        ? 'rgba(250, 204, 21, 0.20)'
        : rank === 2
        ? 'rgba(226, 232, 240, 0.16)'
        : 'rgba(249, 115, 22, 0.16)'
      : i % 2 === 0
      ? 'rgba(30, 58, 138, 0.28)'
      : 'rgba(15, 23, 42, 0.22)';
    ctx.beginPath();
    ctx.roundRect(x + 12, ry + 2, w - 24, rowH - 4, 8);
    ctx.fill();

    const badgeW = 62;
    const badgeH = Math.max(24, rowH - 10);
    const badgeX = x + 18;
    const badgeY = midY - badgeH / 2;
    ctx.fillStyle =
      rank === 1
        ? '#FACC15'
        : rank === 2
        ? '#CBD5E1'
        : rank === 3
        ? '#F97316'
        : rank === 4
        ? '#38BDF8'
        : entry
        ? '#1E3A8A'
        : 'rgba(30, 41, 59, 0.6)';
    ctx.beginPath();
    ctx.roundRect(badgeX, badgeY, badgeW, badgeH, 6);
    ctx.fill();

    ctx.fillStyle = rank <= 4 ? '#07132B' : entry ? '#E2E8F0' : '#64748B';
    ctx.font = '800 20px ui-monospace, SFMono-Regular, monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(`#${rank}`, badgeX + badgeW / 2, midY + 1);

    const nameX = badgeX + badgeW + 14;
    const scoreRightX = x + w - 22;
    const maxNameW = w - badgeW - 140;

    if (entry) {
      ctx.fillStyle = rank === 1 ? '#FEF08A' : '#F8FAFC';
      ctx.font =
        rank <= 3
          ? '800 22px system-ui, -apple-system, sans-serif'
          : '600 21px system-ui, -apple-system, sans-serif';
      ctx.textAlign = 'left';
      ctx.fillText(fitCanvasText(ctx, entry.name, maxNameW), nameX, midY + 1);

      ctx.fillStyle = rank === 1 ? '#FACC15' : '#7DD3FC';
      ctx.font = '800 21px ui-monospace, SFMono-Regular, monospace';
      ctx.textAlign = 'right';
      ctx.fillText(formatBackdropScore(entry.score), scoreRightX, midY + 1);
    } else {
      ctx.fillStyle = 'rgba(148, 163, 184, 0.38)';
      ctx.font = '600 19px system-ui, -apple-system, sans-serif';
      ctx.textAlign = 'left';
      ctx.fillText('—', nameX, midY + 1);
    }
  }

  ctx.restore();
}

/**
 * Draws the 1920x840 victory podium backdrop:
 * - Left panel: Ranked winners #1 – #15
 * - Center: Official application logo
 * - Right panel: Ranked winners #16 – #30
 */
export function drawVictoryPodiumBackdrop(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  winners: PodiumBackdropWinner[],
  logoImg: HTMLImageElement | null
) {
  const grad = ctx.createLinearGradient(0, 0, width, height);
  grad.addColorStop(0, '#051026');
  grad.addColorStop(0.5, '#0F2A5E');
  grad.addColorStop(1, '#051026');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, width, height);

  const glow = ctx.createRadialGradient(width / 2, height / 2, 40, width / 2, height / 2, 460);
  glow.addColorStop(0, 'rgba(56, 189, 248, 0.34)');
  glow.addColorStop(0.55, 'rgba(250, 204, 21, 0.14)');
  glow.addColorStop(1, 'rgba(6, 19, 44, 0)');
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, width, height);

  ctx.strokeStyle = '#FACC15';
  ctx.lineWidth = 10;
  ctx.strokeRect(16, 16, width - 32, height - 32);

  const winnerByRank = new Map<number, PodiumBackdropWinner>();
  for (let i = 0; i < winners.length && i < 30; i++) {
    const item = winners[i];
    const rank = item.rank >= 1 && item.rank <= 30 ? item.rank : i + 1;
    if (!winnerByRank.has(rank)) {
      winnerByRank.set(rank, { ...item, rank });
    }
  }

  const panelPad = 36;
  const panelW = 610;
  const panelH = height - panelPad * 2;

  // Left board: Ranks 1 – 15
  drawRankingPanel(
    ctx,
    panelPad,
    panelPad,
    panelW,
    panelH,
    'PERINGKAT 1 – 15',
    1,
    15,
    winnerByRank,
    'rgba(217, 119, 6, 0.92)'
  );

  // Right board: Ranks 16 – 30
  drawRankingPanel(
    ctx,
    width - panelPad - panelW,
    panelPad,
    panelW,
    panelH,
    'PERINGKAT 16 – 30',
    16,
    30,
    winnerByRank,
    'rgba(2, 132, 199, 0.92)'
  );

  // Center zone: Official application logo cleanly framed between the two boards
  const centerZoneW = width - (panelPad + panelW) * 2 - 36;
  const centerZoneH = height - 120;
  if (logoImg && logoImg.complete && logoImg.naturalWidth > 0) {
    const aspect = logoImg.naturalWidth / logoImg.naturalHeight;
    let drawW = centerZoneW;
    let drawH = drawW / aspect;
    if (drawH > centerZoneH) {
      drawH = centerZoneH;
      drawW = drawH * aspect;
    }
    const dx = (width - drawW) / 2;
    const dy = (height - drawH) / 2;
    ctx.save();
    ctx.shadowColor = 'rgba(0, 0, 0, 0.6)';
    ctx.shadowBlur = 28;
    ctx.shadowOffsetY = 8;
    ctx.drawImage(logoImg, dx, dy, drawW, drawH);
    ctx.restore();
  } else {
    ctx.save();
    ctx.fillStyle = '#FACC15';
    ctx.font = '900 44px system-ui, -apple-system, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('EDU RUN', width / 2, height / 2 - 26);
    ctx.fillStyle = '#FFFFFF';
    ctx.font = '800 36px system-ui, -apple-system, sans-serif';
    ctx.fillText('ARENA 3D', width / 2, height / 2 + 26);
    ctx.restore();
  }
}

export function createPodiumBackdropTexture(
  winners: PodiumBackdropWinner[],
  anisotropy = 4
): {
  texture: THREE.CanvasTexture;
  updateWinners: (nextWinners: PodiumBackdropWinner[]) => void;
  dispose: () => void;
} {
  const canvas = document.createElement('canvas');
  canvas.width = 1920;
  canvas.height = 840;
  const ctx = canvas.getContext('2d')!;
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = anisotropy;

  let disposed = false;
  let logoImg: HTMLImageElement | null = null;
  let currentWinners = winners.slice(0, 30);

  const redraw = () => {
    if (disposed) return;
    drawVictoryPodiumBackdrop(ctx, canvas.width, canvas.height, currentWinners, logoImg);
    texture.needsUpdate = true;
  };

  redraw();
  if (typeof Image !== 'undefined') {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      logoImg = img;
      redraw();
    };
    img.src = PODIUM_APP_LOGO_SRC;
  }

  return {
    texture,
    updateWinners(nextWinners: PodiumBackdropWinner[]) {
      currentWinners = nextWinners.slice(0, 30);
      redraw();
    },
    dispose() {
      disposed = true;
      texture.dispose();
    },
  };
}
