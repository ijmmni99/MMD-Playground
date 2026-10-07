export interface VmdSummary {
  boneKeyCount: number;
  morphKeyCount: number;
  cameraKeyCount: number;
  isCamera: boolean;
}

const HEADER = 30;
const MODEL_NAME = 20;
const BONE_KEY = 111;
const MORPH_KEY = 23;

/** Inspect the section counts of a VMD buffer without fully parsing it. */
export function summarizeVmd(buffer: ArrayBuffer): VmdSummary {
  const view = new DataView(buffer);
  const sig = new TextDecoder('ascii').decode(new Uint8Array(buffer, 0, Math.min(25, buffer.byteLength)));
  if (!sig.startsWith('Vocaloid Motion Data')) throw new Error('Not a VMD file');
  let o = HEADER + MODEL_NAME;
  const read = (): number => {
    if (o + 4 > buffer.byteLength) return 0;
    const v = view.getUint32(o, true);
    o += 4;
    return v;
  };
  const boneKeyCount = read();
  o += boneKeyCount * BONE_KEY;
  const morphKeyCount = read();
  o += morphKeyCount * MORPH_KEY;
  const cameraKeyCount = read();
  return {
    boneKeyCount,
    morphKeyCount,
    cameraKeyCount,
    isCamera: cameraKeyCount > 0 && boneKeyCount === 0 && morphKeyCount === 0,
  };
}
