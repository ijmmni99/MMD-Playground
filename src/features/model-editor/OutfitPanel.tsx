import { Eye, EyeOff, Image as ImageIcon, Palette, Shirt, Upload } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Button, ToggleRow } from '@/components/ui/controls';
import { cn } from '@/components/ui/cn';
import {
  BUILTIN_GROUPS,
  CLOTHING,
  GROUP_LABEL,
  guessGroup,
  materialGroups,
  outfitWarnings,
  type BuiltinGroup,
} from '@/lib/model-edit/outfit';
import { NO_RECOLOR, type Overlay, type Recolor } from '@/lib/model-edit/texture';
import { NameLabel } from '@/features/names/NameLabel';
import { me, useModelEditor, useOps } from '@/store/modelEditor';
import {
  addDonor,
  applyOutfitPreset,
  deleteOutfitPreset,
  donorModel,
  mergeClothes,
  mergeProblem,
  outfitState,
  patchMaterial,
  recolorTexture,
  saveOutfitPreset,
  setOutfit,
  uploadTexture,
} from './actions';
import { Chip, ColorField, Notice, SubHead, ValueSlider } from './ui';

const groupLabel = (g: string, custom: { id: string; label: string }[]): string =>
  GROUP_LABEL[g as BuiltinGroup] ?? custom.find((c) => c.id === g)?.label ?? g;

