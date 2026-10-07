import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { MMDLoader } from 'three/examples/jsm/loaders/MMDLoader.js';
import { MMDAnimationHelper } from 'three/examples/jsm/animation/MMDAnimationHelper.js';

const app = document.getElementById('app');
const status = document.getElementById('status');
const setStatus = (t) => (status.textContent = t);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(devicePixelRatio);
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
app.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x1b1d24);
scene.add(new THREE.GridHelper(40, 40, 0x444a5a, 0x2a2e3a));
scene.add(new THREE.AmbientLight(0xffffff, 1.2));
const sun = new THREE.DirectionalLight(0xffffff, 1.8);
sun.position.set(-10, 20, 10);
sun.castShadow = true;
scene.add(sun);

const camera = new THREE.PerspectiveCamera(40, innerWidth / innerHeight, 0.1, 1000);
camera.position.set(0, 14, 35);
const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0, 10, 0);
controls.update();

const loader = new MMDLoader();
const helper = new MMDAnimationHelper({ afterglow: 2.0 });
const clock = new THREE.Clock();
let mesh = null;
let motion = null;
let playing = false;

// Map of dropped file names -> blob URLs so MMDLoader can resolve textures.
function makeManager(files) {
  const urls = new Map();
  for (const f of files) urls.set(f.name.toLowerCase(), URL.createObjectURL(f));
  const manager = new THREE.LoadingManager();
  manager.setURLModifier((url) => {
    const name = decodeURIComponent(url).split(/[\\/]/).pop().toLowerCase();
    return urls.get(name) ?? url;
  });
  return { manager, urls };
}

function attach() {
  if (!mesh) return;
  helper.remove(mesh);
  if (motion) helper.add(mesh, { animation: motion, physics: false });
  else helper.add(mesh, { physics: false });
}

document.getElementById('model').addEventListener('change', (e) => {
  const files = [...e.target.files];
  const main = files.find((f) => /\.(pmx|pmd)$/i.test(f.name));
  if (!main) return setStatus('No .pmx/.pmd selected.');
  const { manager, urls } = makeManager(files);
  const l = new MMDLoader(manager);
  setStatus('Loading model…');
  l.load(urls.get(main.name.toLowerCase()), (m) => {
    if (mesh) { helper.remove(mesh); scene.remove(mesh); }
    mesh = m;
    scene.add(mesh);
    attach();
    setStatus(`Loaded ${main.name}`);
  }, undefined, (err) => setStatus('Model error: ' + err.message));
});

document.getElementById('motion').addEventListener('change', (e) => {
  const f = e.target.files[0];
  if (!f) return;
  if (!mesh) return setStatus('Load a model first.');
  const url = URL.createObjectURL(f);
  setStatus('Loading motion…');
  loader.loadAnimation(url, mesh, (clip) => {
    motion = clip;
    attach();
    playing = true;
    setStatus(`Playing ${f.name}`);
  }, undefined, (err) => setStatus('Motion error: ' + err.message));
});

document.getElementById('play').onclick = () => (playing = true);
document.getElementById('pause').onclick = () => (playing = false);
document.getElementById('stop').onclick = () => { playing = false; attach(); };

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

renderer.setAnimationLoop(() => {
  const dt = clock.getDelta();
  if (playing) helper.update(dt);
  renderer.render(scene, camera);
});
