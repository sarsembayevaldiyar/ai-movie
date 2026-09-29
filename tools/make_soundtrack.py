#!/usr/bin/env python3
"""Procedural soundtrack for the Astana Hub film. Fully deterministic (fixed seeds).

Everything is synthesised here with numpy: sub drone, noise beds, additive "organ"
chords, detuned string pad, pulse, arpeggio, bells, plucks, whooshes, glissandi.
Sync points come from tools/timeline.json (exported from the picture's timeline),
so sound and picture share one source of truth.

Output: public/audio/soundtrack.wav (48 kHz, 24-bit PCM, stereo), integrated
loudness -14 LUFS, true peak <= -1 dBTP.

Usage: python3 tools/make_soundtrack.py [tools/timeline.json]
Music is original: modal D major / B minor, not derived from any film score.
"""
from __future__ import annotations

import json
import math
import sys
from pathlib import Path

import numpy as np
from scipy.signal import fftconvolve, resample_poly, butter, sosfilt

SR = 48000
ROOT = Path(__file__).resolve().parent.parent
TL = json.loads(Path(sys.argv[1] if len(sys.argv) > 1 else ROOT / 'tools' / 'timeline.json').read_text())
DUR = float(TL['film'])
N = int(DUR * SR)
T = np.arange(N) / SR
rng = np.random.default_rng(20240901)

A4 = 440.0
NOTE = {n: i for i, n in enumerate(['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'])}


def hz(name: str) -> float:
    """'D3' -> frequency (equal temperament, A4 = 440)."""
    pitch, octave = name[:-1], int(name[-1])
    midi = 12 * (octave + 1) + NOTE[pitch]
    return A4 * 2 ** ((midi - 69) / 12)


def smoothstep(x):
    x = np.clip(x, 0, 1)
    return x * x * (3 - 2 * x)


def env_ar(t, t0, attack, hold_end, release):
    """Smooth attack from t0, sustain until hold_end, smooth release."""
    a = smoothstep((t - t0) / max(attack, 1e-4))
    r = 1 - smoothstep((t - hold_end) / max(release, 1e-4))
    return a * r * (t >= t0)


def seg(t0, t1):
    i0 = max(0, int(t0 * SR))
    i1 = min(N, int(t1 * SR))
    return i0, i1


def lowpass(x, fc, order=2):
    sos = butter(order, fc / (SR / 2), btype='low', output='sos')
    return sosfilt(sos, x, axis=0)


def highpass(x, fc, order=2):
    sos = butter(order, fc / (SR / 2), btype='high', output='sos')
    return sosfilt(sos, x, axis=0)


def bandpass_sweep(x, f_from, f_to, q=2.0, block=256):
    """Time-varying band-pass: RBJ biquad re-designed per block, state carried over."""
    from scipy.signal import lfilter
    out = np.zeros_like(x)
    n = len(x)
    zi = np.zeros(2)
    for b0 in range(0, n, block):
        b1 = min(n, b0 + block)
        k = b0 / max(1, n - 1)
        f = f_from * (f_to / f_from) ** k
        w0 = 2 * math.pi * f / SR
        alpha = math.sin(w0) / (2 * q)
        bc = np.array([alpha, 0.0, -alpha]) / (1 + alpha)
        ac = np.array([1.0, -2 * math.cos(w0) / (1 + alpha), (1 - alpha) / (1 + alpha)])
        out[b0:b1], zi = lfilter(bc, ac, x[b0:b1], zi=zi)
    return out


def stereo(mono, pan=0.0, width=0.0, seed=0):
    """Equal-power pan; optional micro-delay decorrelation for width."""
    l = mono * math.cos((pan + 1) * math.pi / 4)
    r = mono * math.sin((pan + 1) * math.pi / 4)
    if width > 0:
        d = int(0.0007 * SR * width)
        r = np.concatenate([np.zeros(d), r[:-d]]) if d > 0 else r
    return np.stack([l, r], -1)


dry = np.zeros((N, 2))
wet = np.zeros((N, 2))  # reverb send


def add(buf, sig, t0=0.0):
    i0 = int(t0 * SR)
    i1 = min(N, i0 + len(sig))
    if i0 < N:
        buf[i0:i1] += sig[: i1 - i0]


