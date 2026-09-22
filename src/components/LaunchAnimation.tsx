import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Play, Pause, RotateCcw, Volume2, VolumeX, Maximize2, Minimize2, ArrowRight, Sparkles } from 'lucide-react';

interface LaunchAnimationProps {
  onComplete?: () => void;
  autoClose?: boolean;
  autoCloseDelay?: number; // in milliseconds (default 10500)
  showControls?: boolean;
  standalone?: boolean;
}

// Exact Chevron Color Palette sampled from original brand design
const CHEVRON_BANDS = [
  { id: 0, color: '#090707', highlight: '#141010', label: 'Noir Base' },
  { id: 1, color: '#1b120f', highlight: '#2a1d18', label: 'Dark Roast' },
  { id: 2, color: '#271813', highlight: '#3a251d', label: 'Espresso' },
  { id: 3, color: '#3b1e16', highlight: '#552c21', label: 'Deep Umber' },
  { id: 4, color: '#522818', highlight: '#733a24', label: 'Terracotta Dark' },
  { id: 5, color: '#b65c2b', highlight: '#cf7542', label: 'Sedona Amber Terracotta' },
  { id: 6, color: '#9d635c', highlight: '#b97a73', label: 'Cinnamon Mauve' },
  { id: 7, color: '#e0a955', highlight: '#ecc077', label: 'Warm Ochre Gold' },
  { id: 8, color: '#d2bcaa', highlight: '#e3d0c2', label: 'Bisque Sand' },
  { id: 9, color: '#d9dedf', highlight: '#edf1f2', label: 'Silver Mist' },
];

