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

// Точечная сетка + рябь, расходящаяся от курсора (sin(dist - time) с затуханием).
// Фон прозрачный (рисуем только точки через alpha) — чтобы работало в светлой и тёмной теме.
const fragment = /* glsl */ `
  precision highp float;
  uniform float uTime;
  uniform vec2 uMouse;
  uniform vec2 uResolution;
  uniform vec3 uColor;
  varying vec2 vUv;

  void main() {
    float aspect = uResolution.x / uResolution.y;
    vec2 p = vUv; p.x *= aspect;
    vec2 m = uMouse; m.x *= aspect;

    // расстояние до курсора и бегущая волна
    float d = distance(p, m);
    float ripple = sin(d * 22.0 - uTime * 2.5) * exp(-d * 2.4);

    // сетка точек
    float cells = 30.0;
    vec2 gv = fract(vUv * cells) - 0.5;
    float dot = 1.0 - smoothstep(0.0, 0.16 + max(ripple, 0.0) * 0.18, length(gv));

    float alpha = dot * (0.14 + max(ripple, 0.0) * 0.9);
    gl_FragColor = vec4(uColor, clamp(alpha, 0.0, 1.0));
  }
`;

export function WaveBackground({ className = '' }: { className?: string }) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    const renderer = new Renderer({
      dpr: Math.min(window.devicePixelRatio || 1, 2),
      alpha: true,
      premultipliedAlpha: false,
      antialias: false,
    });
    const gl = renderer.gl;
    gl.clearColor(0, 0, 0, 0);
    container.appendChild(gl.canvas);

    const program = new Program(gl, {
      vertex,
      fragment,
      transparent: true,
      uniforms: {
        uTime: { value: 0 },
        uMouse: { value: new Vec2(0.5, 0.5) },
        uResolution: { value: new Vec2(1, 1) },
        uColor: { value: new Color('#8b7cf6') },
      },
    });
    const mesh = new Mesh(gl, { geometry: new Triangle(gl), program });

    function resize() {
      const { clientWidth: w, clientHeight: h } = container!;
      renderer.setSize(w, h);
      program.uniforms.uResolution.value.set(w, h);
      renderer.render({ scene: mesh });
    }
    resize();
    window.addEventListener('resize', resize);

    // целевая позиция курсора и сглаженная (инерция)
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
        const m = program.uniforms.uMouse.value as Vec2;
        m.x += (target.x - m.x) * 0.05;
        m.y += (target.y - m.y) * 0.05;
        renderer.render({ scene: mesh });
      };
      raf = requestAnimationFrame(update);
    }

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', resize);
      window.removeEventListener('pointermove', onPointerMove);
      gl.getExtension('WEBGL_lose_context')?.loseContext();
      if (gl.canvas.parentElement === container) container.removeChild(gl.canvas);
    };
  }, []);

  return <div ref={containerRef} className={className} aria-hidden="true" />;
}