# ------------------------------------------------------------------ instruments
def organ(freqs, t0, t1, attack=2.5, release=3.0, amp=0.12, bright=1.0, seed=1):
    """Additive organ-like chord: stable harmonics, 3-voice chorus, slow swell."""
    r = np.random.default_rng(seed)
    a = max(0.0, t0 - 0.01)
    i0, i1 = seg(a, t1 + release + 0.5)
    t = T[i0:i1]
    e = env_ar(t, t0, attack, t1, release)
    out = np.zeros((len(t), 2))
    harm = [(1, 1.0), (2, 0.42 * bright), (3, 0.22 * bright), (4, 0.12 * bright), (6, 0.05 * bright), (8, 0.025 * bright)]
    for f in freqs:
        for v, cents in enumerate((-4.0, 0.0, 4.5)):
            ff = f * 2 ** (cents / 1200)
            ph = r.uniform(0, 2 * math.pi)
            s = sum(w * np.sin(2 * math.pi * ff * k * t + ph * k) for k, w in harm)
            pan = (-0.45, 0.0, 0.45)[v]
            out += stereo(s, pan) / 3
    lfo = 1 + 0.06 * np.sin(2 * math.pi * 0.11 * t + seed)
    return out * (e * lfo * amp / max(1, len(freqs)) ** 0.5)[:, None], i0


def string_pad(freqs, t0, t1, attack=3.0, release=4.0, amp=0.08, cutoff=1800, seed=2):
    """Detuned band-limited saws through a low-pass: warm cinematic pad."""
    r = np.random.default_rng(seed)
    i0, i1 = seg(max(0, t0 - 0.01), t1 + release + 0.5)
    t = T[i0:i1]
    e = env_ar(t, t0, attack, t1, release)
    out = np.zeros((len(t), 2))
    for f in freqs:
        for v in range(4):
            ff = f * 2 ** (r.uniform(-9, 9) / 1200)
            ph = r.uniform(0, 2 * math.pi)
            s = np.zeros(len(t))
            for k in range(1, 14):
                if ff * k > 9000:
                    break
                s += np.sin(2 * math.pi * ff * k * t + ph * k) / k
            out += stereo(s, r.uniform(-0.7, 0.7))
    out = lowpass(out, cutoff, 2)
    return out * (e * amp / max(1, len(freqs) * 2) ** 0.5)[:, None], i0


def sine_tone(f, t0, dur, amp, attack=0.005, decay=None, pan=0.0):
    i0, i1 = seg(t0, t0 + dur)
    t = T[i0:i1] - t0
    e = smoothstep(t / attack) * (np.exp(-t / decay) if decay else 1.0)
    return stereo(np.sin(2 * math.pi * f * t) * e * amp, pan), i0


def pluck(f, t0, amp=0.06, decay=0.55, pan=0.0):
    i0, i1 = seg(t0, t0 + decay * 6)
    t = T[i0:i1] - t0
    e = smoothstep(t / 0.004) * np.exp(-t / decay)
    s = np.sin(2 * math.pi * f * t) + 0.25 * np.sin(2 * math.pi * 2 * f * t) * np.exp(-t / (decay * 0.4))
    return stereo(s * e * amp, pan), i0


def bell(f, t0, amp=0.1, decay=4.0, pan=0.0):
    i0, i1 = seg(t0, t0 + decay * 3)
    t = T[i0:i1] - t0
    parts = [(1.0, 1.0, 1.0), (2.76, 0.45, 0.6), (5.40, 0.25, 0.35), (8.93, 0.12, 0.2), (0.5, 0.35, 1.3)]
    s = sum(a * np.sin(2 * math.pi * f * m * t) * np.exp(-t / (decay * dk)) for m, a, dk in parts)
    return stereo(s * smoothstep(t / 0.003) * amp, pan, width=0.5), i0


def thump(t0, amp=0.5, f0=86, f1=38, decay=0.9):
    i0, i1 = seg(t0, t0 + decay * 5)
    t = T[i0:i1] - t0
    f = f1 + (f0 - f1) * np.exp(-t / 0.12)
    ph = 2 * math.pi * np.cumsum(f) / SR
    s = np.sin(ph) * np.exp(-t / decay) * smoothstep(t / 0.004)
    return stereo(s * amp, 0.0), i0


def noise(n, seed, color='white'):
    r = np.random.default_rng(seed)
    w = r.standard_normal(n)
    if color == 'brown':
        b = np.cumsum(w)
        b = highpass(b, 15, 1)
        return b / (np.std(b) + 1e-9)
    if color == 'pink':
        f = np.fft.rfft(w)
        k = np.arange(len(f))
        k[0] = 1
        return np.fft.irfft(f / np.sqrt(k), n) / 0.03
    return w


