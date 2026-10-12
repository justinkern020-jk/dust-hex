# Original procedurally synthesized SFX for Dust Hex (no samples; CC0 by construction).
import numpy as np, wave, subprocess
SR=44100; rng=np.random.default_rng(7)
def t(d): return np.arange(int(SR*d))/SR
def lp(x,a):  # one-pole lowpass
    y=np.empty_like(x); s=0.
    for i,v in enumerate(x): s+=a*(v-s); y[i]=s
    return y
def save(name,x):
    x=x/np.max(np.abs(x))*0.89
    with wave.open(name+'.wav','w') as w:
        w.setnchannels(1);w.setsampwidth(2);w.setframerate(SR);w.writeframes((x*32767).astype(np.int16).tobytes())
    subprocess.run(['ffmpeg','-y','-loglevel','error','-i',name+'.wav','-codec:a','libmp3lame','-q:a','4',name+'.mp3'])
def clang(base,seed,spur=True):
    r=np.random.default_rng(seed); d=1.1; tt=t(d); x=np.zeros_like(tt)
    for k,(ratio,dec,amp) in enumerate([(1,5,1),(2.76,7,.6),(5.4,11,.4),(8.93,16,.25),(13.3,22,.15)]):
        f=base*ratio*(1+r.uniform(-.01,.01)); x+=amp*np.sin(2*np.pi*f*tt+r.uniform(0,6))*np.exp(-dec*tt)
    n=r.standard_normal(len(tt))*np.exp(-60*tt); x+=0.9*(n-lp(n,.2))   # steel transient
    thump=np.sin(2*np.pi*90*tt)*np.exp(-25*tt); x+=0.7*thump
    if spur:
        for j in range(4):
            o=int(SR*(0.09+j*0.055+r.uniform(0,.02))); s=t(0.25)
            jing=sum(np.sin(2*np.pi*f*s)*np.exp(-30*s) for f in (4200+r.uniform(-300,300),6100,7900))*0.08
            x[o:o+len(s)]+=jing[:len(x)-o]
    return x
for i,(b,s) in enumerate([(420,1),(470,2),(380,3)],1): save(f'clash-{i}',clang(b,s))
# crumble: low thud + gritty crackle bursts decaying into dust hiss
tt=t(1.2); x=0.9*np.sin(2*np.pi*(70-30*tt)*tt)*np.exp(-9*tt)
for k in range(40):
    o=int(SR*min(1.1,abs(rng.normal(0.15,0.25)))); L=int(SR*rng.uniform(.005,.03)); g=rng.standard_normal(L)*np.exp(-np.linspace(0,6,L))*rng.uniform(.2,.6)*np.exp(-o/SR*2)
    x[o:o+L]+=g[:len(x)-o]
h=rng.standard_normal(len(tt)); x+=0.15*lp(h,.15)*np.exp(-3*tt)*(tt>0.05)
save('crumble',x)
# landing thud: soft dusty boom
tt=t(0.5); n=rng.standard_normal(len(tt)); x=np.sin(2*np.pi*(95-40*tt)*tt)*np.exp(-14*tt)+0.5*lp(n,.05)*np.exp(-18*tt)*8
save('thud',x)

# coin jingle for claiming a money tile: a few bright struck coins
tt=t(0.7); x=np.zeros_like(tt)
for j,(o,f) in enumerate([(0,2400),(0.07,3150),(0.13,2750),(0.21,3600)]):
    s0=int(SR*o); s=t(0.5)
    c=sum(a*np.sin(2*np.pi*f*r*s)*np.exp(-d*s) for r,a,d in [(1,1,9),(2.4,.5,14),(4.1,.25,22)])
    x[s0:s0+len(s)]+=c[:len(x)-s0]*(1-0.15*j)
save('jingle',x)
