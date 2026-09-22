import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Clock, Calendar, Volume2, Sun, Moon, Sparkles, Check, ChevronDown } from 'lucide-react';
import { playChime, playKitchenChime, ChimeType } from '../utils/audio';

interface DateTimeDisplayProps {
  variant?: 'compact' | 'expanded' | 'banner';
  className?: string;
  showSoundTester?: boolean;
}

export const DateTimeDisplay: React.FC<DateTimeDisplayProps> = ({
  variant = 'expanded',
  className = '',
  showSoundTester = true,
}) => {
  const [time, setTime] = useState(new Date());
  const [soundMenuOpen, setSoundMenuOpen] = useState(false);
  const [lastTestedSound, setLastTestedSound] = useState<string | null>(null);

  useEffect(() => {
    const timer = setInterval(() => setTime(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  const hours = time.getHours();
  const minutes = time.getMinutes().toString().padStart(2, '0');
  const seconds = time.getSeconds().toString().padStart(2, '0');
  const isPm = hours >= 12;
  const displayHours = (hours % 12 || 12).toString().padStart(2, '0');

  const formattedDayOfWeek = time.toLocaleDateString('en-US', { weekday: 'long' });
  const formattedFullDate = time.toLocaleDateString('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });
  const formattedShortDate = time.toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });

  // Determine current active shift (Day shift 06:00-18:00, Night shift 18:00-06:00)
  const isDayShift = hours >= 6 && hours < 18;
  const shiftName = isDayShift ? 'DAY SHIFT' : 'NIGHT SHIFT';
  const shiftHoursLabel = isDayShift ? '06:00 AM - 06:00 PM' : '06:00 PM - 06:00 AM';

  const testAudio = (type: ChimeType | 'kitchen', label: string) => {
    setLastTestedSound(label);
    if (type === 'kitchen') {
      playKitchenChime();
    } else {
      playChime(type);
    }
    setTimeout(() => setLastTestedSound(null), 1800);
  };

  // ─── VARIANT 1: HEADER COMPACT/EXPANDED ───
  if (variant === 'compact') {
    return (
      <div className={`relative flex items-center gap-2 bg-[#F2EEE9]/80 border border-[#E1DAD0] rounded-xl py-1 px-2.5 shadow-2xs whitespace-nowrap ${className}`}>
        {/* Live digital time */}
        <div className="flex items-center gap-1.5 font-mono">
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse shrink-0" />
          <span className="font-black text-sm sm:text-base text-primary tracking-tight">
            {displayHours}:{minutes}
          </span>
          <span className="font-bold text-xs text-primary/60">
            :{seconds}
          </span>
          <span className="text-[9px] font-bold text-primary uppercase bg-primary/10 px-1 py-0.5 rounded leading-none">
            {isPm ? 'PM' : 'AM'}
          </span>
        </div>

        {/* Vertical divider */}
        <div className="h-3.5 w-px bg-secondary/80 shrink-0" />

        {/* Compact Shift Badge */}
        <div 
          className="flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-white/90 border border-secondary/60 text-[9px] font-mono font-bold text-charcoal/80 cursor-help shrink-0 shadow-2xs"
          title={`${shiftName} (${shiftHoursLabel}) • Philippine Standard Time`}
        >
          {isDayShift ? <Sun size={10} className="text-amber-600 shrink-0" /> : <Moon size={10} className="text-indigo-600 shrink-0" />}
          <span className="hidden sm:inline">{isDayShift ? 'DAY' : 'NIGHT'}</span>
        </div>

        {/* Sound Tester Quick Button */}
        {showSoundTester && (
          <div className="relative shrink-0">
            <button
              type="button"
              onClick={() => setSoundMenuOpen(!soundMenuOpen)}
              className="p-1 rounded-lg bg-white/90 hover:bg-white border border-secondary/60 text-charcoal/70 hover:text-primary transition cursor-pointer flex items-center gap-0.5 shadow-2xs"
              title="Test Alarm Chimes & Audio Volume"
            >
              <Volume2 size={12} className={lastTestedSound ? 'text-emerald-600 animate-bounce' : 'text-primary'} />
              <ChevronDown size={9} className="opacity-60" />
            </button>

              <AnimatePresence>
                {soundMenuOpen && (
                  <motion.div
                    initial={{ opacity: 0, y: 5, scale: 0.95 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, y: 5, scale: 0.95 }}
                    className="absolute right-0 top-full mt-2 w-56 bg-white rounded-2xl border border-secondary shadow-xl p-2 z-50 text-xs font-sans space-y-1"
                  >
                    <div className="px-2 py-1 border-b border-secondary/30 text-[10px] font-mono uppercase font-bold text-charcoal/50 flex justify-between items-center">
                      <span>Test Noticeable Alarms</span>
                      <Volume2 size={11} className="text-primary" />
                    </div>

                    <button
                      type="button"
                      onClick={() => testAudio('alarm', 'Digital Alarm')}
                      className="w-full p-2 text-left hover:bg-cream/40 rounded-xl transition cursor-pointer flex items-center justify-between"
                    >
                      <div>
                        <span className="font-bold text-charcoal block text-[11px]">Digital Alarm Clock</span>
                        <span className="text-[9px] text-charcoal/50 block font-mono">Digital Alarm 1 MP3</span>
                      </div>
                      <span className="text-[10px] font-mono font-bold text-red-700 bg-red-100 px-1.5 py-0.5 rounded">Play</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => testAudio('warning', 'Warning Chime')}
                      className="w-full p-2 text-left hover:bg-cream/40 rounded-xl transition cursor-pointer flex items-center justify-between"
                    >
                      <div>
                        <span className="font-bold text-charcoal block text-[11px]">15m Warning Chime</span>
                        <span className="text-[9px] text-charcoal/50 block font-mono">Ascending 4-tone bell</span>
                      </div>
                      <span className="text-[10px] font-mono font-bold text-amber-700 bg-amber-50 px-1.5 py-0.5 rounded">Play</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => testAudio('bell', 'Service Bell')}
                      className="w-full p-2 text-left hover:bg-cream/40 rounded-xl transition cursor-pointer flex items-center justify-between"
                    >
                      <div>
                        <span className="font-bold text-charcoal block text-[11px]">Desk Service Bell</span>
                        <span className="text-[9px] text-charcoal/50 block font-mono">Triple metallic strike</span>
                      </div>
                      <span className="text-[10px] font-mono font-bold text-rose-700 bg-rose-50 px-1.5 py-0.5 rounded">Play</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => testAudio('kitchen', 'Kitchen Chime')}
                      className="w-full p-2 text-left hover:bg-cream/40 rounded-xl transition cursor-pointer flex items-center justify-between"
                    >
                      <div>
                        <span className="font-bold text-charcoal block text-[11px]">Kitchen Order Chime</span>
                        <span className="text-[9px] text-charcoal/50 block font-mono">Grand 4-tone chime</span>
                      </div>
                      <span className="text-[10px] font-mono font-bold text-emerald-700 bg-emerald-50 px-1.5 py-0.5 rounded">Play</span>
                    </button>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          )}
      </div>
    );
  }

  // ─── VARIANT 2: GRAND BANNER (DASHBOARD & OPERATIONS HUB) ───
  return (
    <div className={`bg-white border border-secondary/70 rounded-3xl p-5 sm:p-6 shadow-sm flex flex-col md:flex-row justify-between items-start md:items-center gap-5 ${className}`}>
      {/* Left: Day & Date Header */}
      <div className="space-y-1.5">
        <div className="flex items-center gap-2">
          <span className="text-[10px] font-mono font-bold uppercase tracking-widest text-primary bg-primary/10 border border-primary/20 px-2.5 py-0.5 rounded-full flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-emerald-500 animate-ping" />
            <span>Sedona Court PMS Terminal</span>
          </span>
          <span className="text-[10px] font-mono uppercase font-bold text-charcoal/50 bg-cream/40 px-2 py-0.5 rounded-md border border-secondary/40">
            {isDayShift ? '☀️ Day Shift' : '🌙 Night Shift'} ({shiftHoursLabel})
          </span>
        </div>

        <h2 className="font-display font-black text-xl sm:text-2xl text-charcoal tracking-tight">
          {formattedDayOfWeek}, {formattedFullDate}
        </h2>

        <p className="text-xs text-charcoal/50 font-mono">
          Philippine Standard Time &bull; Asia/Manila (PHT, UTC+8) &bull; Synchronized Live Clock
        </p>
      </div>

      {/* Right: Big Bold Digital Clock Widget */}
      <div className="flex items-center gap-3 bg-charcoal text-white rounded-2xl p-3 sm:p-4 px-5 sm:px-6 shadow-lg border border-charcoal/80">
        <div className="flex flex-col items-end">
          <div className="flex items-baseline gap-1 font-mono tracking-tight leading-none">
            <span className="font-black text-3xl sm:text-4xl text-amber-400">
              {displayHours}:{minutes}
            </span>
            <span className="font-bold text-lg sm:text-xl text-white/70">
              :{seconds}
            </span>
            <span className="text-xs font-bold text-white bg-white/20 px-1.5 py-0.5 rounded ml-1 uppercase">
              {isPm ? 'PM' : 'AM'}
            </span>
          </div>
          <span className="text-[9px] font-mono text-white/50 tracking-widest uppercase mt-1">
            Real-Time Station Clock
          </span>
        </div>

        {/* Audio Test Quick Trigger */}
        <div className="pl-3 border-l border-white/20">
          <button
            type="button"
            onClick={() => testAudio('alarm', 'Digital Alarm')}
            className="p-2 rounded-xl bg-white/10 hover:bg-amber-500 hover:text-charcoal text-white transition cursor-pointer flex flex-col items-center gap-1 active:scale-95"
            title="Test Digital Alarm Clock Sound"
          >
            <Volume2 size={16} />
            <span className="text-[8px] font-mono font-bold uppercase">Test Alarm</span>
          </button>
        </div>
      </div>
    </div>
  );
};