def whoosh(t0, t1, f_from, f_to, amp=0.3, seed=5, q=1.6):
    i0, i1 = seg(t0, t1)
    n = i1 - i0
    x = noise(n, seed)
    y = bandpass_sweep(x, f_from, f_to, q)
    t = np.linspace(0, 1, n)
    e = np.sin(np.pi * t) ** 1.5
    return np.stack([y, np.roll(y, 37)], -1) * (e * amp)[:, None] / (np.std(y) + 1e-9) * 0.25, i0


# ------------------------------------------------------------------ score
B = TL['beats']
X = TL['text']

# 1) Space bed: brown noise, very low, stereo; opens up with the story.
bed = np.stack([noise(N, 11, 'brown'), noise(N, 12, 'brown')], -1)
bed = lowpass(bed, 140, 2)
bed_env = (env_ar(T, 0.5, 3.5, 86.0, 2.5) * (0.55 + 0.45 * smoothstep((T - 10) / 12))
           * (1 - 0.35 * env_ar(T, 45, 3, 74, 3)))
dry += bed * (bed_env * 0.05)[:, None]
hiss = np.stack([noise(N, 13, 'pink'), noise(N, 14, 'pink')], -1)
hiss = highpass(lowpass(hiss, 5000, 2), 1500, 2)
dry += hiss * (env_ar(T, 4, 6, 30, 5) * 0.0045)[:, None]

# 2) Sub drone D1 + A1 with slow breathing.
sub = (np.sin(2 * math.pi * hz('D1') * T) * 0.6 + np.sin(2 * math.pi * hz('A1') * T) * 0.35
       + np.sin(2 * math.pi * hz('D2') * T) * 0.18)
sub_env = env_ar(T, 1.0, 6.0, 86.5, 2.0) * (0.75 + 0.25 * np.sin(2 * math.pi * 0.05 * T - 1.2))
sub_env *= 1 - 0.25 * env_ar(T, 45, 2, 74, 2)
dry += stereo(sub * sub_env * 0.11)

# 3) Harmony: organ + string pad. Chords per section (modal D major / B minor).
CH = {
    'D': ['D3', 'A3', 'D4', 'F#4', 'A4', 'E5'],
    'Bm': ['B2', 'F#3', 'B3', 'D4', 'F#4', 'C#5'],
    'G': ['G2', 'D3', 'G3', 'B3', 'F#4', 'A4'],
    'DA': ['A2', 'D3', 'A3', 'D4', 'F#4', 'E5'],
    'Asus': ['A2', 'E3', 'A3', 'D4', 'E4', 'B4'],
    'A': ['A2', 'E3', 'A3', 'C#4', 'E4', 'B4'],
    'DF': ['F#2', 'D3', 'A3', 'D4', 'F#4', 'A4'],
    'Dfinal': ['D2', 'A2', 'D3', 'A3', 'D4', 'F#4', 'A4', 'E5'],
}
prog = [
    (B['sunrise'], 22.0, 'D', 3.5, 0.10),
    (22.0, 27.0, 'Bm', 3.0, 0.10),
    (27.0, B['astanaPulse'], 'G', 2.5, 0.11),
    (B['astanaPulse'], 35.0, 'DA', 0.8, 0.12),
    (35.0, B['networkStart'], 'Asus', 1.5, 0.11),
    (B['networkStart'], 45.0, 'D', 1.8, 0.12),
    (45.0, 51.0, 'Bm', 1.2, 0.12),
    (51.0, 57.0, 'G', 1.2, 0.13),
    (57.0, 63.0, 'DF', 1.2, 0.14),
    (63.0, 69.0, 'A', 1.2, 0.15),
    (69.0, 71.0, 'Bm', 0.6, 0.17),
    (71.0, 73.0, 'G', 0.8, 0.18),
    (73.0, 75.5, 'D', 0.8, 0.19),
    (75.5, 79.0, 'G', 1.5, 0.15),
    (79.0, B['logo'], 'Asus', 1.5, 0.13),
]
for i, (a, b, name, att, amp) in enumerate(prog):
    o, i0 = organ([hz(n) for n in CH[name]], a, b, attack=att, release=2.2, amp=amp, bright=0.8, seed=30 + i)
    add(dry, o * 0.55, i0 / SR)
    add(wet, o * 0.45, i0 / SR)
    if a >= 45.0:
        p, j0 = string_pad([hz(n) for n in CH[name][:5]], a, b, attack=max(0.8, att), release=2.5,
                           amp=amp * 0.9, cutoff=1400 + 180 * (a - 45) / 3, seed=60 + i)
        add(dry, p * 0.5, j0 / SR)
        add(wet, p * 0.5, j0 / SR)
