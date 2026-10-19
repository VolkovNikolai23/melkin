// Мелкие радости: конфетти и всплывающие поздравления. Рисуем на отдельном canvas поверх
// всего и только короткими вспышками — рисованию Pencil это не мешает.

const COLORS = ['#f9a8c9', '#a5c8ec', '#9e3d5a', '#fde68a', '#bbf7d0', '#d8b4fe', '#fbcfe8'];

let enabled = true;
/** Включение из настроек («Анимации и конфетти») */
export function setJoy(on: boolean) {
  enabled = on;
}

const reduced = () => typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;
export const joyOn = () => enabled && !reduced();

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number;
  rot: number;
  vr: number;
  color: string;
  shape: 0 | 1 | 2;
}

/** Конфетти: power 1 — небольшой салют, 2 — праздник. */
export function confetti(power: 1 | 2 = 1, origin?: { x: number; y: number }) {
  if (!joyOn() || typeof document === 'undefined') return;
  const c = document.createElement('canvas');
  c.className = 'confetti-canvas';
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const W = window.innerWidth;
  const H = window.innerHeight;
  c.width = W * dpr;
  c.height = H * dpr;
  document.body.appendChild(c);
  const ctx = c.getContext('2d')!;
  ctx.scale(dpr, dpr);
  const n = power === 2 ? 160 : 70;
  const ox = origin?.x ?? W / 2;
  const oy = origin?.y ?? H * 0.35;
  const parts: Particle[] = Array.from({ length: n }, () => {
    const a = -Math.PI / 2 + (Math.random() - 0.5) * Math.PI * (power === 2 ? 1.3 : 0.9);
    const v = 6 + Math.random() * (power === 2 ? 9 : 6);
    return {
      x: ox,
      y: oy,
      vx: Math.cos(a) * v,
      vy: Math.sin(a) * v,
      r: 4 + Math.random() * 5,
      rot: Math.random() * Math.PI,
      vr: (Math.random() - 0.5) * 0.3,
      color: COLORS[Math.floor(Math.random() * COLORS.length)],
      shape: Math.floor(Math.random() * 3) as 0 | 1 | 2,
    };
  });
  const start = performance.now();
  const life = power === 2 ? 2400 : 1600;
  const heart = (r: number) => {
    ctx.beginPath();
    ctx.moveTo(0, r * 0.35);
    ctx.bezierCurveTo(r, -r * 0.4, r * 0.5, -r, 0, -r * 0.4);
    ctx.bezierCurveTo(-r * 0.5, -r, -r, -r * 0.4, 0, r * 0.35);
    ctx.fill();
  };
  const frame = (t: number) => {
    const k = (t - start) / life;
    ctx.clearRect(0, 0, W, H);
    for (const p of parts) {
      p.vy += 0.25;
      p.vx *= 0.99;
      p.x += p.vx;
      p.y += p.vy;
      p.rot += p.vr;
      ctx.save();
      ctx.globalAlpha = Math.max(0, 1 - k * k);
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rot);
      ctx.fillStyle = p.color;
      if (p.shape === 0) ctx.fillRect(-p.r / 2, -p.r / 4, p.r, p.r / 2);
      else if (p.shape === 1) {
        ctx.beginPath();
        ctx.arc(0, 0, p.r / 2.4, 0, Math.PI * 2);
        ctx.fill();
      } else heart(p.r * 0.8);
      ctx.restore();
    }
    if (k < 1) requestAnimationFrame(frame);
    else c.remove();
  };
  requestAnimationFrame(frame);
}

/** Короткое всплывающее поздравление сверху (само исчезает). */
export function cheer(text: string, ms = 2600) {
  if (typeof document === 'undefined') return;
  const el = document.createElement('div');
  el.className = 'cheer';
  el.setAttribute('role', 'status');
  el.textContent = text;
  document.body.appendChild(el);
  setTimeout(() => el.classList.add('out'), ms - 350);
  setTimeout(() => el.remove(), ms);
}

/** Сердечко, всплывающее от элемента (реакция на «Знаю» и верный ответ). */
export function floatHeart(from: Element | null, label = '+1') {
  if (!joyOn() || !from) return;
  const r = from.getBoundingClientRect();
  const el = document.createElement('div');
  el.className = 'float-heart';
  el.textContent = `♥ ${label}`;
  el.style.left = `${r.left + r.width / 2}px`;
  el.style.top = `${r.top}px`;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 900);
}

/** Стрик, которым стоит гордиться отдельно */
export const STREAK_MILESTONES = [3, 7, 14, 21, 30, 50, 75, 100, 150, 200, 365];
