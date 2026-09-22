# Audio Files

## kitchen-chime.mp3

This is the audio file played when new kitchen orders arrive on the TV display.

**To add the audio file:**

1. Find a pleasant chime sound (3-5 seconds long)
2. Save as `kitchen-chime.mp3` in this directory
3. Ensure format is MP3 for browser compatibility

**Recommended sources:**
- Freesound.org (free sounds with attribution)
- Zapsplat.com (royalty-free sounds)
- Generate using online tone generators

**Audio specifications:**
- Format: MP3
- Duration: 2-5 seconds
- Volume: Medium (not too loud for kitchen environment)
- Type: Pleasant chime or bell sound

**Alternative:**
If no audio file is provided, the system will still work but without sound notifications.

## alarm.mp3 (Digital Alarm 1)

This is the official digital alarm clock sound played when room checkouts, overdue grace periods, and snooze expiries trigger across the PMS.

- **File**: `alarm.mp3` (also aliased as `digital-alarm.mp3`)
- **Source**: `Digital Alarm 1 Alarm Clock Sound Effects Free Download.mp3`
- **Format**: MP3 (192 kbps, 44.1 kHz, Stereo)
- **Duration**: ~8.6 seconds
- **Usage**: Dispatched by `playDigitalAlarm()` / `playChime('grace' | 'checkout' | 'alarm')` in `src/utils/audio.ts`
- **Controls**: Stopped on user acknowledge, snooze, or manual dismissal via `stopAlarm()`