export function OutfitPanel() {
  const ops = useOps();
  const result = useModelEditor((s) => s.result);
  const modelId = useModelEditor((s) => s.modelId);
  const selected = useModelEditor((s) => s.material);
  const session = useModelEditor((s) => (s.modelId ? s.sessions[s.modelId] : undefined));
  const st = outfitState(ops);
  const pmx = result?.pmx;
  const groups = useMemo(() => (pmx ? materialGroups(pmx, st) : []), [pmx, st]);
  const warnings = useMemo(() => (pmx ? outfitWarnings(pmx, st) : []), [pmx, st]);
  const [newGroup, setNewGroup] = useState('');
  const [presetName, setPresetName] = useState('');
  if (!pmx) return null;
  const ids = [...BUILTIN_GROUPS, ...st.custom.map((c) => c.id)].filter(
    (g) => groups.includes(g) || st.custom.some((c) => c.id === g),
  );
  const hidden = new Set(st.hidden);
  const hiddenMats = new Set(st.hiddenMaterials);

  return (
    <div className="px-3 pb-4" data-testid="me-outfit">
      {warnings.map((w) => (
        <div key={w} className="pt-2">
          <Notice tone="warn" testid="me-hole-warning">
            {w}
          </Notice>
        </div>
      ))}
      <SubHead>Parts</SubHead>
      <div className="space-y-2">
        {ids.map((g) => {
          const mats = groups.map((x, i) => (x === g ? i : -1)).filter((i) => i >= 0);
          const off = hidden.has(g);
          return (
            <div key={g} className="rounded-md border border-line" data-testid={`me-group-${g}`}>
              <div className="flex items-center gap-1.5 px-2 py-1">
                <button
                  type="button"
                  aria-label={`${off ? 'Show' : 'Hide'} ${groupLabel(g, st.custom)}`}
                  data-testid={`me-toggle-${g}`}
                  aria-pressed={!off}
                  className="grid h-7 w-7 place-items-center rounded text-fg-muted hover:text-fg coarse:h-11 coarse:w-11"
                  onClick={() =>
                    setOutfit(
                      { hidden: off ? st.hidden.filter((x) => x !== g) : [...st.hidden, g] },
                      `${off ? 'Show' : 'Hide'} ${groupLabel(g, st.custom)}`,
                    )
                  }
                >
                  {off ? <EyeOff size={15} /> : <Eye size={15} />}
                </button>
                <span className={cn('flex-1 text-[13px] font-medium', off && 'text-fg-dim line-through')}>
                  {groupLabel(g, st.custom)}
                </span>
                <span className="text-[11px] text-fg-dim">{mats.length}</span>
              </div>
              {CLOTHING.has(g) && !off && (
                <div className="px-2">
                  <ToggleRow
                    label="Hide body under it"
                    checked={st.hideBodyUnder.includes(g)}
                    onChange={(v) =>
                      setOutfit(
                        {
                          hideBodyUnder: v
                            ? [...st.hideBodyUnder, g]
                            : st.hideBodyUnder.filter((x) => x !== g),
                        },
                        v ? 'Hide body under outfit' : 'Show body under outfit',
                      )
                    }
                  />
                </div>
              )}
              <ul className="border-t border-line">
                {mats.map((i) => (
                  <li
                    key={i}
                    className={cn(
                      'flex items-center gap-1.5 px-2 py-0.5 text-[12px]',
                      selected === i && 'bg-accent-soft',
                      hiddenMats.has(i) && 'opacity-50',
                    )}
                  >
                    <button
                      type="button"
                      className="min-w-0 flex-1 truncate py-1 text-left coarse:py-2.5"
                      onClick={() => me.set({ material: i })}
                      data-testid={`me-outfit-mat-${i}`}
                    >
                      <NameLabel modelId={modelId} kind="material" ja={pmx.materials[i].name} />
                    </button>
                    <select
                      aria-label={`Group for ${pmx.materials[i].name}`}
                      className="input h-6 max-w-[110px] text-[11px] coarse:h-10"
                      value={g}
                      onChange={(e) =>
                        setOutfit({ assign: { ...st.assign, [i]: e.target.value } }, 'Move to group')
                      }
                    >
                      {[...BUILTIN_GROUPS, ...st.custom.map((c) => c.id)].map((x) => (
                        <option key={x} value={x}>
                          {groupLabel(x, st.custom)}
                        </option>
                      ))}
                    </select>
                  </li>
                ))}
              </ul>
            </div>
          );
        })}
      </div>
      <div className="mt-2 flex gap-1.5">
        <input
          className="input h-7 min-w-0 flex-1 px-2 text-[12px] coarse:h-11"
          placeholder="New group name"
          aria-label="New group name"
          value={newGroup}
          onChange={(e) => setNewGroup(e.target.value)}
          onKeyDown={(e) => e.stopPropagation()}
        />
        <Button
          size="sm"
          disabled={!newGroup.trim()}
          onClick={() => {
            const id = `custom-${Date.now().toString(36)}`;
            setOutfit({ custom: [...st.custom, { id, label: newGroup.trim() }] }, 'New group');
            setNewGroup('');
          }}
        >
          Add group
        </Button>
      </div>

      <SubHead>Outfit presets</SubHead>
      <div className="flex flex-wrap gap-1.5">
        {session?.outfitPresets.map((p) => (
          <span key={p.name} className="flex items-center">
            <Chip onClick={() => applyOutfitPreset(p.name)} testid={`me-outfit-preset-${p.name}`}>
              {p.name}
            </Chip>
            <button
              type="button"
              aria-label={`Delete preset ${p.name}`}
              className="px-1 text-fg-dim hover:text-danger"
              onClick={() => deleteOutfitPreset(p.name)}
            >
              ×
            </button>
          </span>
        ))}
        {!session?.outfitPresets.length && (
          <span className="text-[12px] text-fg-dim">
            Save visibility, colours and textures to recall them with one tap.
          </span>
        )}
      </div>
      <div className="mt-1.5 flex gap-1.5">
        <input
          className="input h-7 min-w-0 flex-1 px-2 text-[12px] coarse:h-11"
          placeholder="Preset name"
          aria-label="Outfit preset name"
          value={presetName}
          onChange={(e) => setPresetName(e.target.value)}
          onKeyDown={(e) => e.stopPropagation()}
        />
        <Button
          size="sm"
          disabled={!presetName.trim()}
          onClick={() => {
            saveOutfitPreset(presetName.trim());
            setPresetName('');
          }}
        >
          Save preset
        </Button>
      </div>

      {selected !== null && pmx.materials[selected] && <Recolour index={selected} />}
      <ClothesSwap />
    </div>
  );
}

