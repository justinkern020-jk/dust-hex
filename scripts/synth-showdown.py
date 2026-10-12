# "Standoff" - original tense western loop for Dust Hex's endgame. Synthesized from scratch (CC0).
import numpy as np, wave, subprocess
SR = 44100; BPM = 72; BEAT = 60 / BPM; BARS = 16
L = int(round(BARS * 4 * BEAT * SR)); TAIL = 4 * SR
out = np.zeros((L + TAIL, 2))
rng = np.random.default_rng(3)
def t(d): return np.arange(int(d * SR)) / SR
def add(sig, start, pan=0.0, gain=1.0):
    s = int(start * SR); e = min(len(out), s + len(sig))
    l = np.cos((pan + 1) * np.pi / 4); r = np.sin((pan + 1) * np.pi / 4)
    out[s:e, 0] += sig[:e - s] * l * gain; out[s:e, 1] += sig[:e - s] * r * gain
def lp(x, a):
    y = np.empty_like(x); s = 0.0
    for i in range(len(x)): s += a * (x[i] - s); y[i] = s
    return y
hz = lambda n: 440 * 2 ** ((n - 69) / 12)
# chords (D minor): Dm | Dm | Bb | A  (x4), last 4 bars tighten: Gm A Bb A
prog = [[50, 53, 57], [50, 53, 57], [46, 50, 53], [45, 49, 52]] * 3 + [[43, 46, 50], [45, 49, 52], [46, 50, 53], [45, 49, 52]]
bar = 4 * BEAT
# 1. tremolo strings: detuned saws, 12 Hz tremolo, slow swell per bar, filtered
for b, ch in enumerate(prog):
    d = bar + 0.3; tt = t(d)
    sig = np.zeros_like(tt)
    for n in ch:
        for det in (-0.12, 0.1):
            f = hz(n + 12) * 2 ** (det / 12)
            sig += 2 * ((f * tt) % 1) - 1
    trem = 0.55 + 0.45 * np.sin(2 * np.pi * 12 * tt)
    env = np.minimum(1, tt / 0.6) * np.minimum(1, (d - tt) / 0.3)
    build = 0.75 + 0.25 * (b / (len(prog) - 1))
    sig = lp(sig * trem * env, 0.08) * build
    add(sig, b * bar, pan=(-0.35 if b % 2 else 0.35), gain=0.05)
# 2. low drone (D) under everything
tt = np.arange(L) / SR; D = L / SR
fi = lambda f: round(f * D) / D  # whole cycles per loop: no click at the seam
add(lp(np.sin(2 * np.pi * fi(hz(38)) * tt) + 0.3 * np.sin(2 * np.pi * fi(hz(50)) * tt), 0.2) * 0.9, 0, gain=0.09)
# 3. pocket-watch tick, every half beat, alternating pitch
for k in range(BARS * 8):
    tt = t(0.03); n = rng.standard_normal(len(tt)) * np.exp(-tt * 260)
    tick = n - lp(n, 0.35)
    add(tick, k * BEAT / 2, pan=0.5, gain=0.12 if k % 2 == 0 else 0.07)
# 4. heartbeat: lub-dub on beats 1 & 3, getting stronger
def thump(f, dec):
    tt = t(0.35); return np.sin(2 * np.pi * (f + 40 * np.exp(-tt * 30)) * tt) * np.exp(-tt * dec)
for b in range(BARS):
    g = 0.65 + 0.35 * b / (BARS - 1)
    for beat in (0, 2):
        s = b * bar + beat * BEAT
        add(thump(55, 14), s, gain=0.5 * g); add(thump(50, 18), s + 0.22, gain=0.32 * g)
# 5. twangy guitar (Karplus-Strong), sparse desert riff with a bend feel
def pluck(f, d=1.6, bright=0.5):
    N = int(SR / f); buf = rng.uniform(-1, 1, N); n = int(d * SR); y = np.zeros(n)
    for i in range(n):
        y[i] = buf[i % N]; buf[i % N] = 0.996 * (bright * buf[i % N] + (1 - bright) * buf[(i + 1) % N])
    return y * np.exp(-t(d) * 1.2)
riff = [(0, 62), (1.5, 65), (2, 64), (3, 62), (6, 57), (7, 61)]  # beat offsets inside 2 bars
for rep in range(BARS // 2):
    if rep in (0,): continue
    for off, n in riff:
        add(pluck(hz(n)), rep * 2 * bar + off * BEAT, pan=-0.45, gain=0.32)
# 6. harmonica swell: reed tone with vibrato on bars 8 and 12-15
def harp(n, d):
    tt = t(d); vib = 1 + 0.006 * np.sin(2 * np.pi * 5.5 * tt) * np.minimum(1, tt / 0.8)
    ph = np.cumsum(hz(n) * vib) / SR
    s = np.sign(np.sin(2 * np.pi * ph)) * 0.5 + np.sin(2 * np.pi * 2 * ph) * 0.3 + np.sin(2 * np.pi * 3 * ph) * 0.2
    env = np.minimum(1, tt / (d * 0.55)) ** 2 * np.minimum(1, (d - tt) / 0.5)
    return lp(s * env, 0.18)
add(harp(69, bar * 1.8), 7 * bar, pan=0.25, gain=0.07)
add(harp(70, bar * 1.0), 12 * bar, pan=0.25, gain=0.07)
add(harp(69, bar * 2.6), 13.2 * bar, pan=0.25, gain=0.08)
# 7. building drums: toms from bar 8, denser in last 4 bars; snare rolls into the loop point
def tom(f):
    tt = t(0.4); return np.sin(2 * np.pi * (f + 60 * np.exp(-tt * 25)) * tt) * np.exp(-tt * 9) + 0.15 * rng.standard_normal(len(tt)) * np.exp(-tt * 40)
for b in range(0, BARS):
    hits = [0, 2] if b < 8 else [0, 1.5, 2, 3] if b < 12 else [0, 0.75, 1.5, 2, 2.5, 3, 3.5]
    for h in hits: add(tom(90 if h % 1 == 0 else 120), b * bar + h * BEAT, pan=0.1, gain=0.2 if b < 8 else 0.35)
for k in range(16):
    tt = t(0.12); n = rng.standard_normal(len(tt)) * np.exp(-tt * 35)
    add(n - lp(n, 0.3), L / SR - BEAT * 2 + k * BEAT / 8, gain=0.04 + 0.12 * k / 15)
# fold the tail back onto the start: seamless loop of exactly L samples
loop = out[:L].copy(); loop[:TAIL] += out[L:L + TAIL]
loop = np.tanh(loop / np.max(np.abs(loop)) * 1.2) * 0.85
pcm = (loop * 32767).astype(np.int16)
with wave.open('showdown.wav', 'w') as w:
    w.setnchannels(2); w.setsampwidth(2); w.setframerate(SR); w.writeframes(pcm.tobytes())
print('loop seconds', L / SR)
for ext, args in [('ogg', ['-c:a', 'libopus', '-b:a', '96k']), ('m4a', ['-c:a', 'aac', '-b:a', '128k'])]:
    subprocess.run(['ffmpeg', '-y', '-loglevel', 'error', '-i', 'showdown.wav', *args, f'showdown.{ext}'], check=True)
