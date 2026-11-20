import { AppLogo } from './AppLogo';

interface Loading3DProps {
  /** Fullscreen curtain for route/screen transitions, or inline compact emblem for waiting states */
  variant?: 'fullscreen' | 'inline';
  size?: 'sm' | 'md' | 'lg';
  title?: string;
  subtitle?: string;
  /** Controls fade-out transition when overlay is dismissing */
  fadingOut?: boolean;
  className?: string;
}

const SIZE_CONFIG = {
  sm: {
    stage: 'w-12 h-12',
    cube: 20,
    outerRing: 'w-11 h-11',
    innerRing: 'w-8 h-8',
    runnerDot: 'w-2 h-2 -top-1',
    shadow: 'w-8 h-2.5 mt-0.5',
  },
  md: {
    stage: 'w-24 h-24',
    cube: 34,
    outerRing: 'w-22 h-22',
    innerRing: 'w-16 h-16',
    runnerDot: 'w-2.5 h-2.5 -top-1.5',
    shadow: 'w-14 h-3.5 mt-1',
  },
  lg: {
    stage: 'w-36 h-36',
    cube: 48,
    outerRing: 'w-32 h-32',
    innerRing: 'w-24 h-24',
    runnerDot: 'w-3 h-3 -top-1.5',
    shadow: 'w-20 h-4 mt-2',
  },
} as const;

function StadiumCube3D({ size = 'lg' }: { size?: 'sm' | 'md' | 'lg' }) {
  const cfg = SIZE_CONFIG[size];
  const half = cfg.cube / 2;

  const faceBase =
    'absolute inset-0 rounded-[5px] border flex items-center justify-center backface-visible';

  return (
    <div className="flex flex-col items-center justify-center select-none pointer-events-none">
      <div className={`relative ${cfg.stage} flex items-center justify-center edurun-scene-3d`}>
        {/* Outer 3D Tilted Athletic Oval Track with Orbiting Sprint Comet */}
        <div
          className={`absolute ${cfg.outerRing} rounded-full border-2 border-[#FF6B1A]/70 edurun-preserve-3d animate-edurun-orbit`}
        >
          <span
            className={`absolute left-1/2 -translate-x-1/2 ${cfg.runnerDot} rounded-full bg-[#FACC15] shadow-[0_0_12px_rgba(250,204,21,0.95)]`}
          />
          <span
            className={`absolute left-1/2 -translate-x-1/2 -bottom-1 ${
              size === 'sm' ? 'w-1.5 h-1.5' : 'w-2 h-2'
            } rounded-full bg-[#38BDF8] shadow-[0_0_10px_rgba(56,189,248,0.9)]`}
          />
        </div>

        {/* Counter-Rotating Inner 3D Stadium Energy Ring */}
        <div
          className={`absolute ${cfg.innerRing} rounded-full border border-cyan-400/55 edurun-preserve-3d animate-edurun-orbit-rev`}
        >
          <span
            className={`absolute left-1/2 -translate-x-1/2 -top-1 ${
              size === 'sm' ? 'w-1.5 h-1.5' : 'w-2 h-2'
            } rounded-full bg-[#FF6B1A] shadow-[0_0_10px_rgba(255,107,26,0.95)]`}
          />
        </div>

        {/* Floating 6-Face 3D Cube Emblem */}
        <div className="edurun-preserve-3d animate-edurun-float">
          <div
            className="relative edurun-preserve-3d animate-edurun-cube"
            style={{ width: cfg.cube, height: cfg.cube }}
          >
            {/* Front */}
            <div
              className={`${faceBase} bg-gradient-to-br from-[#1D4ED8] to-[#0F2957] border-[#38BDF8]/80 shadow-[inset_0_0_12px_rgba(56,189,248,0.45)]`}
              style={{ transform: `translateZ(${half}px)` }}
            >
              <span className="w-2/5 h-2/5 rounded-sm bg-[#FACC15]/90 rotate-45" />
            </div>

            {/* Back */}
            <div
              className={`${faceBase} bg-gradient-to-br from-[#0F2957] to-[#1D4ED8] border-[#FACC15]/70`}
              style={{ transform: `rotateY(180deg) translateZ(${half}px)` }}
            >
              <span className="w-2/5 h-2/5 rounded-sm bg-[#FF6B1A]/90 rotate-45" />
            </div>

            {/* Right */}
            <div
              className={`${faceBase} bg-gradient-to-br from-[#FF6B1A] to-[#C2410C] border-[#FACC15]/85`}
              style={{ transform: `rotateY(90deg) translateZ(${half}px)` }}
            />

            {/* Left */}
            <div
              className={`${faceBase} bg-gradient-to-br from-[#0284C7] to-[#1E3A8A] border-[#7DD3FC]/80`}
              style={{ transform: `rotateY(-90deg) translateZ(${half}px)` }}
            />

            {/* Top */}
            <div
              className={`${faceBase} bg-gradient-to-br from-[#FACC15] to-[#F59E0B] border-white/80`}
              style={{ transform: `rotateX(90deg) translateZ(${half}px)` }}
            />

            {/* Bottom */}
            <div
              className={`${faceBase} bg-[#081226] border-blue-400/50`}
              style={{ transform: `rotateX(-90deg) translateZ(${half}px)` }}
            />
          </div>
        </div>
      </div>

      {/* Ground Contact Shadow synced to Cube Levitation */}
      <div
        className={`${cfg.shadow} rounded-full bg-cyan-400/25 blur-[3px] animate-edurun-shadow`}
      />
    </div>
  );
}