function Recolour({ index }: { index: number }) {
  const result = useModelEditor((s) => s.result);
  const modelId = useModelEditor((s) => s.modelId);
  const [rc, setRc] = useState<Recolor>(NO_RECOLOR);
  const [busy, setBusy] = useState(false);
  const [overlay, setOverlay] = useState<Overlay>({ u: 0.5, v: 0.5, size: 0.3, mode: 'over', opacity: 1 });
  const mat = result?.pmx.materials[index];
  if (!mat || !result) return null;
  const tex = mat.texture >= 0 ? result.pmx.textures[mat.texture] : null;
  return (
    <div data-testid="me-recolor">
      <SubHead>
        <span className="flex items-center gap-1">
          <Palette size={13} /> Colour · <NameLabel modelId={modelId} kind="material" ja={mat.name} />
        </span>
      </SubHead>
      <ColorField
        label="Colour (diffuse)"
        testid="me-diffuse"
        value={mat.diffuse}
        onChange={(rgb, drag) => patchMaterial(index, { diffuse: [...rgb, mat.diffuse[3]] }, drag)}
      />
      <ColorField
        label="Shade (ambient)"
        value={mat.ambient}
        onChange={(rgb, drag) => patchMaterial(index, { ambient: rgb }, drag)}
      />
      <SubHead>
        <span className="flex items-center gap-1">
          <ImageIcon size={13} /> Texture {tex ? `· ${tex}` : '(none)'}
        </span>
      </SubHead>
      {tex && (
        <>
          <ValueSlider
            label="Hue shift"
            value={rc.hue}
            min={-180}
            max={180}
            step={1}
            reset={0}
            precision={0}
            onChange={(v) => setRc({ ...rc, hue: v })}
          />
          <ValueSlider
            label="Saturation"
            value={rc.saturation}
            min={0}
            max={2}
            reset={1}
            onChange={(v) => setRc({ ...rc, saturation: v })}
          />
          <ValueSlider
            label="Brightness"
            value={rc.value}
            min={0}
            max={2}
            reset={1}
            onChange={(v) => setRc({ ...rc, value: v })}
          />
          <ColorField
            label="Tint colour"
            value={rc.tint ?? [1, 1, 1]}
            onChange={(rgb) => setRc({ ...rc, tint: rgb, tintAmount: rc.tintAmount || 0.5 })}
          />
          <ValueSlider
            label="Tint amount"
            value={rc.tintAmount ?? 0}
            min={0}
            max={1}
            reset={0}
            onChange={(v) => setRc({ ...rc, tintAmount: v })}
          />
          <Button
            size="sm"
            variant="primary"
            data-testid="me-recolor-apply"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              await recolorTexture(index, rc);
              setBusy(false);
              setRc(NO_RECOLOR);
            }}
          >
            Apply to texture (new file)
          </Button>
        </>
      )}
      <div className="mt-2 flex flex-wrap gap-1.5">
        <Button size="sm" onClick={() => void uploadTexture(index)} data-testid="me-upload-texture">
          <Upload size={13} /> Replace with image…
        </Button>
        <Button size="sm" onClick={() => void uploadTexture(index, overlay)}>
          <Upload size={13} /> Add logo / pattern…
        </Button>
      </div>
      <div className="mt-1 grid grid-cols-2 gap-x-2">
        <label className="text-[11px] text-fg-muted">
          Mode
          <select
            className="input h-7 w-full text-[12px] coarse:h-11"
            value={overlay.mode}
            onChange={(e) => setOverlay({ ...overlay, mode: e.target.value as Overlay['mode'] })}
          >
            <option value="over">Logo (on top)</option>
            <option value="tile">Pattern (tiled)</option>
          </select>
        </label>
        <ValueSlider
          label="Logo size"
          value={overlay.size}
          min={0.05}
          max={1}
          reset={0.3}
          onChange={(v) => setOverlay({ ...overlay, size: v })}
        />
        <ValueSlider
          label="Position U"
          value={overlay.u}
          min={0}
          max={1}
          reset={0.5}
          onChange={(v) => setOverlay({ ...overlay, u: v })}
        />
        <ValueSlider
          label="Position V"
          value={overlay.v}
          min={0}
          max={1}
          reset={0.5}
          onChange={(v) => setOverlay({ ...overlay, v: v })}
        />
      </div>
      <p className="text-[11px] text-fg-dim">
        Original textures are never changed; new images are saved with the project and the PMX ZIP.
      </p>
    </div>
  );
}

