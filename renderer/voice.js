// Fala do Shaco. Três estilos:
// - 'gemini': voz expressiva gerada pelo Gemini TTS (volta para 'shaco' se falhar)
// - 'shaco': voz do Windows mais grave e lenta, com pausas teatrais e risadinhas
// - 'natural': voz do Windows sem efeitos
(() => {
  const LAUGHS = ['Hehehe...', 'Hihihi...', 'Ahahah...', 'Hmhmhm...'];
  const MALE = /daniel|antonio|thiago|ricardo|helio|male|masculin/i;
  const bridge = () => window.shaco?.tts || window.launcher?.tts;

  let voices = [];
  let audio = null;
  let token = 0; // só a fala mais recente toca

  function loadVoices() {
    voices = speechSynthesis.getVoices();
  }
  speechSynthesis.onvoiceschanged = loadVoices;
  loadVoices();

  function pickVoice(style) {
    const pt = voices.filter((v) => v.lang === 'pt-BR' || v.lang.startsWith('pt'));
    if (style === 'shaco') return pt.find((v) => MALE.test(v.name)) || pt[0] || null;
    return pt[0] || null;
  }

  function theatrical(text) {
    return text.replace(/([.!?])\s+/g, '$1.. ').replace(/,\s+/g, '... ');
  }

  function stop() {
    speechSynthesis.cancel();
    if (audio) {
      audio.pause();
      audio = null;
    }
  }

  function speakWindows(text, settings, { auto, onStart, onEnd }) {
    const style = settings.style === 'natural' ? 'natural' : 'shaco';
    let line = text;
    if (style === 'shaco') {
      line = theatrical(line);
      if (auto && Math.random() < 0.35) line = `${LAUGHS[Math.floor(Math.random() * LAUGHS.length)]} ${line}`;
    }
    const u = new SpeechSynthesisUtterance(line);
    u.lang = 'pt-BR';
    const voice = pickVoice(style);
    if (voice) u.voice = voice;
    u.pitch = style === 'shaco' ? settings.pitch ?? 0.6 : 1;
    u.rate = style === 'shaco' ? settings.rate ?? 0.9 : 1.1;
    u.onstart = () => onStart?.();
    u.onend = u.onerror = () => onEnd?.();
    speechSynthesis.speak(u);
    return voice ? `Windows: ${voice.name}` : null;
  }

  async function speak(text, settings = {}, { auto = false, onStart, onEnd } = {}) {
    const mine = ++token;
    stop();
    const clean = text.replace(/[*_#`]/g, '');
    if (settings.style === 'gemini' && bridge()) {
      try {
        const { mime, data } = await bridge()(clean);
        if (mine !== token) return null; // chegou outra fala enquanto gerava
        audio = new Audio(`data:${mime};base64,${data}`);
        audio.onplay = () => onStart?.();
        audio.onended = audio.onerror = () => onEnd?.();
        await audio.play();
        return `Gemini: ${settings.gemini || 'Algenib'}`;
      } catch (err) {
        console.warn('Voz do Gemini falhou, usando a do Windows:', err.message);
        if (mine !== token) return null;
      }
    }
    return speakWindows(clean, settings, { auto, onStart, onEnd });
  }

  window.shacoVoice = { speak, stop };
})();
