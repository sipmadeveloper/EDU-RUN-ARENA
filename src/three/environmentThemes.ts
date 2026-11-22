import * as THREE from 'three';
import type { RaceVenueId } from '../types/game';

export interface EnvironmentThemePreset {
  id: RaceVenueId;
  skyColor: THREE.Color;
  fogColor: THREE.Color;
  fogDensity: number;
  hemiSkyColor: THREE.Color;
  hemiGroundColor: THREE.Color;
  hemiIntensity: number;
  keyColor: THREE.Color;
  keyIntensity: number;
  keyPosition: THREE.Vector3;
  rimColor: THREE.Color;
  rimIntensity: number;
  environmentIntensity: number;
  exposure: number;
  floodlightIntensity: number;
  extGroundColor: THREE.Color;
  apronColor: THREE.Color;
  standTierColor: THREE.Color;
  standStepColor: THREE.Color;
  canopyColor: THREE.Color;
}

export interface ThemeWeights {
  day: number;
  night: number;
  open: number;
}

export const ENVIRONMENT_THEMES: Record<RaceVenueId, EnvironmentThemePreset> = {
  stadium_day: {
    id: 'stadium_day',
    skyColor: new THREE.Color(0x5ca8fa),
    fogColor: new THREE.Color(0x9bd0ff),
    fogDensity: 0.00042,
    hemiSkyColor: new THREE.Color(0xe0f2fe),
    hemiGroundColor: new THREE.Color(0x166534),
    hemiIntensity: 1.38,
    keyColor: new THREE.Color(0xfffbeb),
    keyIntensity: 2.3,
    keyPosition: new THREE.Vector3(140, 220, 150),
    rimColor: new THREE.Color(0xbae6fd),
    rimIntensity: 0.62,
    environmentIntensity: 0.95,
    exposure: 1.12,
    floodlightIntensity: 0,
    extGroundColor: new THREE.Color(0x166534),
    apronColor: new THREE.Color(0x475569),
    standTierColor: new THREE.Color(0x334155),
    standStepColor: new THREE.Color(0x475569),
    canopyColor: new THREE.Color(0x1d4ed8),
  },
  stadium_night: {
    id: 'stadium_night',
    skyColor: new THREE.Color(0x040b1e),
    fogColor: new THREE.Color(0x07122b),
    fogDensity: 0.00062,
    hemiSkyColor: new THREE.Color(0x3b63a8),
    hemiGroundColor: new THREE.Color(0x080f1f),
    hemiIntensity: 0.38,
    keyColor: new THREE.Color(0xa5b4fc),
    keyIntensity: 0.42,
    keyPosition: new THREE.Vector3(-90, 180, -120),
    rimColor: new THREE.Color(0x38bdf8),
    rimIntensity: 0.52,
    environmentIntensity: 0.26,
    exposure: 0.94,
    floodlightIntensity: 135,
    extGroundColor: new THREE.Color(0x081328),
    apronColor: new THREE.Color(0x172133),
    standTierColor: new THREE.Color(0x1a2436),
    standStepColor: new THREE.Color(0x2b394f),
    canopyColor: new THREE.Color(0x0d2247),
  },
  open_field: {
    id: 'open_field',
    skyColor: new THREE.Color(0x4fb6ff),
    fogColor: new THREE.Color(0xbbe6ff),
    fogDensity: 0.00038,
    hemiSkyColor: new THREE.Color(0xf0f9ff),
    hemiGroundColor: new THREE.Color(0x22c55e),
    hemiIntensity: 1.46,
    keyColor: new THREE.Color(0xfff5e6),
    keyIntensity: 2.15,
    keyPosition: new THREE.Vector3(175, 165, 110),
    rimColor: new THREE.Color(0xfef08a),
    rimIntensity: 0.55,
    environmentIntensity: 1.05,
    exposure: 1.15,
    floodlightIntensity: 0,
    extGroundColor: new THREE.Color(0x15803d),
    apronColor: new THREE.Color(0x16a34a),
    standTierColor: new THREE.Color(0x334155),
    standStepColor: new THREE.Color(0x475569),
    canopyColor: new THREE.Color(0x1d4ed8),
  },
};

