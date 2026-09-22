/**
 * src/utils/audio.ts
 * High-presence audible alerts and chimes for Sedona Court Travellers Inn PMS.
 * Uses official digital alarm clock MP3 audio with Web Audio API synthesis fallback.
 */

export type ChimeType = 'warning' | 'checkout' | 'grace' | 'alarm' | 'bell';

/** Default continuous alarm duration: 45 seconds */
export const ALARM_DURATION_MS = 45000;

let currentAlarmAudio: HTMLAudioElement | null = null;
let currentOscillators: OscillatorNode[] = [];
let currentAlarmTimeout: ReturnType<typeof setTimeout> | null = null;
let currentSynthInterval: ReturnType<typeof setInterval> | null = null;

/**
 * Creates a shared or new audio context safely handling autoplay restrictions
 */
const getAudioContext = (): AudioContext | null => {
  try {
    const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
    if (!AudioContextClass) return null;
    const ctx = new AudioContextClass();
    if (ctx.state === 'suspended') {
      ctx.resume().catch(() => {});
    }
    return ctx;
  } catch (e) {
    console.warn('Web Audio API error:', e);
    return null;
  }
};

/**
 * Stops any currently playing alarm sound immediately
 */
export const stopAlarm = () => {
  try {
    if (currentAlarmTimeout) {
      clearTimeout(currentAlarmTimeout);
      currentAlarmTimeout = null;
    }
    if (currentSynthInterval) {
      clearInterval(currentSynthInterval);
      currentSynthInterval = null;
    }
    if (currentAlarmAudio) {
      currentAlarmAudio.pause();
      currentAlarmAudio.currentTime = 0;
      currentAlarmAudio.loop = false;
      currentAlarmAudio = null;
    }
    if (currentOscillators.length > 0) {
      currentOscillators.forEach((osc) => {
        try {
          osc.stop();
          osc.disconnect();
        } catch {}
      });
      currentOscillators = [];
    }
  } catch (e) {
    console.warn('Error stopping alarm sound:', e);
  }
};

/**
 * Synthesized fallback siren alarm pulsing repeatedly for 45 seconds in case external audio cannot play
 */
const playSynthesizedAlarm = (durationMs = ALARM_DURATION_MS) => {
  try {
    const triggerPulse = () => {
      const ctx = getAudioContext();
      if (!ctx) return;
      const now = ctx.currentTime;

      const masterGain = ctx.createGain();
      masterGain.gain.setValueAtTime(0.85, now);
      masterGain.connect(ctx.destination);

      const pulses = [
        { f1: 880, f2: 1320, delay: 0.00, dur: 0.16 },
        { f1: 1320, f2: 880, delay: 0.20, dur: 0.16 },
        { f1: 880, f2: 1320, delay: 0.40, dur: 0.16 },
        { f1: 1320, f2: 880, delay: 0.60, dur: 0.28 },
      ];

      pulses.forEach(({ f1, f2, delay, dur }) => {
        const osc = ctx.createOscillator();
        const pulseGain = ctx.createGain();

        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(f1, now + delay);
        osc.frequency.exponentialRampToValueAtTime(f2, now + delay + dur);

        const filter = ctx.createBiquadFilter();
        filter.type = 'lowpass';
        filter.frequency.setValueAtTime(1600, now + delay);

        pulseGain.gain.setValueAtTime(0.85, now + delay);
        pulseGain.gain.exponentialRampToValueAtTime(0.001, now + delay + dur);

        osc.connect(filter);
        filter.connect(pulseGain);
        pulseGain.connect(masterGain);

        osc.start(now + delay);
        osc.stop(now + delay + dur);
        currentOscillators.push(osc);
      });
    };

    triggerPulse();
    currentSynthInterval = setInterval(triggerPulse, 1000);

    currentAlarmTimeout = setTimeout(() => {
      stopAlarm();
    }, durationMs);
  } catch (err) {
    console.warn('Synthesized alarm error:', err);
  }
};

/**
 * Plays the official Digital Alarm 1 MP3 audio file continuously for 45 seconds
 */
export const playDigitalAlarm = (volume = 0.9, durationMs = ALARM_DURATION_MS) => {
  stopAlarm();

  try {
    const audio = new Audio('/sounds/alarm.mp3');
    audio.volume = Math.min(Math.max(volume, 0), 1);
    audio.loop = true;
    currentAlarmAudio = audio;

    // Automatically stop after durationMs (default 45 seconds)
    currentAlarmTimeout = setTimeout(() => {
      stopAlarm();
    }, durationMs);

    const playPromise = audio.play();
    if (playPromise !== undefined) {
      playPromise.catch((err) => {
        console.warn('HTML5 audio play blocked/failed, using synthesized alarm fallback:', err);
        playSynthesizedAlarm(durationMs);
      });
    }
  } catch (err) {
    console.warn('Digital alarm playback error:', err);
    playSynthesizedAlarm(durationMs);
  }
};

/**
 * Desk service bell synthesizer (triple metallic strike)
 */