# Final chord on the logo, long tail into silence.
o, i0 = organ([hz(n) for n in CH['Dfinal']], B['logo'], B['fadeOut'] - 1.6, attack=0.9, release=3.2,
              amp=0.2, bright=0.9, seed=99)
add(dry, o * 0.5, i0 / SR)
add(wet, o * 0.6, i0 / SR)
p, i0 = string_pad([hz(n) for n in CH['Dfinal'][2:]], B['logo'], B['fadeOut'] - 1.5, attack=1.2, release=3.0,
                   amp=0.15, cutoff=2600, seed=98)
add(dry, p * 0.4, i0 / SR)
add(wet, p * 0.6, i0 / SR)

# 4) Sunrise: reverse-cymbal swell into the first chord.
w, i0 = whoosh(B['sunrise'] - 2.6, B['sunrise'] + 0.4, 600, 7000, amp=0.55, seed=21, q=0.9)
add(dry, w * 0.6, i0 / SR)
add(wet, w * 0.5, i0 / SR)
s, i0 = bell(hz('A5'), B['sunrise'] + 0.05, amp=0.05, decay=5.0, pan=0.3)
add(wet, s, i0 / SR)
add(dry, s * 0.4, i0 / SR)

# 5) Border drawing: glassy shimmer following the draw.
t0, t1 = B['borderDraw'], B['borderDrawEnd']
for k, n in enumerate(['A5', 'D6', 'E6', 'F#6', 'A6', 'D7']):
    tt = t0 + k * (t1 - t0) / 6
    s, i0 = bell(hz(n), tt, amp=0.022, decay=2.2, pan=-0.6 + k * 0.24)
    add(wet, s, i0 / SR)
    add(dry, s * 0.3, i0 / SR)
w, i0 = whoosh(t0 - 0.2, t1 + 0.6, 3000, 9000, amp=0.25, seed=23, q=3.0)
add(wet, w * 0.5, i0 / SR)

# 6) Astana pulse: deep thump + bell.
th, i0 = thump(B['astanaPulse'], amp=0.55)
add(dry, th, i0 / SR)
s, i0 = bell(hz('D5'), B['astanaPulse'] + 0.02, amp=0.08, decay=5.5)
add(dry, s * 0.5, i0 / SR)
add(wet, s * 0.7, i0 / SR)
for k in range(3):  # ring echoes (2.4 s cycle in the picture)
    s, i0 = bell(hz('A5'), B['astanaPulse'] + 0.6 * (k + 1), amp=0.02 / (k + 1), decay=2.5, pan=(-0.4, 0.4, 0)[k])
    add(wet, s, i0 / SR)

# 7) Atmosphere entry: long whoosh + rumble.
w, i0 = whoosh(B['cloudDive'] - 0.6, B['cloudDive'] + 3.6, 180, 2600, amp=0.8, seed=31, q=1.1)
add(dry, w, i0 / SR)
add(wet, w * 0.4, i0 / SR)
i0, i1 = seg(B['cloudDive'] - 0.4, B['cloudDive'] + 4.0)
rum = lowpass(noise(i1 - i0, 32, 'brown'), 90, 2)
e = np.sin(np.pi * np.linspace(0, 1, i1 - i0)) ** 2
dry[i0:i1] += stereo(rum * e * 0.12)

# 8) Network arrivals: pentatonic plucks, farther hubs higher.
penta = ['D5', 'E5', 'F#5', 'A5', 'B5', 'D6', 'E6']
for k, r in enumerate(sorted(TL['regional'], key=lambda x: x['arrive'])):
    n = penta[k % len(penta)]
    pl, i0 = pluck(hz(n), r['arrive'], amp=0.045, decay=0.7, pan=-0.7 + 1.4 * ((k * 7) % 19) / 18)
    add(dry, pl * 0.6, i0 / SR)
    add(wet, pl * 0.6, i0 / SR)

