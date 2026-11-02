// Tocador da cabeça do Shaco (assets/anim/head): 6 quadros, do sorriso de canto à gargalhada.
// Entre um quadro e outro faz uma transição suave (o próximo vai aparecendo por cima),
// e quanto mais ele ri, mais a cabeça balança.
(() => {
  const BASE = '../assets/anim/';
  const ease = (t) => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2);

  class HeadPlayer {
    constructor(canvas, anim) {
      this.canvas = canvas;
      this.ctx = canvas.getContext('2d');
      this.anim = anim;
      this.images = [];
      this.pos = 0; // quadro atual; 2.4 = 60% entre o quadro 2 e o 3
      this.raf = null;
      this.current = null;
    }

    preload() {
      this.canvas.width = this.anim.frameWidth;
      this.canvas.height = this.anim.frameHeight;
      this.images = this.anim.frames.map((rel) => {
        const im = new Image();
        im.src = BASE + rel;
        return im;
      });
      return Promise.all(this.images.map((im) => im.decode())).then(() => this.draw(0));
    }

    draw(now) {
      const { ctx, canvas, images } = this;
      const i = Math.min(Math.floor(this.pos), images.length - 1);
      const f = this.pos - i;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.globalAlpha = 1;
      ctx.drawImage(images[i], 0, 0, canvas.width, canvas.height);
      if (f > 0.01 && images[i + 1]) {
        ctx.globalAlpha = f;
        ctx.drawImage(images[i + 1], 0, 0, canvas.width, canvas.height);
      }
      // balanço proporcional à risada (quadros 3 a 5)
      const energy = Math.max(0, this.pos - 2) / 3;
      if (this.raf && energy > 0) {
        const t = now / 1000;
        const y = -Math.abs(Math.sin(t * 15)) * 7 * energy;
        const r = Math.sin(t * 7.5) * 4 * energy;
        const s = 1 + Math.abs(Math.sin(t * 15)) * 0.04 * energy;
        canvas.style.transform = `translateY(${y}px) rotate(${r}deg) scale(${s}, ${2 - s})`;
      } else {
        canvas.style.transform = '';
      }
    }

    hold(frame = 0) {
      this.stop();
      this.pos = frame;
      this.draw(0);
    }

    stop() {
      if (this.raf) cancelAnimationFrame(this.raf);
      this.raf = null;
      if (this.current) this.current.resolve(false);
      this.current = null;
      this.draw(0);
    }

    // keys: [[quadro, ms], ...]; vai de quadro em quadro com transição suave.
    // loops = Infinity repete até stop().
    play(keys, { loops = 1 } = {}) {
      this.stop();
      return new Promise((resolve) => {
        const job = { resolve };
        this.current = job;
        let k = 0;
        let loop = 0;
        let from = this.pos;
        let start = null;
        const tick = (now) => {
          if (this.current !== job) return;
          if (start === null) start = now;
          const [to, ms] = keys[k];
          const t = Math.min(1, (now - start) / ms);
          this.pos = from + (to - from) * ease(t);
          if (t >= 1) {
            from = this.pos = to;
            start = now;
            if (++k >= keys.length) {
              k = 0;
              if (++loop >= loops) {
                this.current = null;
                this.raf = null;
                this.draw(now);
                return resolve(true);
              }
            }
          }
          this.draw(now);
          this.raf = requestAnimationFrame(tick);
        };
        this.raf = requestAnimationFrame(tick);
      });
    }
  }

  window.HeadPlayer = HeadPlayer;
})();
