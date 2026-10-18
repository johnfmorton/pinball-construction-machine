/**
 * The stage: renderer, room, lighting, post-processing, and the player camera.
 *
 * Lighting is "dark arcade": the room is nearly black, the table is lit by
 * its own warm GI lamps, and inserts/bumpers glow through bloom.
 */
import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { DEG } from '../core/math/dmath.ts';
import type { Table3D } from './table3d.ts';

export type Quality = 'high' | 'medium' | 'low';

const QUALITY: Record<Quality, { pixelRatio: number; msaa: number; bloom: boolean; shadows: boolean }> = {
  high: { pixelRatio: 2, msaa: 4, bloom: true, shadows: true },
  medium: { pixelRatio: 1.5, msaa: 4, bloom: true, shadows: false },
  low: { pixelRatio: 1, msaa: 0, bloom: false, shadows: false },
};

export class Stage {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  private composer: EffectComposer;
  private bloom: UnrealBloomPass;
  private key: THREE.SpotLight;
  private fill: THREE.SpotLight;
  private hemi: THREE.HemisphereLight;
  private table: Table3D | null = null;
  /** The ball mirrors the lit playfield and lamps around it, not the dark room. */
  private ballEnv: THREE.Texture;
  quality: Quality = 'high';

  // camera rig
  private lookBase = new THREE.Vector3();
  private camBase = new THREE.Vector3();
  private look = new THREE.Vector3();
  private trauma = 0;
  private t = 0;

  constructor(private canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 0.95;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;

    this.scene.background = new THREE.Color(0x050608);
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = pmrem.fromScene(arcadeRoom(), 0.02).texture;
    this.ballEnv = pmrem.fromScene(ballWorld(), 0.01).texture;
    this.scene.environmentIntensity = 0.45;

    this.camera = new THREE.PerspectiveCamera(42, 1, 0.02, 20);

    // lights
    this.hemi = new THREE.HemisphereLight(0x8a9bc4, 0x0a0a0e, 0.35);
    this.scene.add(this.hemi);
    this.key = new THREE.SpotLight(0xffe0b8, 4.2, 4, 40 * DEG, 0.9, 1.4);
    this.key.shadow.mapSize.set(1024, 1024);
    this.key.shadow.bias = -0.0004;
    this.key.shadow.normalBias = 0.002;
    this.key.shadow.camera.near = 0.2;
    this.key.shadow.camera.far = 3;
    this.scene.add(this.key, this.key.target);
    this.fill = new THREE.SpotLight(0xffc47a, 1.4, 3, 60 * DEG, 0.95, 1.6);
    this.scene.add(this.fill, this.fill.target);
    // a dim floor so the cabinet isn't floating in a void
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(8, 8), new THREE.MeshStandardMaterial({ color: 0x0b0c10, roughness: 0.9 }));
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = -0.95;
    this.scene.add(floor);

    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    // Polished chrome reflecting a small light makes highlights hundreds of times
    // brighter than anything else; clamp them before bloom so a glint glows
    // instead of whiting out the screen.
    this.composer.addPass(new ShaderPass(CLAMP_SHADER));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.5, 0.2, 1.6);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());
    this.setQuality('high');
  }

  setTable(t: Table3D): void {
    if (this.table) this.scene.remove(this.table.group);
    this.table = t;
    t.mats.ball.envMap = this.ballEnv;
    t.mats.ball.envMapIntensity = 1;
    t.mats.ball.needsUpdate = true;
    const g = t.group;
    const { width: W, length: L, slope } = t.table.dimensions;
    g.rotation.x = slope * DEG; // far end up, flippers down toward the player
    g.position.set(-W / 2, 0, -L / 2);
    g.updateMatrixWorld(true);
    this.scene.add(g);

    // standing-player camera, defined in table space and converted to world
    this.camBase = g.localToWorld(new THREE.Vector3(W / 2, 0.64, L + 0.3));
    this.lookBase = g.localToWorld(new THREE.Vector3(W / 2, 0, L * 0.54));
    this.look.copy(this.lookBase);
    this.camera.position.copy(this.camBase);
    this.camera.lookAt(this.look);

    // Key: high above the player's head, so its reflection in the glossy
    // playfield bounces away from the camera instead of glaring into it.
    this.key.position.copy(g.localToWorld(new THREE.Vector3(W / 2, 1.3, L * 0.85)));
    this.key.target.position.copy(g.localToWorld(new THREE.Vector3(W / 2, 0, L * 0.45)));
    // Warm GI glow from under the backbox, low and soft.
    this.fill.position.copy(g.localToWorld(new THREE.Vector3(W / 2, 0.28, -0.12)));
    this.fill.target.position.copy(g.localToWorld(new THREE.Vector3(W / 2, 0, L * 0.5)));
  }

  setQuality(q: Quality): void {
    this.quality = q;
    const cfg = QUALITY[q];
    this.renderer.shadowMap.enabled = cfg.shadows;
    this.key.castShadow = cfg.shadows;
    this.bloom.enabled = cfg.bloom;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, cfg.pixelRatio));
    this.composer.setPixelRatio(Math.min(window.devicePixelRatio || 1, cfg.pixelRatio));
    this.composer.renderTarget1.samples = cfg.msaa;
    this.composer.renderTarget2.samples = cfg.msaa;
    // shadow maps must be recompiled into materials when toggled
    this.scene.traverse((o) => {
      const m = (o as THREE.Mesh).material as THREE.Material | THREE.Material[] | undefined;
      if (!m) return;
      for (const mm of Array.isArray(m) ? m : [m]) mm.needsUpdate = true;
    });
    this.resize();
  }

  resize(): void {
    const w = this.canvas.clientWidth;
    const h = this.canvas.clientHeight;
    if (!w || !h) return;
    this.renderer.setSize(w, h, false);
    this.composer.setSize(w, h);
    this.bloom.resolution.set(w / 2, h / 2);
    this.camera.aspect = w / h;
    // keep the whole table in view on narrow (portrait) windows
    this.camera.fov = w / h < 1 ? 47 + (1 - w / h) * 30 : 47;
    this.camera.updateProjectionMatrix();
  }

  /** Big hits shake the camera a little. */
  shake(amount: number): void {
    this.trauma = Math.min(1, this.trauma + amount);
  }

  setGI(level: number): void {
    this.key.intensity = 4.2 * level;
    this.fill.intensity = 1.4 * level;
  }

  render(dt: number): void {
    dt = Math.max(0, dt);
    this.t += dt;
    // gentle follow: ease the aim toward the ball, never far enough to lose the flippers
    const balls = this.table?.ballPositions() ?? [];
    const goal = this.lookBase.clone();
    if (balls.length) {
      const b = balls.reduce((a, v) => a.add(v), new THREE.Vector3()).multiplyScalar(1 / balls.length);
      goal.x += (b.x - this.lookBase.x) * 0.12;
      goal.z += (b.z - this.lookBase.z) * 0.16;
      goal.y += (b.y - this.lookBase.y) * 0.16;
    }
    this.look.lerp(goal, 1 - Math.exp(-dt * 2.5));
    const camGoal = this.camBase.clone();
    camGoal.x += (this.look.x - this.lookBase.x) * 0.35;
    this.camera.position.lerp(camGoal, 1 - Math.exp(-dt * 2));

    // shake: trauma² for a sharp onset and soft tail
    this.trauma = Math.min(1, Math.max(0, this.trauma - dt * 2.2));
    const s = this.trauma * this.trauma * 0.004;
    const shakeX = s * Math.sin(this.t * 71.3);
    const shakeY = s * Math.sin(this.t * 53.7 + 1.3);
    this.camera.position.x += shakeX;
    this.camera.position.y += shakeY;
    this.camera.lookAt(this.look);
    this.camera.position.x -= shakeX;
    this.camera.position.y -= shakeY;

    if (this.bloom.enabled || QUALITY[this.quality].msaa) this.composer.render(dt);
    else this.renderer.render(this.scene, this.camera);
  }
}