# 9) Pulse 45-75 s: soft sub kicks on quarters (96 BPM), 8th ticks from 57 s.
beat = 60 / 96
for k in range(int((75.0 - 45.0) / beat)):
    tk = 45.0 + k * beat
    vel = 0.22 + 0.5 * smoothstep((tk - 45) / 28)
    th, i0 = thump(tk, amp=0.28 * vel, f0=70, f1=44, decay=0.28)
    add(dry, th, i0 / SR)
    if tk >= 57.0:
        for half in (0, 0.5):
            ti = tk + half * beat
            j0, j1 = seg(ti, ti + 0.08)
            tt = T[j0:j1] - ti
            hh = highpass(noise(j1 - j0, int(ti * 1000)), 7000, 2) * np.exp(-tt / 0.018)
            dry[j0:j1] += stereo(hh * 0.012 * (0.6 + 0.4 * half) * smoothstep((ti - 57) / 6), pan=0.25 if half else -0.25)

# 10) Arpeggio from 51 s: chord tones in 16ths, rising density/brightness.
arp_ch = [(51.0, 'G'), (57.0, 'DF'), (63.0, 'A'), (69.0, 'Bm'), (71.0, 'G'), (73.0, 'D')]
step = beat / 4
for k in range(int((75.3 - 51.0) / step)):
    ta = 51.0 + k * step
    name = [c for a, c in arp_ch if a <= ta][-1]
    notes = CH[name][2:]
    n = notes[(k * 3) % len(notes)]
    f = hz(n) * 2
    density = smoothstep((ta - 51) / 12)
    if (k % 2 == 1) and density < 0.6:
        continue
    pl, i0 = pluck(f, ta, amp=0.018 + 0.022 * density, decay=0.22, pan=math.sin(k * 0.9) * 0.6)
    add(dry, pl * 0.7, i0 / SR)
    add(wet, pl * 0.5, i0 / SR)

# 11) Counter ticks (T3): soft clicks at a density that follows the counter rate.
vals = np.array(TL['counter']['values'])
t_c = TL['counter']['start'] + np.arange(len(vals)) / TL['counter']['fps']
rate = np.gradient(vals, 1 / 60)  # companies per second
acc = 0.0
for ti, rt in zip(t_c, rate):
    acc += rt / 60 / 40  # one tick per 40 companies
    while acc >= 1:
        acc -= 1
        j0, j1 = seg(ti, ti + 0.03)
        tt = T[j0:j1] - ti
        c = highpass(noise(j1 - j0, int(ti * 7919)), 3500, 2) * np.exp(-tt / 0.006)
        dry[j0:j1] += stereo(c * 0.02, pan=float(np.sin(ti * 13)) * 0.5)

# 12) T5 arcs: rising glissandi + ping on arrival.
for k, a in enumerate(TL['international']):
    i0, i1 = seg(a['start'], a['arrive'] + 0.3)
    tt = T[i0:i1] - a['start']
    L = a['arrive'] - a['start']
    f = hz('A4') * 2 ** (np.clip(tt / L, 0, 1) * 1.0 + k * 0.25)
    ph = 2 * math.pi * np.cumsum(f) / SR
    e = smoothstep(tt / 0.4) * (1 - smoothstep((tt - L) / 0.3))
    add(wet, stereo(np.sin(ph) * e * 0.02, pan=-0.5 + k * 0.33), a['start'])
    s, j0 = bell(hz('E6') * 2 ** (k * 0.25), a['arrive'], amp=0.03, decay=2.0, pan=-0.5 + k * 0.33)
    add(wet, s, j0 / SR)

# 13) T6 goals: three low hits.
for k, tg in enumerate(TL['goals']):
    th, i0 = thump(tg, amp=0.5, f0=110, f1=46, decay=0.8)
    add(dry, th, i0 / SR)
    j0, j1 = seg(tg, tg + 0.25)
    tt = T[j0:j1] - tg
    nb = lowpass(noise(j1 - j0, 400 + k), 900, 2) * np.exp(-tt / 0.05)
    dry[j0:j1] += stereo(nb * 0.08)
    s, i0 = bell(hz(['D5', 'F#5', 'A5'][k]), tg + 0.01, amp=0.05, decay=3.0, pan=(-0.4, 0.0, 0.4)[k])
    add(wet, s, i0 / SR)

# 14) Logo: sub drop + bell + sparkle.
th, i0 = thump(B['logo'], amp=0.6, f0=64, f1=30, decay=1.6)
add(dry, th, i0 / SR)
s, i0 = bell(hz('D5'), B['logo'] + 0.02, amp=0.1, decay=6.0)
add(dry, s * 0.4, i0 / SR)
add(wet, s * 0.8, i0 / SR)
for k, n in enumerate(['A6', 'D7', 'F#7']):
    s, i0 = bell(hz(n), B['slogan'] + k * 0.18, amp=0.012, decay=2.5, pan=(-0.3, 0.3, 0)[k])
    add(wet, s, i0 / SR)

