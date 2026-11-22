import * as THREE from 'three';

export interface TrackPose {
  x: number;
  z: number;
  yaw: number;
  fx: number;
  fz: number;
}

export function evaluateStadiumOval(
  sInput: number,
  radius: number,
  straightLen: number,
  centerRadiusForLength: number,
  out?: TrackPose
): TrackPose {
  const s = ((sInput % 1) + 1) % 1;
  const halfL = straightLen / 2;
  const curveLen = Math.PI * centerRadiusForLength;
  const totalP = 2 * straightLen + 2 * curveLen;
  const dist = s * totalP;

  let x = 0;
  let z = 0;
  let fx = 1;
  let fz = 0;

  if (dist < halfL) {
    x = dist;
    z = radius;
    fx = 1;
    fz = 0;
  } else if (dist < halfL + curveLen) {
    const u = (dist - halfL) / curveLen;
    const theta = Math.PI / 2 - u * Math.PI;
    x = halfL + radius * Math.cos(theta);
    z = radius * Math.sin(theta);
    fx = Math.sin(theta);
    fz = -Math.cos(theta);
  } else if (dist < halfL + curveLen + straightLen) {
    const d = dist - (halfL + curveLen);
    x = halfL - d;
    z = -radius;
    fx = -1;
    fz = 0;
  } else if (dist < halfL + 2 * curveLen + straightLen) {
    const u = (dist - (halfL + curveLen + straightLen)) / curveLen;
    const theta = -Math.PI / 2 - u * Math.PI;
    x = -halfL + radius * Math.cos(theta);
    z = radius * Math.sin(theta);
    fx = Math.sin(theta);
    fz = -Math.cos(theta);
  } else {
    const d = dist - (halfL + 2 * curveLen + straightLen);
    x = -halfL + d;
    z = radius;
    fx = 1;
    fz = 0;
  }

  const yaw = Math.atan2(fx, fz);
  if (out) {
    out.x = x;
    out.z = z;
    out.yaw = yaw;
    out.fx = fx;
    out.fz = fz;
    return out;
  }
  return { x, z, yaw, fx, fz };
}