function ClothesSwap() {
  const session = useModelEditor((s) => (s.modelId ? s.sessions[s.modelId] : undefined));
  const [donor, setDonor] = useState<string | null>(null);
  const [picked, setPicked] = useState<number[]>([]);
  const [hideReplaced, setHideReplaced] = useState(true);
  const [ack, setAck] = useState(false);
  const [busy, setBusy] = useState(false);
  const donors = Object.values(session?.donors ?? {});
  const dm = donor ? donorModel(donor) : null;
  const problem = donor && picked.length ? mergeProblem(donor, picked) : null;
  return (
    <div data-testid="me-swap">
      <SubHead>
        <span className="flex items-center gap-1">
          <Shirt size={13} /> Clothes from another model
        </span>
      </SubHead>
      <p className="text-[12px] text-fg-muted">
        Move clothes between models with the same MMD skeleton. Bones are matched by name; there is no weight
        transfer.
      </p>
      <div className="mt-1.5 flex flex-wrap gap-1.5">
        {donors.map((d) => (
          <Chip key={d.id} active={donor === d.id} onClick={() => (setDonor(d.id), setPicked([]))}>
            {d.label}
          </Chip>
        ))}
        <Button
          size="sm"
          data-testid="me-load-donor"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            try {
              const id = await addDonor();
              if (id) {
                setDonor(id);
                setPicked([]);
              }
            } finally {
              setBusy(false);
            }
          }}
        >
          <Upload size={13} /> Load model…
        </Button>
      </div>
      {dm && (
        <div className="mt-2 rounded-md border border-line p-2" data-testid="me-donor">
          <ul className="max-h-48 overflow-y-auto">
            {dm.materials.map((m, i) => (
              <li key={i}>
                <label className="flex items-center gap-2 py-0.5 text-[12px] coarse:py-2">
                  <input
                    type="checkbox"
                    data-testid={`me-donor-mat-${i}`}
                    checked={picked.includes(i)}
                    onChange={(e) =>
                      setPicked(e.target.checked ? [...picked, i] : picked.filter((x) => x !== i))
                    }
                  />
                  <span className="min-w-0 flex-1 truncate">{m.name}</span>
                  <span className="text-[11px] text-fg-dim">{GROUP_LABEL[guessGroup(m.name, m.nameEn)]}</span>
                </label>
              </li>
            ))}
          </ul>
          {problem && (
            <Notice tone="warn" testid="me-merge-problem">
              {problem}
            </Notice>
          )}
          <ToggleRow
            label="Hide the clothes they replace"
            checked={hideReplaced}
            onChange={setHideReplaced}
          />
          <label className="flex items-start gap-2 py-1 text-[12px] text-fg-muted">
            <input
              type="checkbox"
              checked={ack}
              onChange={(e) => setAck(e.target.checked)}
              data-testid="me-license-ack"
            />
            <span>
              I may use parts of this model: both models’ licenses allow modification (the source is noted in
              the README).
            </span>
          </label>
          <Button
            variant="primary"
            size="sm"
            data-testid="me-merge"
            disabled={!picked.length || !!problem || !ack}
            onClick={() => {
              mergeClothes(donor!, picked, hideReplaced);
              setPicked([]);
            }}
          >
            Add selected clothes
          </Button>
        </div>
      )}
    </div>
  );
}