export const LaunchAnimation: React.FC<LaunchAnimationProps> = ({
  onComplete,
  autoClose = false,
  autoCloseDelay = 10500,
  showControls = true,
  standalone = false,
}) => {
  const [isPlaying, setIsPlaying] = useState(true);
  const [isMuted, setIsMuted] = useState(false);
  const [progress, setProgress] = useState(0); // 0 to 100
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [playbackSpeed, setPlaybackSpeed] = useState(1);
  const [key, setKey] = useState(0); // For instant replay

  const containerRef = useRef<HTMLDivElement>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const animationFrameRef = useRef<number | null>(null);
  const startTimeRef = useRef<number>(Date.now());

  const TOTAL_DURATION = 10000; // 10 seconds

  // Initialize audio and animation timer
  useEffect(() => {
    startTimeRef.current = Date.now();
    setProgress(0);
    setIsPlaying(true);

    if (audioRef.current) {
      audioRef.current.currentTime = 0;
      audioRef.current.playbackRate = playbackSpeed;
      audioRef.current.muted = isMuted;
      audioRef.current.play().catch(() => {
        // Autoplay may be restricted by browser until user gesture
      });
    }

    let isCancelled = false;

    const tick = () => {
      if (isCancelled) return;
      if (isPlaying) {
        const elapsed = (Date.now() - startTimeRef.current) * playbackSpeed;
        const currentProgress = Math.min(100, (elapsed / TOTAL_DURATION) * 100);
        setProgress(currentProgress);

        if (currentProgress >= 100) {
          if (autoClose && onComplete) {
            onComplete();
          }
        }
      }
      animationFrameRef.current = requestAnimationFrame(tick);
    };

    animationFrameRef.current = requestAnimationFrame(tick);

    return () => {
      isCancelled = true;
      if (animationFrameRef.current) cancelAnimationFrame(animationFrameRef.current);
    };
  }, [key, playbackSpeed]);

  // Handle Play/Pause toggle
  const handleTogglePlay = () => {
    if (isPlaying) {
      setIsPlaying(false);
      audioRef.current?.pause();
    } else {
      setIsPlaying(true);
      const elapsedSoFar = (progress / 100) * TOTAL_DURATION;
      startTimeRef.current = Date.now() - elapsedSoFar / playbackSpeed;
      audioRef.current?.play().catch(() => {});
    }
  };

  // Handle Replay
  const handleReplay = () => {
    setKey((prev) => prev + 1);
  };

  // Handle Audio toggle
  const handleToggleAudio = () => {
    const nextMuted = !isMuted;
    setIsMuted(nextMuted);
    if (audioRef.current) {
      audioRef.current.muted = nextMuted;
    }
  };

  // Handle Fullscreen toggle
  const handleToggleFullscreen = () => {
    if (!containerRef.current) return;
    if (!document.fullscreenElement) {
      containerRef.current.requestFullscreen().catch(() => {});
      setIsFullscreen(true);
    } else {
      document.exitFullscreen().catch(() => {});
      setIsFullscreen(false);
    }
  };

  // Canvas particle sparkles effect
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let w = (canvas.width = canvas.parentElement?.clientWidth || 1032);
    let h = (canvas.height = canvas.parentElement?.clientHeight || 580);

    const particles: Array<{
      x: number;
      y: number;
      size: number;
      speedX: number;
      speedY: number;
      alpha: number;
      maxAlpha: number;
      hue: number;
      twinkleSpeed: number;
    }> = Array.from({ length: 65 }, () => ({
      x: Math.random() * w,
      y: Math.random() * h,
      size: Math.random() * 2.2 + 0.8,
      speedX: (Math.random() - 0.3) * 0.4,
      speedY: -Math.random() * 0.5 - 0.2,
      alpha: Math.random() * 0.8,
      maxAlpha: Math.random() * 0.7 + 0.3,
      hue: Math.random() > 0.4 ? 40 : 25, // Golden / Terracotta sparkles
      twinkleSpeed: Math.random() * 0.03 + 0.01,
    }));

    let animId: number;

    const render = () => {
      ctx.clearRect(0, 0, w, h);

      // Current flare position in animation
      const flareX = (progress / 100) * w * 1.2 - w * 0.1;
      const flareY = h * 0.52;

      particles.forEach((p) => {
        p.x += p.speedX;
        p.y += p.speedY;

        // Reset particle if it leaves bounds
        if (p.y < 0) {
          p.y = h + 10;
          p.x = Math.random() * w;
        }
        if (p.x < 0) p.x = w;
        if (p.x > w) p.x = 0;

        // Distance to flare enhances brightness
        const distToFlare = Math.hypot(p.x - flareX, p.y - flareY);
        let currentAlpha = p.alpha;
        if (distToFlare < 220) {
          currentAlpha = Math.min(1, p.alpha + (1 - distToFlare / 220) * 0.8);
        }

        ctx.save();
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
        ctx.fillStyle = `hsla(${p.hue}, 85%, 75%, ${currentAlpha * 0.75})`;
        ctx.shadowColor = `hsla(${p.hue}, 90%, 65%, 0.8)`;
        ctx.shadowBlur = p.size * 4;
        ctx.fill();
        ctx.restore();
      });

      animId = requestAnimationFrame(render);
    };

    render();

    const handleResize = () => {
      if (!canvas) return;
      w = canvas.width = canvas.parentElement?.clientWidth || 1032;
      h = canvas.height = canvas.parentElement?.clientHeight || 580;
    };

    window.addEventListener('resize', handleResize);

    return () => {
      cancelAnimationFrame(animId);
      window.removeEventListener('resize', handleResize);
    };
  }, [progress]);

  // Calculate dynamic animation phases from progress (0 to 100)
  // Phase 1: Ambient Ignition (0% - 20% -> 0s - 2.0s)
  // Phase 2: Logo Radiant Fill & Flare Ignites (20% - 45% -> 2.0s - 4.5s)
  // Phase 3: Flare Sweeps Across Typography (45% - 75% -> 4.5s - 7.5s)
  // Phase 4: Full Glorious Settle & Continuous Brand Shimmer (75% - 100% -> 7.5s - 10.0s)

  const backgroundBrightness = Math.min(1, Math.max(0.1, progress / 28));
  const logoOutlineAlpha = Math.min(1, Math.max(0, (progress - 5) / 18));
  const logoFillAlpha = Math.min(1, Math.max(0, (progress - 22) / 20));
  const textRevealProgress = Math.min(1, Math.max(0, (progress - 38) / 32));
  const subtextRevealProgress = Math.min(1, Math.max(0, (progress - 46) / 28));

  // Flare X Coordinate relative to width (0% to 100%)
  // Flare travels from logo (x: 22%) to far right (x: 95%)
  const flarePositionX =
    progress < 20
      ? 20 + (progress / 20) * 4
      : progress < 75
      ? 24 + ((progress - 20) / 55) * 65
      : 89 + Math.sin(progress * 0.1) * 2;

  const flareIntensity =
    progress < 10
      ? progress / 10
      : progress < 30
      ? 1.4
      : progress < 75
      ? 1.2
      : Math.max(0.3, 1.2 - (progress - 75) / 25 * 0.8);

  return (
    <div
      ref={containerRef}
      key={key}
      className={`relative select-none overflow-hidden bg-black flex items-center justify-center font-sans ${
        standalone ? 'w-full min-h-screen' : 'w-full h-full rounded-2xl shadow-2xl border border-secondary/30'
      }`}
      style={{
        aspectRatio: standalone ? undefined : '16 / 9',
        maxHeight: standalone ? '100vh' : '90vh',
      }}
    >
      {/* Audio element */}
      <audio
        ref={audioRef}
        src="/sounds/sedona-launch.m4a"
        preload="auto"
        onEnded={() => {
          if (autoClose && onComplete) onComplete();
        }}
      />

      {/* ─── 1. DYNAMIC SVG CHEVRON BACKGROUND ────────────────────────────────── */}
      <div
        className="absolute inset-0 w-full h-full transition-opacity duration-700 pointer-events-none"
        style={{ opacity: backgroundBrightness }}
      >
        <svg
          className="w-full h-full object-cover"
          viewBox="0 0 1032 580"
          preserveAspectRatio="none"
          xmlns="http://www.w3.org/2000/svg"
        >
          <defs>
            {/* Subtle Lighting Gradients for each chevron to create luxurious 3D bevel sheen */}
            {CHEVRON_BANDS.map((band) => (
              <linearGradient
                key={`grad-${band.id}`}
                id={`chevron-grad-${band.id}`}
                x1="0%"
                y1="0%"
                x2="100%"
                y2="100%"
              >
                <stop offset="0%" stopColor={band.highlight} />
                <stop offset="60%" stopColor={band.color} />
                <stop offset="100%" stopColor={band.color} stopOpacity="0.95" />
              </linearGradient>
            ))}

            {/* Ambient Radial Spotlight anchored at logo */}
            <radialGradient id="logo-ambient-spot" cx="24%" cy="50%" r="65%">
              <stop offset="0%" stopColor="#ffffff" stopOpacity="0.25" />
              <stop offset="35%" stopColor="#dfa453" stopOpacity="0.12" />
              <stop offset="70%" stopColor="#b65c2b" stopOpacity="0.04" />
              <stop offset="100%" stopColor="#000000" stopOpacity="0" />
            </radialGradient>

            {/* Sweep Light Beam overlay */}
            <linearGradient id="sweep-beam-grad" x1="0%" y1="0%" x2="100%" y2="0%">
              <stop offset="0%" stopColor="#ffffff" stopOpacity="0" />
              <stop offset="48%" stopColor="#ffffff" stopOpacity="0.15" />
              <stop offset="50%" stopColor="#ffe9b5" stopOpacity="0.6" />
              <stop offset="52%" stopColor="#ffffff" stopOpacity="0.15" />
              <stop offset="100%" stopColor="#ffffff" stopOpacity="0" />
            </linearGradient>
          </defs>

          {/* Render angled Chevron Bands:
              Each chevron has top-x, mid-vertex-x (shifted right by ~72px), bottom-x
          */}
          {/* Base Background */}
          <rect width="1032" height="580" fill="#000000" />

          {/* Chevron Ribbons */}
          {/* Band 1 */}
          <polygon points="120,0 200,305 120,580 220,580 300,305 220,0" fill="url(#chevron-grad-1)" />
          {/* Band 2 */}
          <polygon points="215,0 295,305 215,580 310,580 390,305 310,0" fill="url(#chevron-grad-2)" />
          {/* Band 3 */}
          <polygon points="305,0 385,305 305,580 400,580 480,305 400,0" fill="url(#chevron-grad-3)" />
          {/* Band 4 */}
          <polygon points="395,0 475,305 395,580 485,580 565,305 485,0" fill="url(#chevron-grad-4)" />
          {/* Band 5 - Vibrant Terracotta */}
          <polygon points="480,0 560,305 480,580 575,580 655,305 575,0" fill="url(#chevron-grad-5)" />
          {/* Band 6 - Cinnamon Mauve */}
          <polygon points="570,0 650,305 570,580 660,580 740,305 660,0" fill="url(#chevron-grad-6)" />
          {/* Band 7 - Warm Ochre Gold */}
          <polygon points="655,0 735,305 655,580 750,580 830,305 750,0" fill="url(#chevron-grad-7)" />
          {/* Band 8 - Bisque Sand */}
          <polygon points="745,0 825,305 745,580 845,580 925,305 845,0" fill="url(#chevron-grad-8)" />
          {/* Band 9 - Silver Mist Right Flank */}
          <polygon points="840,0 920,305 840,580 1032,580 1032,0" fill="url(#chevron-grad-9)" />

          {/* Chevron Edge Shading Lines (crisp separators) */}
          {[120, 215, 305, 395, 480, 570, 655, 745, 840].map((x, idx) => (
            <polyline
              key={`sep-${idx}`}
              points={`${x},0 ${x + 80},305 ${x},580`}
              fill="none"
              stroke="#000000"
              strokeWidth="1.2"
              strokeOpacity="0.4"
            />
          ))}

          {/* Dynamic Ambient Spotlight */}
          <rect width="1032" height="580" fill="url(#logo-ambient-spot)" />

          {/* Sweep Light Beam moving across screen */}
          {progress > 15 && progress < 85 && (
            <rect
              x={(progress - 15) * 14 - 100}
              y="0"
              width="240"
              height="580"
              fill="url(#sweep-beam-grad)"
              style={{ mixBlendMode: 'screen' }}
            />
          )}
        </svg>
      </div>

      {/* ─── 2. PARTICLE SPARKLES CANVAS ──────────────────────────────────────── */}
      <canvas
        ref={canvasRef}
        className="absolute inset-0 w-full h-full pointer-events-none z-10"
      />

      {/* ─── 3. RADIAL BACKLIGHT GLOW BEHIND LOGO ─────────────────────────────── */}
      <div
        className="absolute left-[16%] top-[48%] -translate-x-1/2 -translate-y-1/2 rounded-full pointer-events-none transition-all duration-500 z-10"
        style={{
          width: '420px',
          height: '420px',
          background: 'radial-gradient(circle, rgba(255,255,255,0.45) 0%, rgba(224,169,85,0.25) 35%, rgba(182,92,43,0.12) 60%, transparent 80%)',
          opacity: Math.min(1, Math.max(0, (progress - 12) / 25)),
          transform: `translate(-50%, -50%) scale(${0.8 + (progress / 100) * 0.3})`,
          filter: 'blur(30px)',
        }}
      />

      {/* ─── 4. MAIN BRAND LOCKUP (LOGO + TYPOGRAPHY) ─────────────────────────── */}
      <div className="relative z-20 flex items-center justify-center gap-4 md:gap-7 px-8 max-w-5xl w-full">
        {/* ── Logo Emblem ("S" Woman Silhouette) ── */}
        <div className="relative flex-shrink-0 flex items-center justify-center">
          {/* Outer Aura Glow */}
          <div
            className="absolute inset-0 rounded-full pointer-events-none"
            style={{
              background: 'radial-gradient(circle, rgba(255,255,255,0.8) 0%, rgba(255,230,170,0.4) 45%, transparent 75%)',
              filter: 'blur(20px)',
              opacity: logoFillAlpha * 0.85,
              transform: `scale(${1 + Math.sin(progress * 0.15) * 0.05})`,
            }}
          />

          {/* Electric / Contour Stroke Glow Phase (0.5s - 2.5s) */}
          {progress < 40 && (
            <img
              src="/sedona-logo.png"
              alt="Sedona Contour"
              className="w-28 sm:w-36 md:w-44 h-auto object-contain pointer-events-none absolute"
              style={{
                opacity: logoOutlineAlpha * (1 - logoFillAlpha),
                filter: 'drop-shadow(0 0 12px #ffe699) drop-shadow(0 0 25px #ffffff) brightness(2)',
                transform: `scale(${0.96 + (progress / 40) * 0.04})`,
              }}
            />
          )}

          {/* Full Brilliant White Logo Image */}
          <motion.img
            src="/sedona-logo.png"
            alt="Sedona Court Logo"
            className="w-28 sm:w-36 md:w-44 h-auto object-contain relative z-20 pointer-events-none"
            style={{
              opacity: logoFillAlpha,
              filter: `drop-shadow(0 4px 20px rgba(0,0,0,0.7)) drop-shadow(0 0 ${
                25 * (1 - progress / 120)
              }px rgba(255,255,255,0.9)) brightness(1.05)`,
              transform: `scale(${0.94 + logoFillAlpha * 0.06})`,
            }}
          />
        </div>

        {/* ── Typography Section ("Sedona Court" & "TRAVELLERS INN") ── */}
        <div className="flex flex-col justify-center items-start text-white select-none">
          {/* "Sedona Court" (Luxury Serif Header) */}
          <div className="overflow-hidden py-1 relative">
            <h1
              className="font-serif text-3xl sm:text-5xl md:text-6xl lg:text-7xl font-normal tracking-tight text-white leading-none whitespace-nowrap"
              style={{
                fontFamily: "'Playfair Display', Georgia, serif",
                textShadow: '0 2px 18px rgba(0,0,0,0.8), 0 0 30px rgba(255,255,255,0.3)',
                opacity: textRevealProgress,
                transform: `translateX(${(1 - textRevealProgress) * -20}px)`,
                clipPath: `inset(0 ${Math.max(0, (1 - textRevealProgress) * 100)}% 0 0)`,
                transition: 'clip-path 0.1s linear',
              }}
            >
              edona Court
            </h1>

            {/* Shimmer light sweep overlay across text */}
            {progress > 30 && progress < 80 && (
              <div
                className="absolute inset-0 pointer-events-none"
                style={{
                  background: 'linear-gradient(90deg, transparent 0%, rgba(255,255,255,0.8) 50%, transparent 100%)',
                  transform: `translateX(${((progress - 30) / 50) * 200 - 50}%)`,
                  mixBlendMode: 'overlay',
                }}
              />
            )}
          </div>

          {/* "TRAVELLERS INN" (Classic Spaced All-Caps Subtext) */}
          <div className="overflow-hidden pt-1.5 md:pt-2.5">
            <p
              className="font-serif text-xs sm:text-sm md:text-lg lg:text-xl font-medium tracking-[0.32em] text-white/95 uppercase leading-none whitespace-nowrap"
              style={{
                fontFamily: "'Cinzel', 'Playfair Display', serif",
                textShadow: '0 2px 12px rgba(0,0,0,0.8), 0 0 20px rgba(255,255,255,0.2)',
                opacity: subtextRevealProgress,
                transform: `translateX(${(1 - subtextRevealProgress) * -15}px)`,
                clipPath: `inset(0 ${Math.max(0, (1 - subtextRevealProgress) * 100)}% 0 0)`,
                letterSpacing: `${0.28 + subtextRevealProgress * 0.06}em`,
              }}
            >
              TRAVELLERS INN
            </p>
          </div>
        </div>
      </div>

      {/* ─── 5. ANAMORPHIC CINEMATIC LENS FLARE ────────────────────────────────── */}
      {progress > 8 && progress < 96 && (
        <div
          className="absolute pointer-events-none z-30 transition-all duration-75"
          style={{
            left: `${flarePositionX}%`,
            top: '52%',
            transform: 'translate(-50%, -50%)',
            opacity: flareIntensity,
          }}
        >
          {/* Intense Central Hotspot */}
          <div
            className="w-12 h-12 rounded-full"
            style={{
              background: 'radial-gradient(circle, #ffffff 0%, #ffe9b8 40%, rgba(255,180,80,0.4) 70%, transparent 100%)',
              filter: 'blur(3px)',
              boxShadow: '0 0 40px #ffffff, 0 0 80px #ffd280',
            }}
          />

          {/* Ultra-Wide Horizontal Anamorphic Light Beam */}
          <div
            className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 h-[3px] rounded-full"
            style={{
              width: `${Math.min(950, 400 + progress * 6)}px`,
              background: 'linear-gradient(90deg, transparent 0%, rgba(255,230,170,0.1) 15%, rgba(255,255,255,0.95) 50%, rgba(255,230,170,0.1) 85%, transparent 100%)',
              filter: 'blur(1px)',
              boxShadow: '0 0 15px rgba(255,255,255,0.8), 0 0 35px rgba(230,170,90,0.5)',
            }}
          />

          {/* Cross Diffraction Starburst Spike (Vertical & Diagonal) */}
          <div
            className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[2px] h-28"
            style={{
              background: 'linear-gradient(180deg, transparent 0%, rgba(255,255,255,0.8) 50%, transparent 100%)',
              filter: 'blur(1px)',
            }}
          />
          <div
            className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[2px] h-24 rotate-45"
            style={{
              background: 'linear-gradient(180deg, transparent 0%, rgba(255,235,180,0.6) 50%, transparent 100%)',
              filter: 'blur(1px)',
            }}
          />
          <div
            className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[2px] h-24 -rotate-45"
            style={{
              background: 'linear-gradient(180deg, transparent 0%, rgba(255,235,180,0.6) 50%, transparent 100%)',
              filter: 'blur(1px)',
            }}
          />

          {/* Secondary Optical Halo Ring */}
          <div
            className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-32 h-32 rounded-full border border-amber-200/30"
            style={{
              filter: 'blur(2px)',
              transform: 'translate(-50%, -50%) scale(1.1)',
            }}
          />
        </div>
      )}

      {/* ─── 6. VIGNETTE & CINEMATIC LETTERBOX SHADOWS ────────────────────────── */}
      <div
        className="absolute inset-0 pointer-events-none z-20"
        style={{
          boxShadow: 'inset 0 0 100px rgba(0,0,0,0.7), inset 0 0 40px rgba(0,0,0,0.9)',
        }}
      />

      {/* ─── 7. FLOATING CONTROLS HUD OVERLAY ─────────────────────────────────── */}
      {showControls && (
        <div className="absolute inset-x-0 bottom-0 p-4 md:p-6 bg-gradient-to-t from-black/85 via-black/40 to-transparent z-40 flex flex-col gap-2.5 transition-opacity opacity-0 hover:opacity-100 focus-within:opacity-100 group">
          {/* Progress Bar */}
          <div className="w-full bg-white/20 h-1.5 rounded-full overflow-hidden relative cursor-pointer">
            <div
              className="h-full bg-gradient-to-r from-amber-400 via-white to-amber-200 transition-all duration-75 relative"
              style={{ width: `${progress}%` }}
            >
              <div className="absolute right-0 top-1/2 -translate-y-1/2 w-3 h-3 bg-white rounded-full shadow-lg shadow-amber-400/50 -mr-1.5" />
            </div>
          </div>

          {/* Action Bar */}
          <div className="flex items-center justify-between text-white/90 text-xs font-mono">
            {/* Left Controls */}
            <div className="flex items-center gap-3">
              <button
                onClick={handleTogglePlay}
                className="p-2 rounded-lg bg-white/10 hover:bg-white/20 text-white transition flex items-center gap-1.5 cursor-pointer"
                title={isPlaying ? 'Pause' : 'Play'}
              >
                {isPlaying ? <Pause size={14} /> : <Play size={14} />}
                <span className="text-[11px] font-sans">{isPlaying ? 'Pause' : 'Play'}</span>
              </button>

              <button
                onClick={handleReplay}
                className="p-2 rounded-lg bg-white/10 hover:bg-white/20 text-white transition flex items-center gap-1.5 cursor-pointer"
                title="Replay Animation"
              >
                <RotateCcw size={14} />
                <span className="text-[11px] font-sans">Replay</span>
              </button>

              <button
                onClick={handleToggleAudio}
                className="p-2 rounded-lg bg-white/10 hover:bg-white/20 text-white transition flex items-center gap-1.5 cursor-pointer"
                title={isMuted ? 'Unmute' : 'Mute'}
              >
                {isMuted ? <VolumeX size={14} /> : <Volume2 size={14} />}
              </button>

              {/* Speed Selector */}
              <div className="hidden sm:flex items-center gap-1 bg-white/10 p-0.5 rounded-lg text-[10px]">
                {[0.75, 1, 1.5].map((speed) => (
                  <button
                    key={speed}
                    onClick={() => setPlaybackSpeed(speed)}
                    className={`px-2 py-1 rounded transition cursor-pointer ${
                      playbackSpeed === speed ? 'bg-amber-500 text-black font-bold' : 'hover:bg-white/10 text-white/70'
                    }`}
                  >
                    {speed}x
                  </button>
                ))}
              </div>
            </div>

            {/* Right Action */}
            <div className="flex items-center gap-3">
              {onComplete && (
                <button
                  onClick={onComplete}
                  className="px-4 py-2 bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-400 hover:to-amber-500 text-black font-sans font-bold rounded-xl shadow-lg shadow-amber-500/20 transition flex items-center gap-1.5 cursor-pointer text-xs"
                >
                  Enter PMS
                  <ArrowRight size={14} />
                </button>
              )}

              <button
                onClick={handleToggleFullscreen}
                className="p-2 rounded-lg bg-white/10 hover:bg-white/20 text-white transition cursor-pointer"
                title="Toggle Fullscreen"
              >
                {isFullscreen ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
