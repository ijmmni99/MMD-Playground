import { AlertTriangle, Eye, EyeOff, Focus, ImageDown, Replace } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Button, IconButton, ToggleRow } from '@/components/ui/controls';
import { cn } from '@/components/ui/cn';
import { MaterialFlag } from '@/lib/convert/pmx/types';
import { imageSize } from '@/lib/model-edit/texture';
import { basename } from '@/lib/paths';
import { NameLabel } from '@/features/names/NameLabel';
import { me, useModelEditor, useOps } from '@/store/modelEditor';
import {
  downscaleTextures,
  endDrag,
  outfitState,
  patchMaterial,
  replaceTextureFile,
  setMaterialVisible,
  soloMaterial,
  textureBlob,
} from './actions';
import { ColorField, Notice, SubHead, TextField, ValueSlider } from './ui';

const FLAGS: [number, string][] = [
  [MaterialFlag.DoubleSided, 'Double-sided'],
  [MaterialFlag.GroundShadow, 'Ground shadow'],
  [MaterialFlag.DrawShadow, 'Casts shadow'],
  [MaterialFlag.ReceiveShadow, 'Receives shadow'],
  [MaterialFlag.Edge, 'Outline'],
];

export function MaterialsPanel() {
  const ops = useOps();
  const result = useModelEditor((s) => s.result);
  const modelId = useModelEditor((s) => s.modelId);
  const selected = useModelEditor((s) => s.material);
  const st = outfitState(ops);
  const hidden = new Set(st.hiddenMaterials);
  const pmx = result?.pmx;
  if (!pmx) return null;
  const solo =
    st.hiddenMaterials.length === pmx.materials.length - 1
      ? pmx.materials.findIndex((_, i) => !hidden.has(i))
      : -1;
  return (
    <div className="px-3 pb-4" data-testid="me-materials">
      <SubHead>Materials ({pmx.materials.length})</SubHead>
      <ul className="max-h-[38vh] overflow-y-auto rounded-md border border-line">
        {pmx.materials.map((m, i) => (
          <li
            key={i}
            className={cn(
              'flex items-center gap-1 px-1.5',
              selected === i && 'bg-accent-soft',
              result.hidden.includes(i) && 'opacity-50',
            )}
          >
            <span
              className="h-3 w-3 shrink-0 rounded-sm border border-line"
              style={{
                background: `rgb(${m.diffuse
                  .slice(0, 3)
                  .map((x) => Math.round(x * 255))
                  .join(',')})`,
              }}
            />
            <button
              type="button"
              className="min-w-0 flex-1 truncate py-1 text-left text-[12px] coarse:py-2.5"
              onClick={() => me.set({ material: i })}
              data-testid={`me-mat-${i}`}
            >
              <NameLabel modelId={modelId} kind="material" ja={m.name} />
            </button>
            <IconButton
              size="sm"
              label={hidden.has(i) ? 'Show' : 'Hide'}
              onClick={() => setMaterialVisible(i, hidden.has(i))}
            >
              {hidden.has(i) ? <EyeOff size={13} /> : <Eye size={13} />}
            </IconButton>
            <IconButton
              size="sm"
              label={solo === i ? 'Show all' : 'Solo'}
              active={solo === i}
              onClick={() => soloMaterial(solo === i ? null : i)}
            >
              <Focus size={13} />
            </IconButton>
          </li>
        ))}
      </ul>
      {selected !== null && pmx.materials[selected] && <MaterialFields index={selected} />}
      <TextureList />
    </div>
  );
}

function MaterialFields({ index }: { index: number }) {
  const result = useModelEditor((s) => s.result)!;
  const m = result.pmx.materials[index];
  const p = (patch: Parameters<typeof patchMaterial>[1], drag = false): void =>
    patchMaterial(index, patch, drag);
  return (
    <div data-testid="me-material-fields">
      <SubHead>{m.name}</SubHead>
      <ColorField
        label="Diffuse"
        value={m.diffuse}
        onChange={(rgb, drag) => p({ diffuse: [...rgb, m.diffuse[3]] }, drag)}
      />
      <ValueSlider
        label="Opacity"
        value={m.diffuse[3]}
        min={0}
        max={1}
        reset={1}
        onChange={(v, drag) => p({ diffuse: [m.diffuse[0], m.diffuse[1], m.diffuse[2], v] }, drag)}
        onCommit={endDrag}
      />
      <ColorField label="Specular" value={m.specular} onChange={(rgb, drag) => p({ specular: rgb }, drag)} />
      <ValueSlider
        label="Shininess"
        value={m.shininess}
        min={0}
        max={100}
        step={0.5}
        reset={5}
        precision={1}
        onChange={(v, drag) => p({ shininess: v }, drag)}
        onCommit={endDrag}
      />
      <ColorField label="Ambient" value={m.ambient} onChange={(rgb, drag) => p({ ambient: rgb }, drag)} />
      <ColorField
        label="Outline colour"
        value={m.edgeColor}
        onChange={(rgb, drag) => p({ edgeColor: [...rgb, m.edgeColor[3]] }, drag)}
      />
      <ValueSlider
        label="Outline size"
        value={m.edgeSize}
        min={0}
        max={5}
        step={0.05}
        reset={1}
        onChange={(v, drag) => p({ edgeSize: v }, drag)}
        onCommit={endDrag}
      />
      {FLAGS.map(([bit, label]) => (
        <ToggleRow
          key={bit}
          label={label}
          checked={(m.flags & bit) !== 0}
          onChange={(v) => p({ flags: v ? m.flags | bit : m.flags & ~bit })}
        />
      ))}
      <label className="flex items-center justify-between py-1 text-[12px] text-fg-muted">
        Sphere map
        <select
          className="input h-6 text-[12px] coarse:h-11"
          value={m.sphereMode}
          onChange={(e) => p({ sphereMode: Number(e.target.value) as 0 | 1 | 2 | 3 })}
        >
          <option value={0}>Off</option>
          <option value={1}>Multiply (sph)</option>
          <option value={2}>Add (spa)</option>
          <option value={3}>Sub-texture</option>
        </select>
      </label>
      <label className="flex items-center justify-between py-1 text-[12px] text-fg-muted">
        Toon
        <select
          className="input h-6 text-[12px] coarse:h-11"
          value={m.sharedToon}
          onChange={(e) => p({ sharedToon: Number(e.target.value) })}
        >
          <option value={-1}>{m.toon !== undefined && m.toon >= 0 ? 'Custom file' : 'None'}</option>
          {Array.from({ length: 10 }, (_, i) => (
            <option key={i} value={i}>
              toon{String(i + 1).padStart(2, '0')}
            </option>
          ))}
        </select>
      </label>
      <TextField
        label="Name (Japanese — the ID motions use)"
        value={m.name}
        onCommit={(v) => p({ name: v })}
      />
      <TextField label="English name" value={m.nameEn} onCommit={(v) => p({ nameEn: v })} />
      <TextField label="Memo" value={m.memo} onCommit={(v) => p({ memo: v })} multiline />
      <p className="text-[11px] text-fg-dim">
        Texture: {m.texture >= 0 ? result.pmx.textures[m.texture] : 'none'} · sphere:{' '}
        {m.sphere >= 0 ? result.pmx.textures[m.sphere] : 'none'}
      </p>
    </div>
  );
}

