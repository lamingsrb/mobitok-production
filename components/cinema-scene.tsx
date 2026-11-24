"use client";

import { useEffect, useRef } from "react";
import type * as Three from "three";
import type { MotionValue } from "motion/react";

type CinemaSceneProps = {
  progress?: number;
  progressValue?: MotionValue<number>;
  className?: string;
  onReady?: () => void;
  onUnavailable?: () => void;
  paused?: boolean;
};

/** Original campaign sculpture. Decorative artwork, not a product specification. */
export default function CinemaScene({ progress = 0, progressValue, className, onReady, onUnavailable, paused = false }: CinemaSceneProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const propsRef = useRef({ progress, paused, onReady, onUnavailable });
  const invalidateRef = useRef<(() => void) | null>(null);
  const prepareRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    propsRef.current = { progress: progressValue?.get() ?? progress, paused, onReady, onUnavailable };
  }, [progress, progressValue, paused, onReady, onUnavailable]);

  useEffect(() => { invalidateRef.current?.(); prepareRef.current?.(); }, [paused]);

  useEffect(() => progressValue?.on("change", (value) => {
    propsRef.current.progress = value;
  }), [progressValue]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    let disposed = false;
    let cleanup = () => {};
    const motionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
    let inStartupView = false, starting = false, started = false, failed = false;
    let paintFrame = 0, idleHandle = 0, startupTimer = 0, compileTimer = 0;
    const allowedToStart = () => !disposed && inStartupView && document.visibilityState === "visible" &&
      !motionQuery.matches && !propsRef.current.paused;
    const cancelStart = () => {
      cancelAnimationFrame(paintFrame); paintFrame = 0;
      if (idleHandle) window.cancelIdleCallback(idleHandle);
      idleHandle = 0;
      window.clearTimeout(startupTimer); startupTimer = 0;
    };
    const showFallback = () => {
      const changed = host.dataset.sceneState !== "fallback";
      host.dataset.sceneState = "fallback";
      host.dataset.scenePlaying = "false";
      if (changed) propsRef.current.onUnavailable?.();
    };

    async function createScene() {
      const T = await import("three");
      // Preferences/visibility can change while the separate Three chunk downloads.
      if (!allowedToStart() || !host) return;
      started = true;
      const canvas = document.createElement("canvas");
      const gl = canvas.getContext("webgl2", { alpha: true, antialias: true, powerPreference: "low-power" });
      if (!gl) throw new Error("WebGL unavailable");
      const renderer = new T.WebGLRenderer({ canvas, context: gl, alpha: true, antialias: true });
      renderer.setClearColor(0x000000, 0);
      renderer.outputColorSpace = T.SRGBColorSpace;
      renderer.toneMapping = T.ACESFilmicToneMapping;
      renderer.toneMappingExposure = 1.16;
      canvas.style.cssText = "display:block;width:100%;height:100%;pointer-events:none";
      canvas.setAttribute("aria-hidden", "true");
      host.appendChild(canvas);
      cleanup = () => { renderer.dispose(); renderer.forceContextLoss(); canvas.remove(); };

      const scene = new T.Scene();
      const camera = new T.PerspectiveCamera(33, 1, 0.1, 50);
      const geometries = new Set<Three.BufferGeometry>();
      const materials = new Set<Three.Material>();
      const textures = new Set<Three.Texture>();
      let environment: Three.WebGLRenderTarget | undefined;
      cleanup = () => {
        geometries.forEach((geometry) => geometry.dispose());
        materials.forEach((material) => material.dispose());
        textures.forEach((texture) => texture.dispose());
        environment?.dispose(); scene.clear();
        renderer.dispose(); renderer.forceContextLoss(); canvas.remove();
      };
      const ownGeometry = <G extends Three.BufferGeometry>(g: G): G => { geometries.add(g); return g; };
      const ownMaterial = <M extends Three.Material>(m: M): M => { materials.add(m); return m; };
      const mesh = (geometry: Three.BufferGeometry, material: Three.Material, parent: Three.Object3D) => {
        ownGeometry(geometry); ownMaterial(material);
        const item = new T.Mesh(geometry, material);
        parent.add(item);
        return item;
      };

      // Broad studio cards reflected by the metal; generated locally, no HDR download.
      const studio = new T.Scene();
      studio.background = new T.Color(0x151824);
      const card = (color: number, intensity: number, width: number, height: number, x: number, y: number, z: number) => {
        const m = new T.MeshBasicMaterial({ color: new T.Color(color).multiplyScalar(intensity), side: T.DoubleSide });
        const p = mesh(new T.PlaneGeometry(width, height), m, studio);
        p.position.set(x, y, z);
        p.lookAt(0, 0, 0);
      };
      card(0xe3e3ff, 5, 5, 9, -4, 3, 3);
      card(0xf8ffef, 7, 3, 7, 4, 4, -2);
      card(0xa9f5f1, 3, 2, 6, 1, -1, 5);
      card(0xbba3ff, 5, 2, 9, -4, 1, -4);
      const pmrem = new T.PMREMGenerator(renderer);
      environment = pmrem.fromScene(studio, 0.08, 0.1, 40, { size: 128 });
      scene.environment = environment.texture;
      scene.environmentIntensity = 0.60;
      pmrem.dispose();

      const metal = ownMaterial(new T.MeshStandardMaterial({ color: 0x33353b, metalness: 0.84, roughness: 0.36 }));
      const graphite = ownMaterial(new T.MeshStandardMaterial({ color: 0x1b1e25, metalness: 0.44, roughness: 0.42 }));
      const ceramic = ownMaterial(new T.MeshPhysicalMaterial({ color: 0x20232b, metalness: 0.38, roughness: 0.39, clearcoat: 0.25, clearcoatRoughness: 0.35 }));
      const silver = ownMaterial(new T.MeshStandardMaterial({ color: 0x9fa3ae, metalness: 0.95, roughness: 0.22 }));
      const rubber = ownMaterial(new T.MeshStandardMaterial({ color: 0x080a0e, roughness: 0.84, metalness: 0.02 }));
      const stitch = ownMaterial(new T.MeshStandardMaterial({ color: 0x4e5156, roughness: 0.78, metalness: 0.05 }));
      const accent = ownMaterial(new T.MeshStandardMaterial({ color: 0xbbea6f, emissive: 0x99e747, emissiveIntensity: 1.4, roughness: 0.35, metalness: 0.25 }));

      // Tiny deterministic grain makes the cushions read as leather at close range.
      const grainSize = 128;
      const grainData = new Uint8Array(grainSize * grainSize * 4);
      let randomState = 918273;
      const random = () => { randomState = (Math.imul(randomState, 1664525) + 1013904223) | 0; return (randomState >>> 0) / 4294967296; };
      for (let i = 0; i < grainData.length; i += 4) {
        const value = 75 + Math.floor(random() * 110);
        grainData[i] = value; grainData[i + 1] = value; grainData[i + 2] = value; grainData[i + 3] = 255;
      }
      const grain = new T.DataTexture(grainData, grainSize, grainSize, T.RGBAFormat);
      grain.wrapS = grain.wrapT = T.RepeatWrapping;
      grain.repeat.set(8, 5);
      grain.needsUpdate = true;
      textures.add(grain);
      const leather = ownMaterial(new T.MeshStandardMaterial({ color: 0x202128, roughness: 0.8, metalness: 0.06, bumpMap: grain, bumpScale: 0.016 }));

      const model = new T.Group();
      scene.add(model);

      function roundedShape(width: number, height: number, radius: number) {
        const x = -width / 2, y = -height / 2;
        const shape = new T.Shape();
        shape.moveTo(x + radius, y);
        shape.lineTo(x + width - radius, y);
        shape.quadraticCurveTo(x + width, y, x + width, y + radius);
        shape.lineTo(x + width, y + height - radius);
        shape.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
        shape.lineTo(x + radius, y + height);
        shape.quadraticCurveTo(x, y + height, x, y + height - radius);
        shape.lineTo(x, y + radius);
        shape.quadraticCurveTo(x, y, x + radius, y);
        return shape;
      }

      function roundedExtrusion(width: number, height: number, radius: number, depth: number, bevel: number) {
        const geometry = new T.ExtrudeGeometry(roundedShape(width, height, radius), {
          depth, bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 8, curveSegments: 24, steps: 1,
        });
        // ExtrudeGeometry splits face vertices. Share their normals for a machined,
        // continuous fillet instead of visible polygon facets in studio reflections.
        const positions = geometry.getAttribute("position");
        const normals = geometry.getAttribute("normal");
        const smooth = new Map<string, Three.Vector3>();
        const keys: string[] = [];
        for (let i = 0; i < positions.count; i++) {
          const key = `${Math.round(positions.getX(i) * 10000)},${Math.round(positions.getY(i) * 10000)},${Math.round(positions.getZ(i) * 10000)}`;
          keys.push(key);
          const normal = new T.Vector3(normals.getX(i), normals.getY(i), normals.getZ(i));
          if (smooth.has(key)) smooth.get(key)!.add(normal);
          else smooth.set(key, normal);
        }
        smooth.forEach((normal) => normal.normalize());
        keys.forEach((key, i) => {
          const normal = smooth.get(key)!;
          normals.setXYZ(i, normal.x, normal.y, normal.z);
        });
        return geometry;
      }

      // An elliptical arch with a rounded rectangular cross section, not a round tube.
      function ribbon(rx: number, ry: number, radialWidth: number, depth: number, start: number, end: number) {
        const vertices: number[] = [], uvs: number[] = [], indices: number[] = [];
        const segments = 96, sides = 16;
        for (let i = 0; i <= segments; i++) {
          const t = start + i / segments * (end - start);
          for (let j = 0; j <= sides; j++) {
            const a = j / sides * Math.PI * 2;
            const radial = Math.sign(Math.cos(a)) * Math.pow(Math.abs(Math.cos(a)), 0.45) * radialWidth;
            const z = Math.sign(Math.sin(a)) * Math.pow(Math.abs(Math.sin(a)), 0.45) * depth;
            vertices.push((rx + radial) * Math.cos(t), (ry + radial) * Math.sin(t) - 0.1, z);
            uvs.push(i / segments, j / sides);
            if (i < segments && j < sides) {
              const v = i * (sides + 1) + j;
              indices.push(v, v + sides + 1, v + 1, v + 1, v + sides + 1, v + sides + 2);
            }
          }
        }
        const geometry = new T.BufferGeometry();
        geometry.setAttribute("position", new T.Float32BufferAttribute(vertices, 3));
        geometry.setAttribute("uv", new T.Float32BufferAttribute(uvs, 2));
        geometry.setIndex(indices);
        geometry.computeVertexNormals();
        return geometry;
      }

      mesh(ribbon(1.21, 1.49, 0.054, 0.245, 0.08, Math.PI - 0.08), graphite, model);
      mesh(ribbon(1.218, 1.50, 0.015, 0.224, 0.11, Math.PI - 0.11), metal, model);
      mesh(ribbon(1.135, 1.402, 0.064, 0.219, 0.29, Math.PI - 0.29), leather, model);
      const bandEdgeA = mesh(ribbon(1.214, 1.498, 0.011, 0.011, 0.16, Math.PI - 0.16), silver, model);
      bandEdgeA.position.z = 0.247;
      const bandEdgeB = bandEdgeA.clone();
      bandEdgeB.position.z = -0.247;
      model.add(bandEdgeB);

      function cushionGeometry() {
        const vertices: number[] = [], uvs: number[] = [], indices: number[] = [];
        const segments = 96, sides = 20;
        for (let i = 0; i <= segments; i++) {
          const t = i / segments * Math.PI * 2;
          const cx = Math.sign(Math.cos(t)) * Math.pow(Math.abs(Math.cos(t)), 0.72);
          const cy = Math.sign(Math.sin(t)) * Math.pow(Math.abs(Math.sin(t)), 0.72);
          for (let j = 0; j <= sides; j++) {
            const a = j / sides * Math.PI * 2;
            const wrinkle = Math.sin(t * 78) * Math.sin(t * 17 + 1) * 0.003;
            vertices.push((0.385 + (0.148 + wrinkle) * Math.cos(a)) * cx, (0.59 + (0.155 + wrinkle) * Math.cos(a)) * cy, 0.15 * Math.sin(a));
            uvs.push(i / segments, j / sides);
            if (i < segments && j < sides) {
              const v = i * (sides + 1) + j;
              indices.push(v, v + sides + 1, v + 1, v + 1, v + sides + 1, v + sides + 2);
            }
          }
        }
        const geometry = new T.BufferGeometry();
        geometry.setAttribute("position", new T.Float32BufferAttribute(vertices, 3));
        geometry.setAttribute("uv", new T.Float32BufferAttribute(uvs, 2));
        geometry.setIndex(indices);
        geometry.computeVertexNormals();
        return geometry;
      }

      const cushion = ownGeometry(cushionGeometry());
      const cups: Three.Group[] = [];
      for (const side of [-1, 1]) {
        const cup = new T.Group();
        cup.position.set(side * 1.17, -0.64, 0);
        cup.rotation.y = side * Math.PI / 2;
        cup.rotation.z = side * -0.06;
        model.add(cup);
        cups.push(cup);

        const shell = mesh(roundedExtrusion(0.99, 1.42, 0.43, 0.20, 0.08), graphite, cup);
        shell.position.z = -0.08;
        const bevel = mesh(roundedExtrusion(0.98, 1.40, 0.42, 0.014, 0.038), metal, cup);
        bevel.position.z = 0.172;
        const face = mesh(roundedExtrusion(0.88, 1.30, 0.39, 0.042, 0.052), ceramic, cup);
        face.position.z = 0.197;
        const ring = mesh(roundedExtrusion(0.98, 1.40, 0.42, 0.006, 0.012), rubber, cup);
        ring.position.z = -0.15;
        const pad = mesh(cushion, leather, cup);
        pad.position.z = -0.28;
        const inside = mesh(roundedExtrusion(0.68, 1.03, 0.31, 0.02, 0.04), rubber, cup);
        inside.position.z = -0.22;

        // Fine vent perforations, inset controls, and an original sculptural monogram.
        const ventGeometry = ownGeometry(new T.SphereGeometry(0.012, 6, 4));
        const vents = new T.InstancedMesh(ventGeometry, rubber, 9);
        const dummy = new T.Object3D();
        for (let v = 0; v < 9; v++) {
          dummy.position.set(-0.12 + v * 0.03, -0.34, 0.292);
          dummy.scale.set(1, 1, 0.4); dummy.updateMatrix();
          vents.setMatrixAt(v, dummy.matrix);
        }
        cup.add(vents);
        for (const sign of [-1, 1]) {
          const mark = mesh(roundedExtrusion(0.027, 0.215, 0.011, 0.006, 0.003), silver, cup);
          mark.position.set(sign * 0.04, 0.065, 0.296);
          mark.rotation.z = sign * -0.38;
        }
        const indicator = mesh(new T.CapsuleGeometry(0.014, 0.10, 3, 8), accent, cup);
        indicator.position.set(0, -0.44, 0.284);
        indicator.rotation.z = Math.PI / 2;
        const button = mesh(roundedExtrusion(0.045, 0.18, 0.022, 0.015, 0.008), metal, cup);
        button.position.set(0.475, -0.22, 0.06);
        button.rotation.y = Math.PI / 2;

        const stem = mesh(roundedExtrusion(0.17, 0.42, 0.065, 0.12, 0.028), metal, model);
        stem.rotation.y = side * Math.PI / 2;
        stem.position.set(side * 1.21, -0.14, -0.06);
        const pivot = mesh(new T.CylinderGeometry(0.105, 0.105, 0.075, 32), graphite, model);
        pivot.rotation.z = Math.PI / 2;
        pivot.position.set(side * 1.225, -0.365, 0);
        const pivotRing = mesh(new T.TorusGeometry(0.068, 0.008, 6, 32), silver, model);
        pivotRing.rotation.y = Math.PI / 2;
        pivotRing.position.set(side * 1.27, -0.365, 0);

        const seamPoints = Array.from({ length: 121 }, (_, i) => {
          const t = i / 120 * Math.PI * 2;
          return new T.Vector3(0.39 * Math.sign(Math.cos(t)) * Math.pow(Math.abs(Math.cos(t)), 0.72), 0.597 * Math.sign(Math.sin(t)) * Math.pow(Math.abs(Math.sin(t)), 0.72), -0.431);
        });
        mesh(new T.TubeGeometry(new T.CatmullRomCurve3(seamPoints, true), 120, 0.004, 4, true), stitch, cup);
      }

      const stage = new T.Group();
      scene.add(stage);
      const pedestalMaterial = ownMaterial(new T.MeshStandardMaterial({ color: 0x191923, metalness: 0.70, roughness: 0.38, transparent: true, opacity: 0.8 }));
      const pedestal = mesh(new T.CylinderGeometry(1.77, 1.87, 0.105, 96), pedestalMaterial, stage);
      pedestal.position.y = -1.80;
      const stageRim = mesh(new T.TorusGeometry(1.777, 0.007, 6, 128), accent, stage);
      stageRim.rotation.x = Math.PI / 2;
      stageRim.position.y = -1.743;

      const atmosphere = new T.Group();
      atmosphere.position.y = -0.05;
      scene.add(atmosphere);
      const arcMaterial = ownMaterial(new T.MeshBasicMaterial({ color: 0xc4f383, transparent: true, opacity: 0.55, depthWrite: false }));
      const arcGlow = ownMaterial(new T.MeshBasicMaterial({ color: 0xb2e9b4, transparent: true, opacity: 0.055, depthWrite: false, blending: T.AdditiveBlending }));
      for (let i = 0; i < 2; i++) {
        const points = Array.from({ length: 145 }, (_, step) => {
          const angle = step / 144 * Math.PI * (i === 0 ? 1.70 : 1.25) + i * 2.1;
          return new T.Vector3(Math.cos(angle) * (2.08 + i * 0.18), Math.sin(angle) * (2.08 + i * 0.18), 0);
        });
        const curve = new T.CatmullRomCurve3(points);
        const orbit = new T.Group();
        orbit.rotation.set(0.90 + i * 0.30, 0.30 - i * 0.6, -0.24 + i * 0.9);
        mesh(new T.TubeGeometry(curve, 144, 0.004, 4, false), arcMaterial, orbit);
        mesh(new T.TubeGeometry(curve, 144, 0.025, 5, false), arcGlow, orbit);
        atmosphere.add(orbit);
      }

      const dustGeometry = ownGeometry(new T.BufferGeometry());
      const dustVertices: number[] = [];
      for (let i = 0; i < 72; i++) {
        const theta = random() * Math.PI * 2;
        const radius = 2.10 + random() * 0.6;
        dustVertices.push(Math.cos(theta) * radius, (random() - 0.5) * 3.4, Math.sin(theta) * radius);
      }
      dustGeometry.setAttribute("position", new T.Float32BufferAttribute(dustVertices, 3));
      const dustMaterial = ownMaterial(new T.PointsMaterial({ color: 0xd2f1c3, size: 0.016, transparent: true, opacity: 0.52, sizeAttenuation: true, depthWrite: false }));
      const dust = new T.Points(dustGeometry, dustMaterial);
      atmosphere.add(dust);

      scene.add(new T.HemisphereLight(0xdae7ff, 0x423850, 2));
      const key = new T.DirectionalLight(0xffffff, 3.5);
      key.position.set(-3, 5, 4); scene.add(key);
      const rimLight = new T.DirectionalLight(0xb395ff, 3.5);
      rimLight.position.set(4, 2, -3); scene.add(rimLight);
      const fill = new T.DirectionalLight(0x9eeadd, 2.5);
      fill.position.set(1, -1, 4); scene.add(fill);
      const bottomLight = new T.PointLight(0xbbe878, 3.5, 7, 2);
      bottomLight.position.set(0, -1.4, 0.9); scene.add(bottomLight);

      // Parallel shader completion avoids the first model draw blocking on supported GPUs.
      // PMREM generation above is still synchronous; this does not promise a cheap software-GPU startup.
      if (renderer.extensions.has("KHR_parallel_shader_compile")) {
        try {
          await Promise.race([
            renderer.compileAsync(scene, camera),
            new Promise<never>((_, reject) => { compileTimer = window.setTimeout(() => reject(new Error("Scene shader startup timed out")), 8000); }),
          ]);
        } finally { window.clearTimeout(compileTimer); compileTimer = 0; }
        if (disposed) return;
      }
      const pointerQuery = window.matchMedia("(pointer: fine)");
      let reducedMotion = motionQuery.matches;
      let inView = inStartupView, contextLost = false, ready = false, frame = 0, previous = 0, time = 0;
      let smoothProgress = 0, width = 1, height = 1;
      let qualityLevel = 0;
      let performanceWarmupUntil = performance.now() + 1200;
      let performanceWindowStart = 0;
      let frameIntervals: number[] = [];
      const compactQuery = window.matchMedia("(max-width: 760px), (pointer: coarse)");
      const pointer = new T.Vector2();
      const smoothedPointer = new T.Vector2();
      const cameraTarget = new T.Vector3(0, -0.12, 0);
      const violet = new T.Color(0xb395ff), mint = new T.Color(0xadf8cf);
      const cyan = new T.Color(0x9eeadd), blush = new T.Color(0xf2b5e0);

      const resolutionFor = (level: number) => {
        const compact = compactQuery.matches;
        const cap = level === 0 ? (compact ? 1.25 : 1.5) : level === 1 ? (compact ? 0.75 : 1) : (compact ? 0.65 : 0.75);
        return Math.min(window.devicePixelRatio || 1, cap);
      };
      const resetPerformanceWindow = () => { frameIntervals = []; performanceWindowStart = 0; };
      const applyResolution = () => {
        const ratio = resolutionFor(qualityLevel);
        if (Math.abs(renderer.getPixelRatio() - ratio) > 0.001) renderer.setPixelRatio(ratio);
        renderer.setSize(width, height, false);
        host.dataset.sceneQuality = ["full", "balanced", "economy"][qualityLevel];
        host.dataset.sceneDpr = ratio.toFixed(2);
      };
      const assessPerformance = (stamp: number, interval: number) => {
        if (qualityLevel >= 2 || stamp < performanceWarmupUntil || interval <= 0) return;
        if (!performanceWindowStart) performanceWindowStart = stamp;
        frameIntervals.push(interval);
        if (frameIntervals.length > 48) frameIntervals.shift();
        // A single compilation hiccup or scroll task must not reduce quality.
        // Assess at least 16 visible frames spanning 2.4 seconds, using the median.
        if (frameIntervals.length < 16 || stamp - performanceWindowStart < 2400) return;
        const sorted = [...frameIntervals].sort((a, b) => a - b);
        const median = sorted[Math.floor(sorted.length / 2)];
        resetPerformanceWindow();
        if (median <= 48) return;
        let nextLevel = qualityLevel + 1;
        // DPR 1 screens already meet the desktop balanced cap: skip a no-op step.
        if (nextLevel < 2 && resolutionFor(nextLevel) >= renderer.getPixelRatio() - 0.01) nextLevel++;
        qualityLevel = nextLevel;
        applyResolution();
        performanceWarmupUntil = stamp + 900;
      };

      const draw = (delta: number) => {
        const progressTarget = reducedMotion ? 0 : Math.max(0, Math.min(1, propsRef.current.progress));
        const damping = 1 - Math.exp(-delta * 6);
        smoothProgress += (progressTarget - smoothProgress) * damping;
        smoothedPointer.lerp(pointer, 1 - Math.exp(-delta * 3));
        const p = smoothProgress;
        const moving = !reducedMotion;
        model.rotation.set(moving ? -0.11 + smoothedPointer.y * 0.10 + Math.sin(time * 0.24) * 0.018 : -0.11,
          0.54 + (moving ? time * 0.12 + smoothedPointer.x * 0.19 : 0),
          -0.12 + p * 0.17 + (moving ? Math.sin(time * 0.29) * 0.016 : 0));
        model.position.y = 0.055 + (moving ? Math.sin(time * 0.82) * 0.055 : 0) + p * 0.15;
        cups[0].rotation.z = 0.06 + p * 0.10;
        cups[1].rotation.z = -0.06 - p * 0.10;
        const aspect = width / height;
        const distance = aspect < 0.85 ? 9.15 : aspect < 1.1 ? 8.55 : 7.85;
        camera.position.set(Math.sin(p * 0.38) * 1.20, 0.60 + p * 0.68, distance - Math.sin(p * Math.PI) * 0.90);
        camera.lookAt(cameraTarget);
        atmosphere.rotation.y = moving ? time * 0.035 - p * 0.45 : 0;
        atmosphere.rotation.z = p * 0.12;
        dust.rotation.y = moving ? time * -0.045 : 0;
        rimLight.color.copy(violet).lerp(mint, p);
        fill.color.copy(cyan).lerp(blush, p);
        accent.emissiveIntensity = 1.2 + (moving ? (Math.sin(time * 1.5) + 1) * 0.16 : 0);
        renderer.render(scene, camera);
        if (!ready) {
          ready = true;
          host.dataset.sceneState = "ready";
          propsRef.current.onReady?.();
        }
      };

      const shouldAnimate = () => !disposed && !contextLost && inView && !document.hidden && !reducedMotion && !propsRef.current.paused;
      const tick = (stamp: number) => {
        frame = 0;
        if (!shouldAnimate()) return;
        const interval = previous ? stamp - previous : 0;
        if (interval) assessPerformance(stamp, interval);
        const delta = interval ? Math.min(interval / 1000, 0.04) : 1 / 60;
        previous = stamp;
        time += delta;
        draw(delta);
        frame = requestAnimationFrame(tick);
      };
      const invalidate = () => {
        if (disposed || contextLost) return;
        host.dataset.scenePlaying = String(shouldAnimate());
        if (!shouldAnimate()) {
          cancelAnimationFrame(frame); frame = 0; previous = 0;
          resetPerformanceWindow();
          if (inView && !document.hidden) draw(1 / 60);
        } else if (!frame) { previous = 0; frame = requestAnimationFrame(tick); }
      };
      invalidateRef.current = invalidate;
      const resize = () => {
        width = Math.max(host.clientWidth, 1); height = Math.max(host.clientHeight, 1);
        applyResolution();
        camera.aspect = width / height;
        camera.updateProjectionMatrix();
        if (!contextLost && inView && !document.hidden) draw(1 / 60);
      };
      const pointerMove = (event: PointerEvent) => {
        if (!pointerQuery.matches || reducedMotion || !inView) return;
        const bounds = host.getBoundingClientRect();
        pointer.set(T.MathUtils.clamp((event.clientX - bounds.left) / bounds.width * 2 - 1, -1, 1), T.MathUtils.clamp((event.clientY - bounds.top) / bounds.height * 2 - 1, -1, 1));
      };
      const resetPointer = () => pointer.set(0, 0);
      const motionChanged = () => { reducedMotion = motionQuery.matches; pointer.set(0, 0); invalidate(); };
      const lost = (event: Event) => {
        event.preventDefault(); contextLost = true; cancelAnimationFrame(frame); frame = 0;
        canvas.style.opacity = "0";
        host.dataset.sceneState = "fallback";
        host.dataset.scenePlaying = "false";
        propsRef.current.onUnavailable?.();
      };
      const restored = () => {
        contextLost = false; ready = false; resize(); canvas.style.opacity = "1";
        invalidate();
      };
      const resizeObserver = new ResizeObserver(resize);
      resizeObserver.observe(host);
      const observer = new IntersectionObserver(([entry]) => { inView = entry.isIntersecting; invalidate(); }, { rootMargin: "80px" });
      observer.observe(host);
      window.addEventListener("pointermove", pointerMove, { passive: true });
      window.addEventListener("blur", resetPointer);
      document.addEventListener("visibilitychange", invalidate);
      motionQuery.addEventListener("change", motionChanged);
      canvas.addEventListener("webglcontextlost", lost);
      canvas.addEventListener("webglcontextrestored", restored);

      cleanup = () => {
        cancelAnimationFrame(frame);
        invalidateRef.current = null;
        resizeObserver.disconnect(); observer.disconnect();
        window.removeEventListener("pointermove", pointerMove);
        window.removeEventListener("blur", resetPointer);
        document.removeEventListener("visibilitychange", invalidate);
        motionQuery.removeEventListener("change", motionChanged);
        canvas.removeEventListener("webglcontextlost", lost);
        canvas.removeEventListener("webglcontextrestored", restored);
        geometries.forEach((geometry) => geometry.dispose());
        materials.forEach((material) => material.dispose());
        textures.forEach((texture) => texture.dispose());
        environment?.dispose(); scene.clear(); studio.clear();
        renderer.dispose(); renderer.forceContextLoss(); canvas.remove();
      };
      resize();
      invalidate();
    }

    const prepare = () => {
      if (disposed || started || failed) return;
      if (!allowedToStart()) { cancelStart(); showFallback(); return; }
      if (starting) return;
      cancelStart();
      host.dataset.sceneState = "loading";
      const start = () => {
        idleHandle = 0; startupTimer = 0;
        if (!allowedToStart() || starting || started || failed) return;
        starting = true;
        void createScene().catch(() => {
          failed = true; cleanup();
          if (!disposed) showFallback();
        }).finally(() => {
          starting = false;
          if (!started && !failed && !disposed) prepare();
        });
      };
      // Keep the existing poster and shopping controls painted before optional GPU work.
      paintFrame = requestAnimationFrame(() => {
        paintFrame = requestAnimationFrame(() => {
          paintFrame = 0;
          if (!allowedToStart()) { showFallback(); return; }
          if (typeof window.requestIdleCallback === "function") idleHandle = window.requestIdleCallback(start, { timeout: 1500 });
          else startupTimer = window.setTimeout(start, 0);
        });
      });
    };
    prepareRef.current = prepare;
    if (typeof IntersectionObserver !== "function") {
      showFallback();
      return () => { disposed = true; prepareRef.current = null; };
    }
    const startupObserver = new IntersectionObserver(([entry]) => { inStartupView = entry.isIntersecting; prepare(); }, { rootMargin: "80px" });
    startupObserver.observe(host);
    document.addEventListener("visibilitychange", prepare);
    motionQuery.addEventListener("change", prepare);
    prepare();
    return () => {
      disposed = true; cancelStart(); window.clearTimeout(compileTimer); prepareRef.current = null;
      startupObserver.disconnect();
      document.removeEventListener("visibilitychange", prepare);
      motionQuery.removeEventListener("change", prepare);
      cleanup();
    };
  }, []);

  return <div ref={hostRef} className={className} data-scene-state="loading" data-scene-playing="false" data-scene-quality="full" aria-hidden="true" style={{ width: "100%", height: "100%" }} />;
}
