// The test humanoid as an ASCII FBX 7.4 file (centimetres, skin clusters, blend shapes, an embedded
// texture) — exercises the FBX path without shipping any third-party model.

import { humanoidData, type FixtureOptions } from './fixture';

const arr = (name: string, values: ArrayLike<number>, fmt = (v: number) => String(+v.toFixed(6))): string =>
  `\t\t${name}: *${values.length} {\n\t\t\ta: ${Array.from(values, fmt).join(',')}\n\t\t}\n`;

export function makeHumanoidFbx(opts: FixtureOptions = {}): Uint8Array {
  const d = humanoidData({ style: 'mixamo', ...opts });
  const CM = 100;
  const n = d.pos.length / 3;
  const tris = [...d.bodyIdx, ...d.headIdx];
  const triMat = [...d.bodyIdx.map(() => 0), ...d.headIdx.map(() => 1)].filter((_, i) => i % 3 === 0);
  const polyIdx = tris.map((v, i) => (i % 3 === 2 ? -v - 1 : v));
  const normals: number[] = [];
  for (const v of tris) normals.push(d.nrm[v * 3], d.nrm[v * 3 + 1], d.nrm[v * 3 + 2]);
  const uvs: number[] = [];
  for (let v = 0; v < n; v++) uvs.push(d.uv[v * 2], 1 - d.uv[v * 2 + 1]);
  const ID = { geo: 1000, mesh: 2000, bone: 3000, attr: 4000, mat: 5000, skin: 6000, cluster: 7000, morpher: 8000, channel: 8100, shape: 8200, video: 9000, texture: 9100 };
  const world = d.defs.map((b) => d.world(b.pos).map((x) => x * CM));
  // FBXLoader sniffs sparse character positions in the first ~200 bytes: keep them comment dashes.
  let o = `;${'-'.repeat(220)}\n; FBX 7.4.0 project file\nFBXHeaderExtension:  {\n\tFBXHeaderVersion: 1003\n\tFBXVersion: 7400\n\tCreator: "MMD Studio test humanoid"\n}\n`;
  o += `GlobalSettings:  {\n\tVersion: 1000\n\tProperties70:  {\n\t\tP: "UpAxis", "int", "Integer", "",1\n\t\tP: "UpAxisSign", "int", "Integer", "",1\n\t\tP: "FrontAxis", "int", "Integer", "",2\n\t\tP: "FrontAxisSign", "int", "Integer", "",1\n\t\tP: "CoordAxis", "int", "Integer", "",0\n\t\tP: "CoordAxisSign", "int", "Integer", "",1\n\t\tP: "UnitScaleFactor", "double", "Number", "",1\n\t}\n}\n`;
  o += 'Objects:  {\n';
  o += `\tGeometry: ${ID.geo}, "Geometry::Body", "Mesh" {\n`;
  o += arr('Vertices', d.pos.map((x) => x * CM));
  o += arr('PolygonVertexIndex', polyIdx);
  o += '\t\tGeometryVersion: 124\n';
  o += `\t\tLayerElementNormal: 0 {\n\t\t\tVersion: 101\n\t\t\tName: ""\n\t\t\tMappingInformationType: "ByPolygonVertex"\n\t\t\tReferenceInformationType: "Direct"\n${arr('Normals', normals).replace(/^\t\t/gm, '\t\t\t')}\t\t}\n`;
  o += `\t\tLayerElementUV: 0 {\n\t\t\tVersion: 101\n\t\t\tName: "UVMap"\n\t\t\tMappingInformationType: "ByPolygonVertex"\n\t\t\tReferenceInformationType: "IndexToDirect"\n${arr('UV', uvs).replace(/^\t\t/gm, '\t\t\t')}${arr('UVIndex', tris).replace(/^\t\t/gm, '\t\t\t')}\t\t}\n`;
  o += `\t\tLayerElementMaterial: 0 {\n\t\t\tVersion: 101\n\t\t\tName: ""\n\t\t\tMappingInformationType: "ByPolygon"\n\t\t\tReferenceInformationType: "IndexToDirect"\n${arr('Materials', triMat).replace(/^\t\t/gm, '\t\t\t')}\t\t}\n`;
  o += '\t\tLayer: 0 {\n\t\t\tVersion: 100\n';
  for (const t of ['LayerElementNormal', 'LayerElementUV', 'LayerElementMaterial'])
    o += `\t\t\tLayerElement:  {\n\t\t\t\tType: "${t}"\n\t\t\t\tTypedIndex: 0\n\t\t\t}\n`;
  o += '\t\t}\n\t}\n';
  // Blend shapes.
  d.morphs.forEach((m, k) => {
    const ids: number[] = [];
    const deltas: number[] = [];
    for (let v = 0; v < n; v++) {
      const x = m.deltas[v * 3];
      const y = m.deltas[v * 3 + 1];
      const z = m.deltas[v * 3 + 2];
      if (x || y || z) {
        ids.push(v);
        deltas.push(x * CM, y * CM, z * CM);
      }
    }
    o += `\tGeometry: ${ID.shape + k}, "Geometry::${m.name}", "Shape" {\n\t\tVersion: 100\n${arr('Indexes', ids)}${arr('Vertices', deltas)}\t}\n`;
    o += `\tDeformer: ${ID.channel + k}, "SubDeformer::${m.name}", "BlendShapeChannel" {\n\t\tVersion: 100\n\t\tDeformPercent: 0\n${arr('FullWeights', [100])}\t}\n`;
  });
  o += `\tDeformer: ${ID.morpher}, "Deformer::Morpher", "BlendShape" {\n\t\tVersion: 100\n\t}\n`;
  o += `\tModel: ${ID.mesh}, "Model::Body", "Mesh" {\n\t\tVersion: 232\n\t\tProperties70:  {\n\t\t}\n\t\tShading: T\n\t\tCulling: "CullingOff"\n\t}\n`;
  d.defs.forEach((b, i) => {
    const p = world[i];
    const pp = b.parent ? world[d.idx.get(b.parent)!] : [0, 0, 0];
    o += `\tNodeAttribute: ${ID.attr + i}, "NodeAttribute::", "LimbNode" {\n\t\tTypeFlags: "Skeleton"\n\t}\n`;
    o += `\tModel: ${ID.bone + i}, "Model::${d.names[i]}", "LimbNode" {\n\t\tVersion: 232\n\t\tProperties70:  {\n\t\t\tP: "Lcl Translation", "Lcl Translation", "", "A",${p[0] - pp[0]},${p[1] - pp[1]},${p[2] - pp[2]}\n\t\t}\n\t}\n`;
  });
  for (const [k, [name, color]] of [
    ['Body', [0.55, 0.7, 1]],
    ['Face', [1, 1, 1]],
  ].entries() as IterableIterator<[number, [string, number[]]]>)
    o += `\tMaterial: ${ID.mat + k}, "Material::${name}", "" {\n\t\tVersion: 102\n\t\tShadingModel: "phong"\n\t\tProperties70:  {\n\t\t\tP: "DiffuseColor", "Color", "", "A",${color.join(',')}\n\t\t}\n\t}\n`;
  o += `\tVideo: ${ID.video}, "Video::face_skin", "Clip" {\n\t\tType: "Clip"\n\t\tRelativeFilename: "face_skin.png"\n\t\tContent: "${btoa(String.fromCharCode(...d.png))}"\n\t}\n`;
  o += `\tTexture: ${ID.texture}, "Texture::face_skin", "" {\n\t\tType: "TextureVideoClip"\n\t\tVersion: 202\n\t\tTextureName: "Texture::face_skin"\n\t\tFileName: "face_skin.png"\n\t\tRelativeFilename: "face_skin.png"\n\t}\n`;
  o += `\tDeformer: ${ID.skin}, "Deformer::Skin", "Skin" {\n\t\tVersion: 101\n\t\tLink_DeformAcuracy: 50\n\t}\n`;
  d.defs.forEach((_, i) => {
    const ids: number[] = [];
    const ws: number[] = [];
    for (let v = 0; v < n; v++)
      for (let k = 0; k < 4; k++)
        if (d.joints[v * 4 + k] === i && d.weights[v * 4 + k] > 0) {
          ids.push(v);
          ws.push(d.weights[v * 4 + k]);
        }
    const p = world[i];
    o += `\tDeformer: ${ID.cluster + i}, "SubDeformer::Cluster ${d.names[i]}", "Cluster" {\n\t\tVersion: 100\n\t\tUserData: "", ""\n${arr('Indexes', ids)}${arr('Weights', ws)}${arr('Transform', [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, -p[0], -p[1], -p[2], 1])}${arr('TransformLink', [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, p[0], p[1], p[2], 1])}\t}\n`;
  });
  o += '}\nConnections:  {\n';
  const c = (a: number, b: number, prop?: string): void => void (o += `\tC: "${prop ? 'OP' : 'OO'}",${a},${b}${prop ? `, "${prop}"` : ''}\n`);
  c(ID.mesh, 0);
  c(ID.geo, ID.mesh);
  c(ID.mat, ID.mesh);
  c(ID.mat + 1, ID.mesh);
  d.defs.forEach((b, i) => {
    c(ID.bone + i, b.parent ? ID.bone + d.idx.get(b.parent)! : 0);
    c(ID.attr + i, ID.bone + i);
    c(ID.cluster + i, ID.skin);
    c(ID.bone + i, ID.cluster + i);
  });
  c(ID.skin, ID.geo);
  c(ID.morpher, ID.geo);
  d.morphs.forEach((_, k) => {
    c(ID.channel + k, ID.morpher);
    c(ID.shape + k, ID.channel + k);
  });
  c(ID.video, ID.texture);
  c(ID.texture, ID.mat + 1, 'DiffuseColor');
  o += '}\n';
  return new TextEncoder().encode(o);
}