export const playServiceBellStrike = () => {
  try {
    const ctx = getAudioContext();
    if (!ctx) return;
    const now = ctx.currentTime;

    const masterGain = ctx.createGain();
    masterGain.gain.setValueAtTime(0.85, now);
    masterGain.connect(ctx.destination);

    const playBell = (startDelay: number) => {
      const primaryFreq = 1174.66; // D6
      const secondaryFreq = 1760.00; // A6
      const highSparkleFreq = 2349.32; // D7

      const osc1 = ctx.createOscillator();
      const osc2 = ctx.createOscillator();
      const osc3 = ctx.createOscillator();
      const bellGain = ctx.createGain();

      osc1.type = 'sine';
      osc1.frequency.setValueAtTime(primaryFreq, now + startDelay);

      osc2.type = 'triangle';
      osc2.frequency.setValueAtTime(secondaryFreq, now + startDelay);

      osc3.type = 'sine';
      osc3.frequency.setValueAtTime(highSparkleFreq, now + startDelay);

      bellGain.gain.setValueAtTime(0.9, now + startDelay);
      bellGain.gain.exponentialRampToValueAtTime(0.001, now + startDelay + 1.1);

      osc1.connect(bellGain);
      osc2.connect(bellGain);
      osc3.connect(bellGain);
      bellGain.connect(masterGain);

      osc1.start(now + startDelay);
      osc2.start(now + startDelay);
      osc3.start(now + startDelay);
      osc1.stop(now + startDelay + 1.1);
      osc2.stop(now + startDelay + 1.1);
      osc3.stop(now + startDelay + 1.1);
    };

    playBell(0.00); // 1st Ding
    playBell(0.22); // 2nd Ding
    playBell(0.44); // 3rd High Ding
  } catch (err) {
    console.warn('Service bell error:', err);
  }
};

/**
 * 15-minute advance checkout warning chime (ascending 4-tone hotel bell)
 */
export const playWarningChime = () => {
  try {
    const ctx = getAudioContext();
    if (!ctx) return;
    const now = ctx.currentTime;

    const masterGain = ctx.createGain();
    masterGain.gain.setValueAtTime(0.85, now);
    masterGain.connect(ctx.destination);

    const notes = [
      { freq: 440.00, delay: 0.00, dur: 0.6, vol: 0.65 }, // A4
      { freq: 554.37, delay: 0.14, dur: 0.7, vol: 0.70 }, // C#5
      { freq: 659.25, delay: 0.28, dur: 0.8, vol: 0.75 }, // E5
      { freq: 880.00, delay: 0.42, dur: 1.4, vol: 0.85 }, // A5
    ];

    notes.forEach(({ freq, delay, dur, vol }) => {
      const osc = ctx.createOscillator();
      const harmonic = ctx.createOscillator();
      const noteGain = ctx.createGain();

      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, now + delay);

      // Add 2nd harmonic for bell chime ring
      harmonic.type = 'sine';
      harmonic.frequency.setValueAtTime(freq * 2.756, now + delay);

      noteGain.gain.setValueAtTime(vol, now + delay);
      noteGain.gain.exponentialRampToValueAtTime(0.001, now + delay + dur);

      osc.connect(noteGain);
      harmonic.connect(noteGain);
      noteGain.connect(masterGain);

      osc.start(now + delay);
      harmonic.start(now + delay);
      osc.stop(now + delay + dur);
      harmonic.stop(now + delay + dur);
    });
  } catch (err) {
    console.warn('Warning chime error:', err);
  }
};

/**
 * Main alarm sound dispatcher
 */
export const playChime = (type: ChimeType) => {
  if (type === 'warning') {
    playWarningChime();
  } else if (type === 'bell') {
    playServiceBellStrike();
  } else {
    // 'checkout', 'grace', 'alarm' trigger the Digital Alarm MP3 sound
    playDigitalAlarm();
  }
};

/**
 * Pleasant restaurant kitchen chime (D5 -> A5 -> D6 grand bell chime)
 */
export const playKitchenChime = () => {
  try {
    const ctx = getAudioContext();
    if (!ctx) return;
    const now = ctx.currentTime;

    const masterGain = ctx.createGain();
    masterGain.gain.setValueAtTime(0.85, now);
    masterGain.connect(ctx.destination);

    const playBell = (freq: number, delay: number, dur: number, vol: number = 0.5) => {
      const osc = ctx.createOscillator();
      const oscHarmonic = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, now + delay);

      oscHarmonic.type = 'sine';
      oscHarmonic.frequency.setValueAtTime(freq * 2.0, now + delay);

      gain.gain.setValueAtTime(vol, now + delay);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + delay + dur);

      osc.connect(gain);
      oscHarmonic.connect(gain);
      gain.connect(masterGain);

      osc.start(now + delay);
      oscHarmonic.start(now + delay);
      osc.stop(now + delay + dur);
      oscHarmonic.stop(now + delay + dur);
    };

    playBell(587.33, 0.00, 1.2, 0.55); // D5
    playBell(739.99, 0.16, 1.4, 0.65); // F#5
    playBell(880.00, 0.32, 1.6, 0.75); // A5
    playBell(1174.66, 0.48, 2.2, 0.85); // D6
  } catch (err) {
    console.warn('Kitchen chime error:', err);
  }
};