export function buildOvalRibbonGeometry(
  innerR: number,
  outerR: number,
  straightLen: number,
  segments: number,
  vRepeat: number,
  centerRadiusForLength?: number
): THREE.BufferGeometry {
  const midR = centerRadiusForLength ?? (innerR + outerR) / 2;
  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];

  for (let i = 0; i <= segments; i++) {
    const s = i / segments;
    const pIn = evaluateStadiumOval(s, innerR, straightLen, midR);
    const pOut = evaluateStadiumOval(s, outerR, straightLen, midR);

    positions.push(pIn.x, 0, pIn.z);
    positions.push(pOut.x, 0, pOut.z);
    normals.push(0, 1, 0, 0, 1, 0);

    const v = s * vRepeat;
    uvs.push(0, v);
    uvs.push(1, v);

    if (i < segments) {
      const a = i * 2;
      const b = a + 1;
      const c = a + 2;
      const d = a + 3;
      indices.push(a, b, c);
      indices.push(b, d, c);
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  return geo;
}

export function buildSlopedOvalRibbonGeometry(
  innerR: number,
  innerY: number,
  outerR: number,
  outerY: number,
  straightLen: number,
  midR: number,
  segments: number,
  uRepeat: number,
  vRepeat: number,
  flipDown = false
): THREE.BufferGeometry {
  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];

  const dR = outerR - innerR;
  const dY = outerY - innerY;
  const len = Math.hypot(dR, dY) || 1;
  const nRadial = -dY / len;
  const nUp = dR / len;
  const sign = flipDown ? -1 : 1;

  for (let i = 0; i <= segments; i++) {
    const s = i / segments;
    const pIn = evaluateStadiumOval(s, innerR, straightLen, midR);
    const pOut = evaluateStadiumOval(s, outerR, straightLen, midR);

    // Outward radial unit vector in XZ is (-fz, 0, fx)
    const nx = -pIn.fz * nRadial * sign;
    const ny = nUp * sign;
    const nz = pIn.fx * nRadial * sign;

    positions.push(pIn.x, innerY, pIn.z);
    positions.push(pOut.x, outerY, pOut.z);
    normals.push(nx, ny, nz, nx, ny, nz);

    const v = s * vRepeat;
    uvs.push(0, v);
    uvs.push(uRepeat, v);

    if (i < segments) {
      const a = i * 2;
      const b = a + 1;
      const c = a + 2;
      const d = a + 3;
      if (flipDown) {
        indices.push(a, c, b);
        indices.push(b, c, d);
      } else {
        indices.push(a, b, c);
        indices.push(b, d, c);
      }
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  return geo;
}

export function buildOvalWallGeometry(
  radius: number,
  yBottom: number,
  yTop: number,
  straightLen: number,
  midR: number,
  segments: number,
  uRepeat: number,
  inwardFacing: boolean,
  skipSegment?: (sMid: number, pMid: TrackPose) => boolean
): THREE.BufferGeometry {
  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];

  for (let i = 0; i <= segments; i++) {
    const s = i / segments;
    const p = evaluateStadiumOval(s, radius, straightLen, midR);
    // Outward radial is (-fz, 0, fx); inward radial is (fz, 0, -fx)
    const nx = inwardFacing ? p.fz : -p.fz;
    const nz = inwardFacing ? -p.fx : p.fx;

    positions.push(p.x, yBottom, p.z);
    positions.push(p.x, yTop, p.z);
    normals.push(nx, 0, nz, nx, 0, nz);

    const u = s * uRepeat;
    uvs.push(u, 0);
    uvs.push(u, 1);

    if (i < segments) {
      const sMid = (i + 0.5) / segments;
      const shouldSkip = skipSegment
        ? skipSegment(sMid, evaluateStadiumOval(sMid, radius, straightLen, midR))
        : false;
      if (!shouldSkip) {
        const a = i * 2;
        const b = a + 1;
        const c = a + 2;
        const d = a + 3;
        if (inwardFacing) {
          indices.push(a, b, c);
          indices.push(b, d, c);
        } else {
          indices.push(a, c, b);
          indices.push(b, c, d);
        }
      }
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  return geo;
}

export function buildSteppedBowlGeometry(
  baseR: number,
  baseY: number,
  tierCount: number,
  tierDepth: number,
  tierHeightStep: number,
  straightLen: number,
  midR: number,
  segments: number,
  perimeterRepeat = 64,
  skipSegment?: (sMid: number, pMid: TrackPose) => boolean
): THREE.BufferGeometry {
  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  let vertexOffset = 0;

  const skipFlags: boolean[] | null = skipSegment
    ? Array.from({ length: segments }, (_, i) => {
        const sMid = (i + 0.5) / segments;
        return skipSegment(sMid, evaluateStadiumOval(sMid, baseR, straightLen, midR));
      })
    : null;

  for (let t = 0; t < tierCount; t++) {
    const rIn = baseR + t * tierDepth;
    const rOut = rIn + tierDepth;
    const yLow = baseY + t * tierHeightStep;
    const yHigh = yLow + tierHeightStep;

    // 1. Vertical inward riser
    for (let i = 0; i <= segments; i++) {
      const s = i / segments;
      const p = evaluateStadiumOval(s, rIn, straightLen, midR);
      positions.push(p.x, yLow, p.z, p.x, yHigh, p.z);
      normals.push(p.fz, 0, -p.fx, p.fz, 0, -p.fx);
      const u = s * perimeterRepeat;
      uvs.push(u, 0, u, 0.28);

      if (i < segments && !(skipFlags && skipFlags[i])) {
        const a = vertexOffset + i * 2;
        const b = a + 1;
        const c = a + 2;
        const d = a + 3;
        indices.push(a, b, c, b, d, c);
      }
    }
    vertexOffset += (segments + 1) * 2;

    // 2. Horizontal seating tread
    for (let i = 0; i <= segments; i++) {
      const s = i / segments;
      const pIn = evaluateStadiumOval(s, rIn, straightLen, midR);
      const pOut = evaluateStadiumOval(s, rOut, straightLen, midR);
      positions.push(pIn.x, yHigh, pIn.z, pOut.x, yHigh, pOut.z);
      normals.push(0, 1, 0, 0, 1, 0);
      const u = s * perimeterRepeat;
      uvs.push(u, 0.28, u, 1.0);

      if (i < segments && !(skipFlags && skipFlags[i])) {
        const a = vertexOffset + i * 2;
        const b = a + 1;
        const c = a + 2;
        const d = a + 3;
        indices.push(a, b, c, b, d, c);
      }
    }
    vertexOffset += (segments + 1) * 2;
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  return geo;
}

export function buildOvalShape(radius: number, straightLen: number): THREE.Shape {
  const halfL = straightLen / 2;
  const shape = new THREE.Shape();
  shape.moveTo(-halfL, radius);
  shape.lineTo(halfL, radius);
  shape.absarc(halfL, 0, radius, Math.PI / 2, -Math.PI / 2, true);
  shape.lineTo(-halfL, -radius);
  shape.absarc(-halfL, 0, radius, -Math.PI / 2, -Math.PI * 1.5, true);
  return shape;
}

export function createTrackTexture(laneCount: number): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 2048;
  canvas.height = 512;
  const ctx = canvas.getContext('2d')!;

  ctx.fillStyle = '#C9242B';
  ctx.fillRect(0, 0, 2048, 512);

  for (let i = 0; i < 9000; i++) {
    ctx.fillStyle = i % 2 === 0 ? 'rgba(255,255,255,0.045)' : 'rgba(0,0,0,0.05)';
    ctx.fillRect(Math.random() * 2048, Math.random() * 512, 3, 3);
  }

  const lanePx = 2048 / laneCount;
  for (let l = 0; l < laneCount; l++) {
    if (l % 2 === 1) {
      ctx.fillStyle = 'rgba(0,0,0,0.045)';
      ctx.fillRect(l * lanePx, 0, lanePx, 512);
    }
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(l * lanePx - 2, 0, 4, 512);
  }
  ctx.fillStyle = '#FFFFFF';
  ctx.fillRect(2044, 0, 4, 512);

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

export function createInfieldPitchTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 1024;
  canvas.height = 512;
  const ctx = canvas.getContext('2d')!;

  for (let i = 0; i < 16; i++) {
    ctx.fillStyle = i % 2 === 0 ? '#166534' : '#15803D';
    ctx.fillRect(i * 64, 0, 64, 512);
  }
  for (let i = 0; i < 4000; i++) {
    ctx.fillStyle = i % 2 === 0 ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.04)';
    ctx.fillRect(Math.random() * 1024, Math.random() * 512, 2, 2);
  }

  ctx.strokeStyle = 'rgba(255, 255, 255, 0.85)';
  ctx.lineWidth = 6;
  ctx.strokeRect(110, 66, 804, 380);
  ctx.beginPath();
  ctx.moveTo(512, 66);
  ctx.lineTo(512, 446);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(512, 256, 62, 0, Math.PI * 2);
  ctx.stroke();
  ctx.strokeRect(110, 156, 95, 200);
  ctx.strokeRect(819, 156, 95, 200);
  ctx.strokeRect(110, 206, 36, 100);
  ctx.strokeRect(878, 206, 36, 100);
  ctx.fillStyle = 'rgba(255, 255, 255, 0.9)';
  [
    [512, 256],
    [176, 256],
    [848, 256],
  ].forEach(([sx, sy]) => {
    ctx.beginPath();
    ctx.arc(sx, sy, 5, 0, Math.PI * 2);
    ctx.fill();
  });

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export function createGoalNetTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 128;
  const ctx = canvas.getContext('2d')!;
  ctx.clearRect(0, 0, 128, 128);
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.72)';
  ctx.lineWidth = 2;
  const step = 16;
  for (let i = 0; i <= 128; i += step) {
    ctx.beginPath();
    ctx.moveTo(i, 0);
    ctx.lineTo(i, 128);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(0, i);
    ctx.lineTo(128, i);
    ctx.stroke();
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(8, 4);
  return tex;
}

export function createFloodlightHaloTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 256;
  const ctx = canvas.getContext('2d')!;
  const grad = ctx.createRadialGradient(128, 128, 4, 128, 128, 128);
  grad.addColorStop(0.0, 'rgba(255, 253, 232, 0.95)');
  grad.addColorStop(0.22, 'rgba(254, 249, 195, 0.55)');
  grad.addColorStop(0.55, 'rgba(253, 230, 138, 0.16)');
  grad.addColorStop(1.0, 'rgba(253, 230, 138, 0.0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 256, 256);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export function createStartFinishBannerTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 2048;
  canvas.height = 256;
  const ctx = canvas.getContext('2d')!;

  // 1. Clean checkered racing ends strictly confined to left (0..192) and right (1856..2048) margins
  const sq = 32;
  const endBandW = 192;
  for (let y = 0; y < 256; y += sq) {
    for (let x = 0; x < endBandW; x += sq) {
      const dark = ((x / sq) + (y / sq)) % 2 === 0;
      ctx.fillStyle = dark ? '#081226' : '#FFFFFF';
      ctx.fillRect(x, y, sq, sq);
    }
    for (let x = 2048 - endBandW; x < 2048; x += sq) {
      const dark = ((x / sq) + (y / sq)) % 2 === 0;
      ctx.fillStyle = dark ? '#081226' : '#FFFFFF';
      ctx.fillRect(x, y, sq, sq);
    }
  }

  // 2. Solid deep-navy center signboard (1664px wide) — zero checkered overlap behind text
  const panelX = endBandW;
  const panelW = 2048 - endBandW * 2;
  const bgGrad = ctx.createLinearGradient(0, 0, 0, 256);
  bgGrad.addColorStop(0, '#081736');
  bgGrad.addColorStop(0.5, '#0F2957');
  bgGrad.addColorStop(1, '#081736');
  ctx.fillStyle = bgGrad;
  ctx.fillRect(panelX, 0, panelW, 256);

  // Crisp gold championship border cleanly framing the signboard
  ctx.strokeStyle = '#FACC15';
  ctx.lineWidth = 8;
  ctx.strokeRect(panelX + 10, 10, panelW - 20, 236);

  // 3. Top orange ribbon
  ctx.fillStyle = '#FF6B1A';
  ctx.fillRect(panelX + 28, 24, panelW - 56, 44);
  ctx.fillStyle = '#FFFFFF';
  ctx.font = 'bold 24px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('EDU RUN ARENA 3D · INTERNATIONAL CHAMPIONSHIP TRACK', 1024, 47, panelW - 96);

  // 4. Bold, unobstructed START / FINISH centerpiece with wide side margins
  ctx.save();
  ctx.font = '900 108px sans-serif';
  ctx.textBaseline = 'middle';
  ctx.shadowColor = 'rgba(0, 0, 0, 0.55)';
  ctx.shadowBlur = 10;
  ctx.shadowOffsetY = 4;

  // Draw crisp START · / · FINISH balanced symmetrically around x = 1024
  ctx.textAlign = 'right';
  ctx.fillStyle = '#FFFFFF';
  ctx.fillText('START', 960, 158, 620);

  ctx.textAlign = 'center';
  ctx.fillStyle = '#FACC15';
  ctx.fillText('/', 1024, 158);

  ctx.textAlign = 'left';
  ctx.fillStyle = '#FFFFFF';
  ctx.fillText('FINISH', 1088, 158, 620);
  ctx.restore();

  // Subtle gold accent bars flanking the title inside the navy box
  ctx.fillStyle = '#FACC15';
  ctx.fillRect(panelX + 54, 149, 110, 10);
  ctx.fillRect(panelX + panelW - 164, 149, 110, 10);

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export function createCheckeredLineTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 1024;
  canvas.height = 64;
  const ctx = canvas.getContext('2d')!;
  const sq = 32;
  for (let y = 0; y < 64; y += sq) {
    for (let x = 0; x < 1024; x += sq) {
      const dark = (x / sq + y / sq) % 2 === 0;
      ctx.fillStyle = dark ? '#0F172A' : '#FFFFFF';
      ctx.fillRect(x, y, sq, sq);
    }
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export function createGateGroundLineTexture(gateNumber: number): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 1024;
  canvas.height = 96;
  const ctx = canvas.getContext('2d')!;

  ctx.fillStyle = '#38BDF8';
  ctx.fillRect(0, 0, 1024, 96);

  ctx.fillStyle = '#FFFFFF';
  ctx.fillRect(0, 0, 1024, 14);
  ctx.fillRect(0, 82, 1024, 14);

  ctx.fillStyle = '#081226';
  ctx.font = 'bold 40px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (let i = 0; i < 3; i++) {
    ctx.fillText(`SOAL ${gateNumber}`, 170 + i * 340, 49);
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export function createStadiumSeatTierTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 512;
  const ctx = canvas.getContext('2d')!;

  // Vertical riser concrete (v: 0..0.28 -> bottom 144px in flipped canvas coordinates, draw both top/bottom safely)
  ctx.fillStyle = '#475569';
  ctx.fillRect(0, 0, 512, 512);

  // Horizontal concrete aisle stairs along edges (u near 0 and 1)
  ctx.fillStyle = '#1E293B';
  ctx.fillRect(34, 0, 444, 370);

  // Vibrant international stadium mosaic bucket seats in 3 rows per tier
  const seatColors = ['#1D4ED8', '#2563EB', '#1E40AF', '#F97316', '#FACC15'];
  for (let row = 0; row < 3; row++) {
    for (let col = 0; col < 14; col++) {
      const sx = 42 + col * 31;
      const sy = 24 + row * 112;
      const color =
        row === 1 && col % 5 === 2
          ? seatColors[3]
          : col % 7 === 0
          ? seatColors[4]
          : seatColors[(col + row) % 3];
      ctx.fillStyle = color;
      ctx.fillRect(sx, sy, 25, 76);
      ctx.fillStyle = 'rgba(255,255,255,0.16)';
      ctx.fillRect(sx + 2, sy + 4, 21, 14);
    }
  }

  // Yellow safety nosing along aisle steps
  ctx.fillStyle = '#FACC15';
  ctx.fillRect(0, 368, 512, 16);
  ctx.fillStyle = '#94A3B8';
  ctx.fillRect(0, 384, 512, 128);
  ctx.fillStyle = '#E2E8F0';
  ctx.fillRect(6, 0, 22, 368);
  ctx.fillRect(484, 0, 22, 368);

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  return tex;
}

export function createPerimeterLedTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 2048;
  canvas.height = 128;
  const ctx = canvas.getContext('2d')!;

  const blocks = [
    { bg: '#071530', accent: '#38BDF8', text: 'EDU RUN ARENA 3D · WORLD STADIUM' },
    { bg: '#0F2957', accent: '#FACC15', text: 'INTERNATIONAL CHAMPIONSHIP SERIES' },
    { bg: '#7C2D12', accent: '#FF6B1A', text: 'SPEED · ACCURACY · FAIR PLAY' },
    { bg: '#064E3B', accent: '#34D399', text: '30 ATHLETIC LANES · OLYMPIC ARENA' },
  ];

  const blockW = 2048 / blocks.length;
  blocks.forEach((b, idx) => {
    const x = idx * blockW;
    ctx.fillStyle = b.bg;
    ctx.fillRect(x, 0, blockW, 128);
    ctx.fillStyle = b.accent;
    ctx.fillRect(x, 0, blockW, 12);
    ctx.fillRect(x, 116, blockW, 12);

    ctx.fillStyle = '#FFFFFF';
    ctx.font = 'bold 34px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(b.text, x + blockW / 2, 66);
  });

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  return tex;
}

export function createRoofMembraneTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 512;
  const ctx = canvas.getContext('2d')!;

  const grad = ctx.createLinearGradient(0, 0, 512, 0);
  grad.addColorStop(0.0, '#F1F5F9');
  grad.addColorStop(0.5, '#FFFFFF');
  grad.addColorStop(1.0, '#E2E8F0');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 512, 512);

  // Subtle architectural PTFE seam grid
  ctx.strokeStyle = 'rgba(15, 41, 87, 0.22)';
  ctx.lineWidth = 5;
  for (let y = 0; y <= 512; y += 128) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(512, y);
    ctx.stroke();
  }
  for (let x = 0; x <= 512; x += 64) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, 512);
    ctx.stroke();
  }

  // Accent blue-gold stadium trim near inner & outer edges
  ctx.fillStyle = '#1D4ED8';
  ctx.fillRect(0, 0, 22, 512);
  ctx.fillStyle = '#FACC15';
  ctx.fillRect(22, 0, 8, 512);

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

export function createVipFacadeTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 256;
  const ctx = canvas.getContext('2d')!;

  ctx.fillStyle = '#0B1730';
  ctx.fillRect(0, 0, 512, 256);

  // Glazed VIP suite windows with warm interior lounge glow
  for (let col = 0; col < 8; col++) {
    const wx = 12 + col * 64;
    const grad = ctx.createLinearGradient(wx, 24, wx, 210);
    grad.addColorStop(0.0, '#1E3A8A');
    grad.addColorStop(0.45, '#334155');
    grad.addColorStop(0.85, '#F59E0B');
    grad.addColorStop(1.0, '#FEF08A');
    ctx.fillStyle = grad;
    ctx.fillRect(wx, 24, 50, 188);

    ctx.strokeStyle = '#94A3B8';
    ctx.lineWidth = 4;
    ctx.strokeRect(wx, 24, 50, 188);
  }

  // Gold & metallic VIP terrace rail
  ctx.fillStyle = '#FACC15';
  ctx.fillRect(0, 226, 512, 12);

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  return tex;
}