const CLAMP_SHADER = {
  uniforms: { tDiffuse: { value: null }, maxValue: { value: 6.0 } },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float maxValue;
    varying vec2 vUv;
    void main() {
      vec4 c = texture2D(tDiffuse, vUv);
      // guard against NaN/Inf as well as huge values
      c.rgb = clamp(c.rgb, vec3(0.0), vec3(maxValue));
      gl_FragColor = c;
    }`,
};

/**
 * Reflection environment for a dark arcade: a black room with a few dim
 * light strips, so chrome and clear coats pick up highlights rather than
 * reflecting a bright gray studio.
 */
function arcadeRoom(): THREE.Scene {
  const room = new THREE.Scene();
  room.background = new THREE.Color(0x020203);
  const strip = (color: number, intensity: number, w: number, h: number, pos: [number, number, number], rotX = 0, rotY = 0) => {
    const m = new THREE.Mesh(
      new THREE.PlaneGeometry(w, h),
      new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(intensity), side: THREE.DoubleSide }),
    );
    m.position.set(...pos);
    m.rotation.set(rotX, rotY, 0);
    room.add(m);
  };
  strip(0xfff1dd, 1.0, 1.6, 0.08, [0, 2.4, -0.5], Math.PI / 2); // ceiling tube
  strip(0xfff1dd, 0.8, 1.6, 0.08, [0, 2.4, 1.2], Math.PI / 2); // ceiling tube
  strip(0xff8a3d, 0.5, 0.6, 0.35, [-2.5, 1, 0], 0, Math.PI / 2); // a neighboring machine's glow
  strip(0x4f8bff, 0.4, 0.6, 0.35, [2.5, 1, 0.4], 0, -Math.PI / 2);
  strip(0xffffff, 0.15, 1.2, 0.6, [0, 0.8, 2.5]); // the player-side room behind you
  return room;
}

/**
 * What a ball "sees" on a lit table: a warm, bright playfield below, the
 * cabinet walls around, and lamps overhead. Used only for the ball's mirror.
 */
function ballWorld(): THREE.Scene {
  const w = new THREE.Scene();
  w.background = new THREE.Color(0x120d08);
  const panel = (color: number, k: number, size: [number, number], pos: [number, number, number], rot: [number, number, number]) => {
    const m = new THREE.Mesh(
      new THREE.PlaneGeometry(...size),
      new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(k), side: THREE.DoubleSide }),
    );
    m.position.set(...pos);
    m.rotation.set(...rot);
    w.add(m);
  };
  panel(0x8a6a48, 1.0, [6, 6], [0, -1, 0], [-Math.PI / 2, 0, 0]); // the lit playfield below
  panel(0x3a2a1c, 1.0, [6, 1], [0, 0, -2], [0, 0, 0]); // cabinet walls
  panel(0x3a2a1c, 1.0, [6, 1], [0, 0, 2], [0, Math.PI, 0]);
  panel(0xfff1dd, 4, [1.2, 0.15], [0, 2, 0.6], [Math.PI / 2, 0, 0]); // overhead lamps
  panel(0xffd9a8, 2.5, [0.5, 0.5], [0.8, 1.6, -0.8], [Math.PI / 2, 0, 0]);
  panel(0xff8a3d, 1.5, [0.6, 0.3], [-1.5, 0.4, -0.5], [0, Math.PI / 2, 0]);
  return w;
}
