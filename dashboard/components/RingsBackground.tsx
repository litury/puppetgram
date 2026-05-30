'use client';

import { useEffect, useRef } from 'react';
import { Renderer, Program, Mesh, Triangle, Vec2, Color } from 'ogl';

const vertex = /* glsl */ `
  attribute vec2 uv;
  attribute vec2 position;
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4(position, 0.0, 1.0);
  }
`;

// Два источника по бокам от текста — мягкие светящиеся дуги, центр спокойный, реакция на курсор.
const fragment = /* glsl */ `
  precision highp float;
  uniform float uTime;
  uniform vec2 uResolution;
  uniform vec2 uMouse;
  uniform vec3 uColor;
  uniform vec3 uBg;
  varying vec2 vUv;

  // Мягкие концентрические дуги от точки f + лёгкая дымка.
  float emitter(vec2 p, vec2 f) {
    float d = distance(p, f);
    float wave = 0.5 + 0.5 * sin(d * 30.0 - uTime * 2.0);
    float ring = smoothstep(0.55, 1.0, wave);   // мягкие полосы
    float glow = exp(-d * 3.2);                  // затухание от источника
    float haze = exp(-d * 2.0) * 0.12;           // объёмная дымка
    return ring * glow + haze;
  }

  void main() {
    float aspect = uResolution.x / uResolution.y;
    vec2 p = vUv; p.x *= aspect;

    // источники слегка «дышат» к курсору
    vec2 m = (uMouse - 0.5) * 0.05;
    vec2 fL = vec2(0.18 * aspect, 0.5) + m;
    vec2 fR = vec2(0.82 * aspect, 0.5) + m;

    float i = emitter(p, fL) + emitter(p, fR);

    // приглушить центр под текстом
    float center = distance(p, vec2(0.5 * aspect, 0.5));
    i *= smoothstep(0.04, 0.30, center) * 0.85 + 0.15;

    vec3 col = mix(uBg, uColor, clamp(i, 0.0, 1.0));
    gl_FragColor = vec4(col, 1.0);
  }
`;

// Резолвит CSS-токен в [r,g,b] 0..1 (через probe — var() надёжно вычисляется в computed color).
function readVarColor(host: HTMLElement, varName: string, fallback: [number, number, number]): [number, number, number] {
  const probe = document.createElement('span');
  probe.style.cssText = `color: var(${varName}); position: absolute; opacity: 0; pointer-events: none;`;
  host.appendChild(probe);
  const rgb = getComputedStyle(probe).color;
  host.removeChild(probe);
  const m = rgb.match(/\d+(\.\d+)?/g);
  if (!m || m.length < 3) return fallback;
  return [Number(m[0]) / 255, Number(m[1]) / 255, Number(m[2]) / 255];
}

export function RingsBackground({ className = '' }: { className?: string }) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    const renderer = new Renderer({
      dpr: Math.min(window.devicePixelRatio || 1, 2),
      alpha: false,
      antialias: false,
    });
    const gl = renderer.gl;
    container.appendChild(gl.canvas);

    const program = new Program(gl, {
      vertex,
      fragment,
      uniforms: {
        uTime: { value: 0 },
        uResolution: { value: new Vec2(1, 1) },
        uMouse: { value: new Vec2(0.5, 0.5) },
        uColor: { value: new Color('#8b7cf6') },
        uBg: { value: new Color('#121218') },
      },
    });
    const mesh = new Mesh(gl, { geometry: new Triangle(gl), program });

    // Цвета из токенов темы (фон карты + accent), обновляются при смене темы.
    function syncThemeColors() {
      const [br, bg, bb] = readVarColor(container!, '--card', [0.07, 0.07, 0.094]);
      const [cr, cg, cb] = readVarColor(container!, '--primary', [0.545, 0.486, 0.965]);
      program.uniforms.uBg.value.set(br, bg, bb);
      program.uniforms.uColor.value.set(cr, cg, cb);
      renderer.render({ scene: mesh });
    }

    function resize() {
      const { clientWidth: w, clientHeight: h } = container!;
      renderer.setSize(w, h);
      program.uniforms.uResolution.value.set(w, h);
      renderer.render({ scene: mesh });
    }
    resize();
    syncThemeColors();
    window.addEventListener('resize', resize);

    // Перечитывать цвета при переключении темы (ThemeProvider меняет class на <html>)
    const themeObserver = new MutationObserver(syncThemeColors);
    themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });

    // курсор: целевая позиция (0..1 относительно карты) + сглаживание
    const target = new Vec2(0.5, 0.5);
    function onPointerMove(e: PointerEvent) {
      const rect = container!.getBoundingClientRect();
      target.set((e.clientX - rect.left) / rect.width, 1 - (e.clientY - rect.top) / rect.height);
    }

    let raf = 0;
    if (reduceMotion) {
      renderer.render({ scene: mesh });
    } else {
      window.addEventListener('pointermove', onPointerMove);
      const update = (t: number) => {
        raf = requestAnimationFrame(update);
        program.uniforms.uTime.value = t * 0.001;
        const mouse = program.uniforms.uMouse.value as Vec2;
        mouse.x += (target.x - mouse.x) * 0.05;
        mouse.y += (target.y - mouse.y) * 0.05;
        renderer.render({ scene: mesh });
      };
      raf = requestAnimationFrame(update);
    }

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', resize);
      window.removeEventListener('pointermove', onPointerMove);
      themeObserver.disconnect();
      gl.getExtension('WEBGL_lose_context')?.loseContext();
      if (gl.canvas.parentElement === container) container.removeChild(gl.canvas);
    };
  }, []);

  return <div ref={containerRef} className={className} aria-hidden="true" />;
}
