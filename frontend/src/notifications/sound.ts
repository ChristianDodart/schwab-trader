// Tiny WebAudio chime synth for notifications — no audio assets, no network. Each
// category gets a short, distinct motif so you can tell a fill from a price alert with
// your eyes closed. Sound is opt-in (default off); this module just plays when asked.
// The demo buttons in the notification settings are a user gesture, which is enough to
// unlock the AudioContext; once unlocked, real notifications can chime too.

type Kind = "alert" | "trigger" | "fill" | "system";

let ctx: AudioContext | null = null;

function audio(): AudioContext | null {
  if (typeof window === "undefined") return null;
  const AC = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AC) return null;
  if (!ctx) { try { ctx = new AC(); } catch { return null; } }
  if (ctx.state === "suspended") ctx.resume().catch(() => {});
  return ctx;
}

// One note: `freq` starting at time `t` for `dur` seconds, with a soft attack + decay
// envelope so it fades in/out instead of clicking.
function note(ac: AudioContext, freq: number, t: number, dur: number, gain = 0.14, type: OscillatorType = "sine") {
  const osc = ac.createOscillator();
  const g = ac.createGain();
  osc.type = type;
  osc.frequency.value = freq;
  g.gain.setValueAtTime(0.0001, t);
  g.gain.linearRampToValueAtTime(gain, t + 0.008);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  osc.connect(g).connect(ac.destination);
  osc.start(t);
  osc.stop(t + dur + 0.02);
}

// Each motif is a couple of notes — recognizable but brief (~0.25s).
const MOTIFS: Record<Kind, (ac: AudioContext, t: number) => void> = {
  fill:    (ac, t) => { note(ac, 587.33, t, 0.12); note(ac, 880.0, t + 0.11, 0.16); },                                   // D5 -> A5, rising "done"
  trigger: (ac, t) => { note(ac, 659.25, t, 0.12); note(ac, 987.77, t + 0.12, 0.18); },                                 // E5 -> B5, "act"
  alert:   (ac, t) => { note(ac, 880.0, t, 0.10, 0.16, "triangle"); note(ac, 880.0, t + 0.16, 0.12, 0.16, "triangle"); }, // urgent double-beep
  system:  (ac, t) => { note(ac, 440.0, t, 0.22, 0.10); },                                                              // low, neutral
};

/** Play the chime for a notification category. Unknown/undefined → the trigger motif.
 * Never throws; if audio is blocked (no gesture yet, unsupported), it's a silent no-op. */
export function playNotifSound(kind?: string): void {
  const ac = audio();
  if (!ac) return;
  const motif = MOTIFS[(kind as Kind)] ?? MOTIFS.trigger;
  try { motif(ac, ac.currentTime + 0.01); } catch { /* audio unavailable — ignore */ }
}
