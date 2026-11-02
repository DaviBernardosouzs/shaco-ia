// Voz expressiva pelo Gemini TTS: uma voz original guiada por uma descrição de estilo.
const API = 'https://generativelanguage.googleapis.com/v1beta/models';
const MODELS = ['gemini-3.8-flash-lite-tts', 'gemini-3.8-flash-tts', 'gemini-3.1-flash-tts-preview'];
const TIMEOUT_MS = 15000;

const STYLE =
  'Leia em português do Brasil como um bobo da corte sinistro e debochado: voz masculina rouca, ' +
  'meio sussurrada, com pausas teatrais, tom de quem está aprontando e uma risadinha contida no fim. Texto';

// Vozes prontas do Gemini que combinam com o personagem
const VOICES = {
  Algenib: 'Rouca',
  Enceladus: 'Sussurrada',
  Charon: 'Grave',
  Puck: 'Animada',
};

// Alguns modelos devolvem PCM cru (audio/L16); o player precisa de um WAV com cabeçalho.
function pcmToWav(pcm, rate = 24000, channels = 1) {
  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(rate, 24);
  header.writeUInt32LE(rate * channels * 2, 28);
  header.writeUInt16LE(channels * 2, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36);
  header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}

function createTts(config) {
  let working = null; // último modelo que respondeu, tentado primeiro

  async function call(model, text, voice) {
    const res = await fetch(`${API}/${model}:generateContent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': config.geminiApiKey },
      signal: AbortSignal.timeout(TIMEOUT_MS),
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: `${STYLE}: ${text}` }] }],
        generationConfig: {
          responseModalities: ['AUDIO'],
          speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: voice } } },
        },
      }),
    });
    if (!res.ok) throw new Error(`TTS ${model} respondeu ${res.status}`);
    const data = await res.json();
    const part = data.candidates?.[0]?.content?.parts?.find((p) => p.inlineData);
    if (!part) throw new Error(`TTS ${model} não devolveu áudio`);
    const mime = part.inlineData.mimeType.toLowerCase();
    const raw = Buffer.from(part.inlineData.data, 'base64');
    if (mime.includes('wav')) return raw.toString('base64');
    const rate = Number(mime.match(/rate=(\d+)/)?.[1]) || 24000;
    return pcmToWav(raw, rate).toString('base64');
  }

  async function synth(text) {
    if (!config.geminiApiKey) throw new Error('Sem chave do Gemini');
    const voice = VOICES[config.geminiVoice] ? config.geminiVoice : 'Algenib';
    const order = working ? [working, ...MODELS.filter((m) => m !== working)] : MODELS;
    let lastErr = null;
    for (const model of order) {
      try {
        const data = await call(model, text, voice);
        working = model;
        return { mime: 'audio/wav', data };
      } catch (err) {
        lastErr = err;
      }
    }
    throw lastErr;
  }

  return { synth };
}

module.exports = { createTts, VOICES };
