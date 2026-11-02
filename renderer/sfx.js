// Efeitos sonoros curtos gerados na hora (Web Audio): sem arquivos de som no app.
(() => {
  let ctx = null;
  const audio = () => (ctx ||= new AudioContext());

  // uma nota com ataque rápido e queda suave
  function tone(freq, start, dur, { type = 'sine', gain = 0.18, slideTo } = {}) {
    const a = audio();
    const osc = a.createOscillator();
    const g = a.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, a.currentTime + start);
    if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, a.currentTime + start + dur);
    g.gain.setValueAtTime(0.0001, a.currentTime + start);
    g.gain.exponentialRampToValueAtTime(gain, a.currentTime + start + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, a.currentTime + start + dur);
    osc.connect(g).connect(a.destination);
    osc.start(a.currentTime + start);
    osc.stop(a.currentTime + start + dur + 0.02);
  }

  // estalo de ruído (o "pop" do confete)
  function pop(start, dur = 0.08, gain = 0.25) {
    const a = audio();
    const buf = a.createBuffer(1, Math.floor(a.sampleRate * dur), a.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / data.length) ** 3;
    const src = a.createBufferSource();
    const filter = a.createBiquadFilter();
    const g = a.createGain();
    src.buffer = buf;
    filter.type = 'highpass';
    filter.frequency.value = 900;
    g.gain.value = gain;
    src.connect(filter).connect(g).connect(a.destination);
    src.start(a.currentTime + start);
  }

  window.shacoSfx = {
    // clique curto da roleta girando
    tick() {
      tone(1400, 0, 0.03, { type: 'square', gain: 0.03 });
    },
    // pop do canhão de confete + brilhinhos caindo
    confetti() {
      pop(0, 0.09, 0.3);
      [1568, 2093, 1760, 2637, 2349].forEach((f, i) => tone(f, 0.06 + i * 0.055, 0.22, { type: 'triangle', gain: 0.07 }));
    },
    // notificação de "deu certo": duas notas subindo
    success() {
      tone(880, 0, 0.18, { type: 'sine', gain: 0.2 });
      tone(1318.5, 0.12, 0.35, { type: 'sine', gain: 0.2 });
    },
    // "deu errado": zumbido grave descendo, duas vezes
    error() {
      tone(220, 0, 0.16, { type: 'square', gain: 0.07, slideTo: 160 });
      tone(196, 0.19, 0.26, { type: 'square', gain: 0.07, slideTo: 130 });
    },
  };
})();