export function weightsForVenue(venue: RaceVenueId): ThemeWeights {
  return {
    day: venue === 'stadium_day' ? 1 : 0,
    night: venue === 'stadium_night' ? 1 : 0,
    open: venue === 'open_field' ? 1 : 0,
  };
}

export function dampThemeWeights(
  current: ThemeWeights,
  targetVenue: RaceVenueId,
  dt: number,
  lambda = 4.2
): ThemeWeights {
  const t = weightsForVenue(targetVenue);
  const d = THREE.MathUtils.damp(current.day, t.day, lambda, dt);
  const n = THREE.MathUtils.damp(current.night, t.night, lambda, dt);
  const o = THREE.MathUtils.damp(current.open, t.open, lambda, dt);
  const sum = d + n + o || 1;
  current.day = d / sum;
  current.night = n / sum;
  current.open = o / sum;
  return current;
}

export function blendThemeColor(
  target: THREE.Color,
  weights: ThemeWeights,
  pick: (preset: EnvironmentThemePreset) => THREE.Color
): THREE.Color {
  const cDay = pick(ENVIRONMENT_THEMES.stadium_day);
  const cNight = pick(ENVIRONMENT_THEMES.stadium_night);
  const cOpen = pick(ENVIRONMENT_THEMES.open_field);
  target.setRGB(
    cDay.r * weights.day + cNight.r * weights.night + cOpen.r * weights.open,
    cDay.g * weights.day + cNight.g * weights.night + cOpen.g * weights.open,
    cDay.b * weights.day + cNight.b * weights.night + cOpen.b * weights.open
  );
  return target;
}

export function blendThemeScalar(
  weights: ThemeWeights,
  pick: (preset: EnvironmentThemePreset) => number
): number {
  return (
    pick(ENVIRONMENT_THEMES.stadium_day) * weights.day +
    pick(ENVIRONMENT_THEMES.stadium_night) * weights.night +
    pick(ENVIRONMENT_THEMES.open_field) * weights.open
  );
}

export interface SceneLightingRig {
  hemi: THREE.HemisphereLight;
  keyLight: THREE.DirectionalLight;
  rimLight: THREE.DirectionalLight;
  floodlights: THREE.SpotLight[];
  applyWeights: (scene: THREE.Scene, renderer: THREE.WebGLRenderer, weights: ThemeWeights) => void;
  dispose: () => void;
}

