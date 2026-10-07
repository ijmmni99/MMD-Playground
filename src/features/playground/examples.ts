export interface Example {
  id: string;
  title: string;
  code: string;
}

export const EXAMPLES: Example[] = [
  {
    id: 'blink',
    title: 'Auto blink',
    code: `// Blink the selected model's eyes at random intervals.
const model = studio.model();
if (!model) throw new Error('Load a model first');
const blink = model.morphs.find((m) => ['まばたき', 'blink', 'Blink'].includes(m)) ?? model.morphs[0];
studio.log('Blinking with morph:', blink);

let t = 0;
let next = 1 + Math.random() * 3;
studio.onFrame((dt) => {
  t += dt;
  if (t > next) {
    // a blink lasts ~0.18 s: close then open
    const p = (t - next) / 0.18;
    model.setMorph(blink, p < 0.5 ? p * 2 : Math.max(0, 2 - p * 2));
    if (p >= 1) {
      t = 0;
      next = 1.5 + Math.random() * 3.5;
    }
  }
});
`,
  },
  {
    id: 'sequencer',
    title: 'Morph sequencer',
    code: `// Step through a list of facial expressions, cross-fading between them.
const model = studio.model();
if (!model) throw new Error('Load a model first');
const wanted = ['あ', 'い', 'う', 'え', 'お', '笑い', '眉上', 'まばたき'];
const steps = wanted.filter((m) => model.morphs.includes(m));
if (!steps.length) steps.push(...model.morphs.slice(0, 4));
studio.log('Sequence:', steps.join(' → '));

const hold = 0.6; // seconds per step
let time = 0;
studio.onFrame((dt) => {
  time += dt;
  const pos = time / hold;
  const i = Math.floor(pos) % steps.length;
  const f = pos % 1;
  for (const [k, name] of steps.entries()) {
    const w = k === i ? 1 - Math.max(0, f - 0.7) / 0.3 : k === (i + 1) % steps.length ? Math.max(0, f - 0.7) / 0.3 : 0;
    model.setMorph(name, w);
  }
});
`,
  },
  {
    id: 'orbit',
    title: 'Camera orbit',
    code: `// Slowly orbit the camera around the model while bobbing up and down.
studio.camera.setMode('orbit');
studio.camera.preset('front');
const radius = studio.camera.state.radius;
let angle = -90;
studio.onFrame((dt) => {
  angle += dt * 25; // degrees per second
  const beta = 80 + Math.sin((angle * Math.PI) / 180) * 8;
  studio.camera.orbit(angle, beta, radius);
});
`,
  },
  {
    id: 'wiggle',
    title: 'Bone wiggle',
    code: `// Procedurally wiggle the head and upper body (works best while paused).
const model = studio.model();
if (!model) throw new Error('Load a model first');
studio.pause();
const head = model.bones.find((b) => ['頭', 'head'].includes(b));
const upper = model.bones.find((b) => ['上半身', 'upper body'].includes(b));
let t = 0;
studio.onFrame((dt) => {
  t += dt;
  if (head) model.rotateBone(head, Math.sin(t * 3) * 12, Math.sin(t * 1.7) * 25, Math.cos(t * 2.3) * 8);
  if (upper) model.rotateBone(upper, 0, Math.sin(t * 1.2) * 15, Math.sin(t * 2.4) * 6);
});
studio.log('Press Stop to end; use “Reset to default” in the Pose section to restore.');
`,
  },
  {
    id: 'lights',
    title: 'Lighting color cycle',
    code: `// Cycle the key light through the hue wheel and sweep its direction.
const hsl = (h, s, l) => {
  const a = s * Math.min(l, 1 - l);
  const f = (n) => {
    const k = (n + h / 30) % 12;
    const c = l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
    return Math.round(c * 255).toString(16).padStart(2, '0');
  };
  return '#' + f(0) + f(8) + f(4);
};
studio.scene((s) => { s.postfx.bloom = true; s.postfx.bloomWeight = 0.4; });
let hue = 0;
studio.every(50, () => {
  hue = (hue + 3) % 360;
  studio.lights.set({ dirColor: hsl(hue, 0.8, 0.6), dirAzimuth: (hue % 360) - 180, ambientColor: hsl((hue + 180) % 360, 0.4, 0.7) });
});
`,
  },
];

export const DEFAULT_SCRIPT = `// Welcome to the MMD Studio playground!
// The global \`studio\` object controls the scene. Press Ctrl+Enter (or ▶ Run) to execute,
// ■ Stop to cancel onFrame/every/after callbacks. Pick an example from the menu above.

const model = studio.model();
studio.log('Models in scene:', studio.models.map((m) => m.name));
if (model) {
  studio.log(\`\${model.name}: \${model.morphs.length} morphs, \${model.bones.length} bones\`);
}
`;