export function Loading3D({
  variant = 'fullscreen',
  size = variant === 'fullscreen' ? 'lg' : 'sm',
  title = 'Memuat Arena 3D...',
  subtitle = 'Menyiapkan lintasan dan peserta',
  fadingOut = false,
  className = '',
}: Loading3DProps) {
  if (variant === 'inline') {
    return (
      <div className={`flex items-center gap-3.5 ${className}`} role="status" aria-live="polite">
        <StadiumCube3D size={size} />
        {(title || subtitle) && (
          <div className="min-w-0">
            {title && (
              <div className="font-display font-bold text-sm sm:text-base text-white leading-tight">
                {title}
              </div>
            )}
            {subtitle && (
              <div className="text-xs text-blue-200/80 mt-0.5 leading-snug">{subtitle}</div>
            )}
          </div>
        )}
      </div>
    );
  }

  return (
    <div
      role="status"
      aria-live="polite"
      className={`fixed inset-0 z-50 flex flex-col items-center justify-center bg-[#081226]/96 transition-opacity duration-300 ${
        fadingOut ? 'opacity-0 pointer-events-none' : 'opacity-100'
      } ${className}`}
    >
      {/* Ambient Radial Stadium Spotlight (pure CSS, zero WebGL overhead) */}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          background:
            'radial-gradient(circle at 50% 44%, rgba(29,78,216,0.28) 0%, rgba(255,107,26,0.08) 32%, rgba(8,18,38,0) 68%)',
        }}
      />

      <div className="relative z-10 flex flex-col items-center text-center px-6 max-w-md w-full">
        <div className="flex items-center gap-2.5 mb-5">
          <AppLogo size="sm" />
          <span className="font-display font-extrabold text-base tracking-tight text-white">
            EDU RUN <span className="text-[#FF6B1A]">ARENA 3D</span>
          </span>
        </div>

        <StadiumCube3D size={size} />

        <h2 className="font-display font-bold text-lg sm:text-xl text-white mt-5 tracking-tight">
          {title}
        </h2>
        {subtitle && <p className="text-xs sm:text-sm text-blue-200/80 mt-1.5">{subtitle}</p>}

        {/* Smooth Sweeping Track Progress Bar */}
        <div className="w-56 h-1.5 rounded-full bg-white/10 overflow-hidden mt-5">
          <div className="w-2/5 h-full rounded-full bg-gradient-to-r from-[#FF6B1A] via-[#FACC15] to-[#38BDF8] animate-edurun-sweep" />
        </div>
      </div>
    </div>
  );
}
