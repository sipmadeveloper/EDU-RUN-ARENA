import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';

let cachedSoftwareGl: boolean | null = null;

export function detectSoftwareWebGL(): boolean {
  if (cachedSoftwareGl !== null) return cachedSoftwareGl;
  if (typeof document === 'undefined') {
    cachedSoftwareGl = false;
    return false;
  }
  const gl = document.createElement('canvas').getContext('webgl2');
  if (!gl) {
    cachedSoftwareGl = true;
    return true;
  }
  const ext = gl.getExtension('WEBGL_debug_renderer_info');
  const param = ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER;
  const gpu = String(gl.getParameter(param) || '');
  gl.getExtension('WEBGL_lose_context')?.loseContext();
  cachedSoftwareGl = /SwiftShader|llvmpipe|softpipe|Software|Basic Render/i.test(gpu);
  return cachedSoftwareGl;
}

export function createConfiguredRenderer(container: HTMLElement): {
  renderer: THREE.WebGLRenderer;
  isSoftwareGl: boolean;
} {
  const isSoftwareGl = detectSoftwareWebGL();
  let renderer: THREE.WebGLRenderer;
  try {
    renderer = new THREE.WebGLRenderer({
      antialias: !isSoftwareGl,
      stencil: false,
      powerPreference: 'high-performance',
      failIfMajorPerformanceCaveat: false,
    });
  } catch {
    // Safe fallback with reduced attributes if browser WebGL pool is under pressure
    renderer = new THREE.WebGLRenderer({
      antialias: false,
      stencil: false,
      powerPreference: 'default',
      failIfMajorPerformanceCaveat: false,
    });
  }
  renderer.domElement.addEventListener(
    'webglcontextlost',
    (e) => {
      e.preventDefault();
    },
    false
  );
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.1;
  const w = container.clientWidth || window.innerWidth;
  const h = container.clientHeight || window.innerHeight;
  const maxDpr = 1.25;
  renderer.setPixelRatio(isSoftwareGl ? 1 : Math.min(window.devicePixelRatio || 1, maxDpr));
  renderer.setSize(w, h);
  renderer.shadowMap.enabled = !isSoftwareGl;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  container.appendChild(renderer.domElement);
  return { renderer, isSoftwareGl };
}

export function disposeConfiguredRenderer(
  renderer: THREE.WebGLRenderer,
  container?: HTMLElement | null
): void {
  try {
    renderer.renderLists?.dispose();
    renderer.dispose();
  } catch {
    // ignore partial disposal errors
  }
  try {
    const gl = renderer.getContext();
    if (gl && !gl.isContextLost()) {
      renderer.forceContextLoss();
    }
  } catch {
    // ignore context-loss extension absence
  }
  try {
    if (container && renderer.domElement.parentNode === container) {
      container.removeChild(renderer.domElement);
    } else if (renderer.domElement.parentNode) {
      renderer.domElement.parentNode.removeChild(renderer.domElement);
    }
  } catch {
    // ignore DOM removal error
  }
}

export function applyStudioEnvironment(scene: THREE.Scene, renderer: THREE.WebGLRenderer): () => void {
  try {
    const pmremGenerator = new THREE.PMREMGenerator(renderer);
    const envTex = pmremGenerator.fromScene(new RoomEnvironment(), 0.04).texture;
    scene.environment = envTex;
    pmremGenerator.dispose();
    return () => {
      try {
        envTex.dispose();
      } catch {
        // ignore
      }
    };
  } catch {
    return () => {};
  }
}

const activeAfterDrawTimers = new WeakMap<THREE.WebGLRenderer, number>();

export function cancelAfterDraw(renderer: THREE.WebGLRenderer): void {
  const tid = activeAfterDrawTimers.get(renderer);
  if (tid !== undefined) {
    window.clearTimeout(tid);
    activeAfterDrawTimers.delete(renderer);
  }
}

export function afterDraw(renderer: THREE.WebGLRenderer, cb: () => void): number {
  const gl = renderer.getContext() as WebGL2RenderingContext | null;
  if (!gl || gl.isContextLost() || typeof gl.fenceSync !== 'function') {
    const id = window.setTimeout(cb, 70);
    activeAfterDrawTimers.set(renderer, id);
    return id;
  }
  const sync = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
  gl.flush();
  let timerId = 0;
  const poll = () => {
    if (gl.isContextLost()) {
      activeAfterDrawTimers.delete(renderer);
      return;
    }
    const state = sync ? gl.getSyncParameter(sync, gl.SYNC_STATUS) : gl.SIGNALED;
    if (state === gl.UNSIGNALED) {
      timerId = window.setTimeout(poll, 5);
      activeAfterDrawTimers.set(renderer, timerId);
    } else {
      if (sync) {
        try {
          gl.deleteSync(sync);
        } catch {
          // ignore
        }
      }
      timerId = window.setTimeout(cb, 70);
      activeAfterDrawTimers.set(renderer, timerId);
    }
  };
  timerId = window.setTimeout(poll, 5);
  activeAfterDrawTimers.set(renderer, timerId);
  return timerId;
}