# ------------------------------------------------------------------ reverb + master
ir_len = int(4.2 * SR)
tt = np.arange(ir_len) / SR
ir = np.stack([noise(ir_len, 501), noise(ir_len, 502)], -1) * np.exp(-tt / 1.1)[:, None]
ir = lowpass(ir, 6500, 1)
ir[: int(0.012 * SR)] = 0  # pre-delay
ir /= np.sqrt((ir ** 2).sum(0))
rev = np.stack([fftconvolve(wet[:, c], ir[:, c])[:N] for c in range(2)], -1)
mix = dry + rev * 0.55

# Silence at the very start and a clean tail to digital silence at the end.
fade = smoothstep((T - 0.5) / 0.8) * (1 - smoothstep((T - (DUR - 2.4)) / 1.9))
mix *= fade[:, None]
mix = highpass(mix, 22, 2)

try:
    import pyloudnorm as pyln
except ImportError:  # pragma: no cover
    pyln = None


def true_peak_db(x):
    up = resample_poly(x, 4, 1, axis=0)
    return 20 * math.log10(np.max(np.abs(up)) + 1e-12)


def lookahead_limit(x, ceiling_db=-1.3, look_ms=5.0, release_ms=80.0):
    """Transparent peak limiter: per-sample gain from 4x-oversampled peaks, held over a
    lookahead window (min filter) and released smoothly. Deterministic."""
    from scipy.ndimage import minimum_filter1d
    ceil = 10 ** (ceiling_db / 20)
    up = np.abs(resample_poly(x, 4, 1, axis=0)).max(1).reshape(-1, 4).max(1)[: len(x)]
    need = np.minimum(1.0, ceil / np.maximum(up, 1e-9))
    look = int(look_ms * SR / 1000)
    g = minimum_filter1d(need, size=2 * look + 1)
    # release smoothing (one-pole, only when the gain rises)
    rel = math.exp(-1.0 / (release_ms * SR / 1000))
    out = np.empty_like(g)
    cur = 1.0
    for i in range(len(g)):
        cur = g[i] if g[i] < cur else g[i] + (cur - g[i]) * rel
        out[i] = cur
    # smooth attack edges with a short moving average (keeps gain <= needed via min above)
    k = np.ones(look) / look
    out = np.minimum(out, np.convolve(out, k, mode='same'))
    return x * out[:, None]


meter = pyln.Meter(SR) if pyln else None
target = -14.0
for _ in range(8):
    loud = meter.integrated_loudness(mix)
    mix *= 10 ** ((target - loud) / 20)
    mix = lookahead_limit(mix)
    if abs(meter.integrated_loudness(mix) - target) < 0.1:
        break
loud = meter.integrated_loudness(mix)
tp = true_peak_db(mix)
print(f'integrated loudness {loud:.2f} LUFS, true peak {tp:.2f} dBTP')
for w0 in range(0, int(DUR), 3):
    seg_ = mix[int(w0 * SR): int((w0 + 3) * SR)]
    rms = 20 * math.log10(np.sqrt((seg_ ** 2).mean()) + 1e-12)
    pk = 20 * math.log10(np.abs(seg_).max() + 1e-12)
    print(f'  {w0:2d}-{w0 + 3:2d}s  rms {rms:6.1f} dBFS  peak {pk:6.1f}')

out = ROOT / 'public' / 'audio' / 'soundtrack.wav'
out.parent.mkdir(parents=True, exist_ok=True)
pcm = np.clip(mix, -1, 1 - 1 / 2 ** 23)
i24 = np.round(pcm * (2 ** 23 - 1)).astype(np.int32)
b = np.zeros((N, 2, 3), np.uint8)
b[..., 0] = i24 & 0xFF
b[..., 1] = (i24 >> 8) & 0xFF
b[..., 2] = (i24 >> 16) & 0xFF
import wave

with wave.open(str(out), 'wb') as w:
    w.setnchannels(2)
    w.setsampwidth(3)
    w.setframerate(SR)
    w.writeframes(b.tobytes())
print(f'wrote {out.relative_to(ROOT)} ({N / SR:.2f} s)')
