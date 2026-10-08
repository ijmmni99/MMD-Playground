// Writes the converter e2e fixtures (run with GEN_FIXTURES=1). Original procedural models only.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import JSZip from 'jszip';
import { it } from 'vitest';
import { makeHumanoid } from './fixture';
import { makeHumanoidFbx } from './fixtureFbx';
import { parseGlb } from './gltf';

const OUT = join(__dirname, '../../../e2e/fixtures/converter');

it.skipIf(!process.env.GEN_FIXTURES)('generate converter fixtures', async () => {
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, 'humanoid-vrm1.vrm'), makeHumanoid({ style: 'vrm', vrm: 1, name: 'Test VRM' }).bytes);
  writeFileSync(join(OUT, 'scrambled.glb'), makeHumanoid({ style: 'scrambled', name: 'Scrambled' }).bytes);
  // Mixamo-style FBX in a ZIP.
  const fbxZip = new JSZip();
  fbxZip.file('Character/character.fbx', makeHumanoidFbx({ name: 'Test FBX' }));
  writeFileSync(join(OUT, 'mixamo-fbx.zip'), await fbxZip.generateAsync({ type: 'uint8array' }));
  // glTF with an external .bin and texture in a ZIP.
  const { json, bin } = parseGlb(makeHumanoid({ style: 'blender', name: 'Test glTF' }).bytes);
  json.buffers[0].uri = 'humanoid.bin';
  const img = json.images[0];
  const view = json.bufferViews[img.bufferView];
  const png = bin!.subarray(view.byteOffset, view.byteOffset + view.byteLength);
  delete img.bufferView;
  delete img.mimeType;
  img.uri = 'textures/face_skin.png';
  const gz = new JSZip();
  gz.file('avatar/humanoid.gltf', JSON.stringify(json));
  gz.file('avatar/humanoid.bin', bin!);
  gz.file('avatar/textures/face_skin.png', png);
  writeFileSync(join(OUT, 'gltf-avatar.zip'), await gz.generateAsync({ type: 'uint8array' }));
});