interface TexInfo {
  path: string;
  width: number;
  height: number;
  missing: boolean;
  url: string | null;
}

function TextureList() {
  const result = useModelEditor((s) => s.result)!;
  const [infos, setInfos] = useState<TexInfo[]>([]);
  const [view, setView] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const textures = result.pmx.textures;
  const users = useMemo(() => {
    const u = textures.map(() => 0);
    for (const m of result.pmx.materials) {
      if (m.texture >= 0) u[m.texture]++;
      if (m.sphere >= 0) u[m.sphere]++;
      if (m.toon !== undefined && m.toon >= 0) u[m.toon]++;
    }
    return u;
  }, [result, textures]);
  useEffect(() => {
    let alive = true;
    const urls: string[] = [];
    void (async () => {
      const out: TexInfo[] = [];
      for (const path of textures) {
        const blob = await textureBlob(path);
        const size = blob ? await imageSize(blob) : { width: 0, height: 0 };
        const url = blob && size.width ? URL.createObjectURL(blob) : null;
        if (url) urls.push(url);
        out.push({ path, ...size, missing: !blob, url });
      }
      if (alive) setInfos(out);
    })();
    return () => {
      alive = false;
      urls.forEach((u) => URL.revokeObjectURL(u));
    };
  }, [textures]);
  const big = infos.filter((t) => Math.max(t.width, t.height) > 2048).length;
  return (
    <div data-testid="me-textures">
      <SubHead
        actions={
          <div className="flex gap-1">
            {[2048, 1024].map((cap) => (
              <Button
                key={cap}
                size="sm"
                variant="ghost"
                disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  await downscaleTextures(cap);
                  setBusy(false);
                }}
              >
                <ImageDown size={13} /> ≤{cap}
              </Button>
            ))}
          </div>
        }
      >
        Textures ({textures.length})
      </SubHead>
      {big > 0 && (
        <Notice tone="warn">
          {big} texture(s) are larger than 2048 px — downscaling saves a lot of memory on phones.
        </Notice>
      )}
      <ul className="mt-1 space-y-1">
        {infos.map((t, i) => (
          <li key={t.path} className="flex items-center gap-2 rounded border border-line p-1">
            <button
              type="button"
              className="h-10 w-10 shrink-0 overflow-hidden rounded bg-bg-raised"
              onClick={() => setView(t.url)}
              aria-label={`View ${t.path}`}
            >
              {t.url ? <img src={t.url} alt="" className="h-full w-full object-cover" /> : null}
            </button>
            <div className="min-w-0 flex-1">
              <div className="truncate text-[12px]" title={t.path}>
                {basename(t.path)}
              </div>
              <div className="text-[11px] text-fg-dim">
                {t.missing ? (
                  <span className="text-warn">
                    <AlertTriangle size={11} className="inline" /> missing
                  </span>
                ) : t.width ? (
                  `${t.width}×${t.height}`
                ) : (
                  'not previewable'
                )}{' '}
                · {users[i]} material(s)
              </div>
            </div>
            <IconButton
              size="sm"
              label={`Replace ${basename(t.path)}`}
              onClick={() => void replaceTextureFile(t.path)}
            >
              <Replace size={13} />
            </IconButton>
          </li>
        ))}
      </ul>
      {view && (
        <button
          type="button"
          className="fixed inset-0 z-50 grid place-items-center bg-black/70 p-6"
          onClick={() => setView(null)}
          aria-label="Close preview"
        >
          <img
            src={view}
            alt="Texture preview"
            className="max-h-full max-w-full rounded shadow-lg [image-rendering:pixelated]"
          />
        </button>
      )}
    </div>
  );
}