export function createSceneLightingRig(
  scene: THREE.Scene,
  isSoftwareGl: boolean,
  initialVenue: RaceVenueId
): SceneLightingRig {
  const initialPreset = ENVIRONMENT_THEMES[initialVenue];

  scene.background = initialPreset.skyColor.clone();
  const fog = new THREE.FogExp2(initialPreset.fogColor.getHex(), initialPreset.fogDensity);
  scene.fog = fog;
  scene.environmentIntensity = initialPreset.environmentIntensity;

  const hemi = new THREE.HemisphereLight(
    initialPreset.hemiSkyColor.getHex(),
    initialPreset.hemiGroundColor.getHex(),
    initialPreset.hemiIntensity
  );

  const keyLight = new THREE.DirectionalLight(
    initialPreset.keyColor.getHex(),
    initialPreset.keyIntensity
  );
  keyLight.position.copy(initialPreset.keyPosition);
  keyLight.castShadow = !isSoftwareGl;
  keyLight.shadow.mapSize.set(1024, 1024);
  keyLight.shadow.camera.near = 10;
  keyLight.shadow.camera.far = 720;
  keyLight.shadow.camera.left = -380;
  keyLight.shadow.camera.right = 380;
  keyLight.shadow.camera.top = 220;
  keyLight.shadow.camera.bottom = -220;
  keyLight.shadow.bias = -0.0005;

  const rimLight = new THREE.DirectionalLight(
    initialPreset.rimColor.getHex(),
    initialPreset.rimIntensity
  );
  rimLight.position.set(-140, 95, -150);

  scene.add(hemi, keyLight, keyLight.target, rimLight);

  // 2 opposing stadium SpotLights mounted along the inner roof canopy edge (matching the 36 recessed roof-rim LED banks)
  const floodSpots: Array<{ pos: [number, number, number]; target: [number, number, number] }> = [
    { pos: [-195, 53, 130], target: [20, 0, -12] },
    { pos: [195, 53, -130], target: [-20, 0, 12] },
  ];

  const floodlights = floodSpots.map((cfg) => {
    const spot = new THREE.SpotLight(
      0xe8f0ff,
      initialPreset.floodlightIntensity,
      700,
      1.24,
      0.95,
      1.12
    );
    spot.position.set(...cfg.pos);
    spot.target.position.set(...cfg.target);
    spot.castShadow = false;
    scene.add(spot, spot.target);
    return spot;
  });

  const _tmpBg = new THREE.Color();

  const applyWeights = (
    targetScene: THREE.Scene,
    renderer: THREE.WebGLRenderer,
    w: ThemeWeights
  ) => {
    blendThemeColor(_tmpBg, w, (p) => p.skyColor);
    if (targetScene.background instanceof THREE.Color) {
      targetScene.background.copy(_tmpBg);
    }
    blendThemeColor(fog.color, w, (p) => p.fogColor);
    fog.density = blendThemeScalar(w, (p) => p.fogDensity);

    blendThemeColor(hemi.color, w, (p) => p.hemiSkyColor);
    blendThemeColor(hemi.groundColor, w, (p) => p.hemiGroundColor);
    hemi.intensity = blendThemeScalar(w, (p) => p.hemiIntensity);

    blendThemeColor(keyLight.color, w, (p) => p.keyColor);
    keyLight.intensity = blendThemeScalar(w, (p) => p.keyIntensity);
    keyLight.position.set(
      ENVIRONMENT_THEMES.stadium_day.keyPosition.x * w.day +
        ENVIRONMENT_THEMES.stadium_night.keyPosition.x * w.night +
        ENVIRONMENT_THEMES.open_field.keyPosition.x * w.open,
      ENVIRONMENT_THEMES.stadium_day.keyPosition.y * w.day +
        ENVIRONMENT_THEMES.stadium_night.keyPosition.y * w.night +
        ENVIRONMENT_THEMES.open_field.keyPosition.y * w.open,
      ENVIRONMENT_THEMES.stadium_day.keyPosition.z * w.day +
        ENVIRONMENT_THEMES.stadium_night.keyPosition.z * w.night +
        ENVIRONMENT_THEMES.open_field.keyPosition.z * w.open
    );

    blendThemeColor(rimLight.color, w, (p) => p.rimColor);
    rimLight.intensity = blendThemeScalar(w, (p) => p.rimIntensity);

    targetScene.environmentIntensity = blendThemeScalar(w, (p) => p.environmentIntensity);
    renderer.toneMappingExposure = blendThemeScalar(w, (p) => p.exposure);

    const floodPower = blendThemeScalar(w, (p) => p.floodlightIntensity);
    for (const spot of floodlights) {
      spot.intensity = floodPower;
      spot.visible = floodPower > 0.5;
    }
  };

  return {
    hemi,
    keyLight,
    rimLight,
    floodlights,
    applyWeights,
    dispose: () => {
      for (const spot of floodlights) {
        scene.remove(spot, spot.target);
        spot.dispose();
      }
      scene.remove(hemi, keyLight, keyLight.target, rimLight);
    },
  };
}
