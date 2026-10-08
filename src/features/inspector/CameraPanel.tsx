import { useNameText } from '@/features/names/text';
import { Button, Row, Section, Select, SliderRow } from '@/components/ui/controls';
import type { CameraMode, CameraPreset } from '@/engine/types';
import { cameraPreset, focusSelected, setCameraMode, setFollow, setFov } from '@/store/actions';
import { useStudio } from '@/store/studio';

const PRESETS: { id: CameraPreset; label: string }[] = [
  { id: 'front', label: 'Front' },
  { id: 'back', label: 'Back' },
  { id: 'left', label: 'Left' },
  { id: 'right', label: 'Right' },
  { id: 'face', label: 'Close-up face' },
  { id: 'full', label: 'Full body ¾' },
];

const FOLLOW_BONES = ['センター', '上半身', '頭', '下半身', '全ての親'];

export function CameraPanel() {
  const camera = useStudio((s) => s.camera);
  const hasCamMotion = useStudio((s) => s.cameraMotion !== null);
  const model = useStudio((s) => s.models.find((m) => m.id === s.selectedModelId) ?? null);
  const nameText = useNameText(model?.id);
  const followBones = model
    ? model.info.bones.filter((b) => FOLLOW_BONES.includes(b.name)).map((b) => b.name)
    : [];
  return (
    <div>
      <Section title="Camera">
        <Select<CameraMode>
          label="Mode"
          value={camera.mode}
          onChange={setCameraMode}
          options={[
            { value: 'orbit', label: 'Orbit (manual)' },
            { value: 'fly', label: 'Free-fly (WASD)' },
            ...(hasCamMotion ? [{ value: 'vmd' as const, label: 'Camera VMD' }] : []),
          ]}
        />
        {!hasCamMotion && (
          <p className="mb-1 text-[11px] text-fg-dim">Drop a camera VMD to enable motion camera playback.</p>
        )}
        <SliderRow
          label="Field of view"
          value={camera.fov}
          min={10}
          max={100}
          step={1}
          format={(v) => `${Math.round(v)}°`}
          onChange={setFov}
          disabled={camera.mode === 'vmd'}
        />
        {camera.mode === 'vmd' && (
          <p className="text-[11px] text-fg-dim">FOV is driven by the camera motion.</p>
        )}
      </Section>
      <Section title="Presets">
        <div className="grid grid-cols-2 gap-1.5">
          {PRESETS.map((p) => (
            <Button key={p.id} size="sm" onClick={() => cameraPreset(p.id)}>
              {p.label}
            </Button>
          ))}
          <Button size="sm" onClick={focusSelected}>
            Focus model (F)
          </Button>
        </div>
      </Section>
      <Section title="Follow bone">
        {!model ? (
          <p className="text-[12px] text-fg-dim">Select a model to follow one of its bones.</p>
        ) : (
          <>
            <Row label="Bone">
              <select
                aria-label="Bone to follow"
                className="input h-6 max-w-[150px]"
                value={camera.follow?.modelId === model.id ? camera.follow.bone : ''}
                onChange={(e) =>
                  setFollow(e.target.value ? { modelId: model.id, bone: e.target.value } : null)
                }
              >
                <option value="">Off</option>
                {(followBones.length ? followBones : model.info.bones.slice(0, 50).map((b) => b.name)).map(
                  (n) => (
                    <option key={n} value={n}>
                      {nameText('bone', n)}
                    </option>
                  ),
                )}
              </select>
            </Row>
            <p className="text-[11px] text-fg-dim">
              The orbit camera target smoothly tracks the bone while you orbit/zoom freely.
            </p>
          </>
        )}
      </Section>
    </div>
  );
}
