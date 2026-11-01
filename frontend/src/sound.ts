// Own Web Audio key sounds for dustype. No audio files are copied from
// any other app: a short oscillator click for a correct key, a lower
// thud for a wrong key, and a two-tone chime when a test finishes.
// The context is created lazily on the first user gesture, so autoplay
// policies are not triggered on page load.

let ctx: AudioContext | null = null;
let enabled = true;

export function setSoundEnabled(value: boolean) {
  enabled = value;
}

function getContext(): AudioContext | null {
  if (!enabled) return null;
  try {
    if (!ctx) {
      const Ctor =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext?: typeof AudioContext })
          .webkitAudioContext;
      if (!Ctor) return null;
      ctx = new Ctor();
    }
    if (ctx.state === "suspended") void ctx.resume();
    return ctx;
  } catch {
    return null;
  }
}

function tone(
  frequency: number,
  durationSeconds: number,
  type: OscillatorType,
  volume = 0.12,
) {
  const audio = getContext();
  if (!audio) return;
  try {
    const osc = audio.createOscillator();
    const gain = audio.createGain();
    osc.type = type;
    osc.frequency.value = frequency;
    gain.gain.setValueAtTime(volume, audio.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, audio.currentTime + durationSeconds);
    osc.connect(gain);
    gain.connect(audio.destination);
    osc.start();
    osc.stop(audio.currentTime + durationSeconds);
  } catch {
    // Sound is cosmetic; never break typing if audio fails.
  }
}

export function playKeySound(correct: boolean) {
  if (correct) tone(900, 0.03, "square", 0.06);
  else tone(180, 0.06, "sine", 0.12);
}

export function playFinishSound() {
  tone(660, 0.12, "sine", 0.12);
  window.setTimeout(() => tone(880, 0.15, "sine", 0.12), 120);
}
