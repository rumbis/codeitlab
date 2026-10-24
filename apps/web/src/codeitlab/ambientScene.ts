/**
 * Ambient CodeitLab 3D. Loaded through a dynamic import so three.js stays out
 * of the main bundle; mounted only on pointer-fine, non-mobile screens and only
 * while visible.
 *
 * Performance contract (see docs/internals/web-ui.md and AGENTS.md):
 * - the loop is capped at `maxFps` (never free-running),
 * - it stops on `document.hidden` and while the canvas is offscreen,
 * - `prefers-reduced-motion` renders exactly one static frame,
 * - every geometry/material/renderer is disposed on unmount.
 */
import { observeResize } from "~/lib/observeResize";

export type AmbientVariant = "orb" | "rain" | "lattice";
export type AmbientQuality = "low" | "medium" | "high";

export interface AmbientSceneOptions {
  readonly variant: AmbientVariant;
  readonly quality: AmbientQuality;
  readonly maxFps: number;
  readonly respectReducedMotion: boolean;
  readonly colors: { readonly accent: string; readonly secondary: string };
}

const FALLBACK_ACCENT = "#3dff9e";
const FALLBACK_SECONDARY = "#22d3ee";

function colorOrDefault(value: string, fallback: string): string {
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : fallback;
}

function particleCount(quality: AmbientQuality): number {
  if (quality === "low") return 140;
  if (quality === "high") return 520;
  return 320;
}

function orbDetail(quality: AmbientQuality): number {
  return quality === "low" ? 1 : 2;
}

/**
 * Mounts the scene on an existing canvas. Resolves to a dispose function; if
 * the caller unmounts while the import is in flight it must call the dispose
 * function it receives afterwards.
 */
export async function mountAmbientScene(
  canvas: HTMLCanvasElement,
  options: AmbientSceneOptions,
): Promise<() => void> {
  const THREE = await import("three");

  const parent = canvas.parentElement ?? canvas;
  const accent = new THREE.Color(colorOrDefault(options.colors.accent, FALLBACK_ACCENT));
  const secondary = new THREE.Color(colorOrDefault(options.colors.secondary, FALLBACK_SECONDARY));

  const renderer = new THREE.WebGLRenderer({
    canvas,
    alpha: true,
    antialias: false,
    powerPreference: "low-power",
  });
  const maxPixelRatio = options.quality === "high" ? 2 : 1.5;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, maxPixelRatio));
  renderer.setClearColor(0x000000, 0);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 100);
  camera.position.set(0, 0, 6);

  const orbGeometry = new THREE.IcosahedronGeometry(
    options.variant === "lattice" ? 1.9 : 1.55,
    orbDetail(options.quality),
  );
  const wireframeGeometry =
    options.variant === "lattice"
      ? new THREE.WireframeGeometry(new THREE.BoxGeometry(3.4, 2.2, 2.2, 2, 2, 2))
      : new THREE.WireframeGeometry(orbGeometry);
  const lineMaterial = new THREE.LineBasicMaterial({
    color: accent,
    transparent: true,
    opacity: options.variant === "rain" ? 0.18 : 0.34,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const wireframe = new THREE.LineSegments(wireframeGeometry, lineMaterial);
  if (options.variant === "lattice") wireframe.rotation.set(0.5, 0.4, 0.1);
  scene.add(wireframe);

  const count = particleCount(options.quality);
  const positions = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);
  const speeds = new Float32Array(count);
  for (let index = 0; index < count; index += 1) {
    positions[index * 3] = (Math.random() - 0.5) * 9;
    positions[index * 3 + 1] = (Math.random() - 0.5) * 5.5;
    positions[index * 3 + 2] = (Math.random() - 0.5) * 4;
    const mixed = accent.clone().lerp(secondary, Math.random());
    colors[index * 3] = mixed.r;
    colors[index * 3 + 1] = mixed.g;
    colors[index * 3 + 2] = mixed.b;
    speeds[index] = 0.25 + Math.random() * 0.9;
  }
  const particleGeometry = new THREE.BufferGeometry();
  particleGeometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  particleGeometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  const particleMaterial = new THREE.PointsMaterial({
    size: options.quality === "low" ? 0.05 : 0.042,
    transparent: true,
    opacity: options.variant === "rain" ? 0.85 : 0.55,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    vertexColors: true,
    sizeAttenuation: true,
  });
  const particles = new THREE.Points(particleGeometry, particleMaterial);
  scene.add(particles);

  const reducedMotion =
    options.respectReducedMotion &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  let offscreen = false;
  let rafId = 0;
  let lastFrameAt = 0;
  const frameInterval = 1000 / Math.min(Math.max(options.maxFps, 15), 60);

  const renderOnce = () => {
    renderer.render(scene, camera);
  };

  const resize = () => {
    const width = parent.clientWidth;
    const height = parent.clientHeight;
    if (width === 0 || height === 0) return;
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    if (reducedMotion) renderOnce();
  };

  const update = (deltaSeconds: number) => {
    if (options.variant === "rain") {
      for (let index = 0; index < count; index += 1) {
        const positionIndex = index * 3 + 1;
        const y = (positions[positionIndex] ?? 0) - (speeds[index] ?? 0) * deltaSeconds * 2.4;
        positions[positionIndex] = y < -2.75 ? 2.75 : y;
      }
      particleGeometry.getAttribute("position").needsUpdate = true;
    }
    wireframe.rotation.y += deltaSeconds * (options.variant === "rain" ? 0.06 : 0.14);
    wireframe.rotation.x += deltaSeconds * 0.03;
    particles.rotation.y -= deltaSeconds * 0.02;
  };

  const tick = (now: number) => {
    rafId = requestAnimationFrame(tick);
    if (offscreen || document.hidden) return;
    if (now - lastFrameAt < frameInterval) return;
    const delta = Math.min((now - lastFrameAt) / 1000, 0.1);
    lastFrameAt = now;
    update(delta);
    renderer.render(scene, camera);
  };

  const onVisibilityChange = () => {
    if (document.hidden) {
      lastFrameAt = 0;
      return;
    }
    lastFrameAt = 0;
    if (reducedMotion) renderOnce();
  };

  const intersectionObserver =
    typeof IntersectionObserver === "function"
      ? new IntersectionObserver(
          (entries) => {
            const entry = entries[0];
            offscreen = entry ? !entry.isIntersecting : false;
          },
          { threshold: 0 },
        )
      : null;
  intersectionObserver?.observe(canvas);

  const stopResize = observeResize(parent, () => resize());
  document.addEventListener("visibilitychange", onVisibilityChange);

  resize();
  renderOnce();
  if (!reducedMotion) rafId = requestAnimationFrame(tick);

  return () => {
    cancelAnimationFrame(rafId);
    intersectionObserver?.disconnect();
    stopResize();
    document.removeEventListener("visibilitychange", onVisibilityChange);
    scene.remove(wireframe, particles);
    wireframeGeometry.dispose();
    orbGeometry.dispose();
    lineMaterial.dispose();
    particleGeometry.dispose();
    particleMaterial.dispose();
    renderer.dispose();
    renderer.forceContextLoss();
  };
}
