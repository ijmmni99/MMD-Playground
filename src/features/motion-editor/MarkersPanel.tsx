import { useState } from 'react';
import { Trash2 } from 'lucide-react';
import { framesPerBeat } from '@/lib/motion/timing';
import { engineOrNull } from '@/store/engineRef';
import { useMotionEditor, me } from '@/store/motionEditor';
import { addMarker, removeMarker, setGrid, tapTempo, updateMarker } from './directorActions';
import { Btn, Check, Num, Row, Section } from './panelUi';
import { playhead } from './view';

export default function MarkersPanel() {
  const markers = useMotionEditor((s) => s.markers);
  const grid = useMotionEditor((s) => s.grid);
  const snap = useMotionEditor((s) => s.snapToBeats);
  const [tapBpm, setTapBpm] = useState(0);

  return (
    <div className="flex flex-col" data-testid="me-markers-panel">
      <Section title="Tempo & beat grid">
        <Row>
          <Num
            label="BPM"
            value={grid.bpm}
            min={0}
            step={0.1}
            onChange={(bpm) => setGrid({ bpm: Math.max(0, bpm) })}
          />
          <Num
            label="Offset (frames)"
            value={grid.offset}
            step={0.5}
            onChange={(offset) => setGrid({ offset })}
          />
          <Num
            label="Beats/bar"
            value={grid.beatsPerBar}
            min={1}
            onChange={(b) => setGrid({ beatsPerBar: Math.max(1, Math.round(b)) })}
          />
        </Row>
        <div className="flex flex-wrap items-center gap-1">
          <Btn
            testid="bpm-tap"
            onClick={() => setTapBpm(tapTempo())}
            title="Tap along with the music (4+ taps)"
          >
            Tap tempo
          </Btn>
          <Btn onClick={() => setGrid({ offset: playhead() })} title="The current frame is a downbeat">
            Downbeat at playhead
          </Btn>
          {tapBpm > 0 && <span className="font-mono text-[11px] text-fg-muted">{tapBpm.toFixed(1)} BPM</span>}
        </div>
        <Check
          label="Snap keys to beats & markers"
          checked={snap}
          onChange={(v) => me.set({ snapToBeats: v })}
        />
        <p className="text-[11px] text-fg-dim">
          {grid.bpm > 0
            ? `${framesPerBeat(grid.bpm).toFixed(2)} frames per beat.`
            : 'Enter or tap a BPM to show the beat grid.'}{' '}
          No audio analysis — set it by ear.
        </p>
      </Section>

      <Section title="Markers">
        <Btn testid="marker-add" onClick={() => addMarker()}>
          Add marker at playhead
        </Btn>
        <ul className="flex flex-col gap-1" data-testid="marker-list">
          {markers.map((m) => (
            <li key={m.id} className="flex items-center gap-1 text-[11px]">
              <button
                type="button"
                className="w-12 shrink-0 text-left font-mono text-fg-muted hover:text-fg"
                onClick={() => engineOrNull()?.seek(m.f)}
                title="Go to marker"
              >
                {m.f}
              </button>
              <input
                aria-label="Marker name"
                className="input h-6 min-w-0 flex-1 px-1 text-[11px]"
                defaultValue={m.name}
                onBlur={(e) => e.target.value !== m.name && updateMarker(m.id, { name: e.target.value })}
              />
              <button
                type="button"
                className="p-1 text-fg-muted hover:text-fg"
                title="Move to playhead"
                onClick={() => updateMarker(m.id, { f: playhead() })}
              >
                ⟵
              </button>
              <button
                type="button"
                className="p-1 text-fg-muted hover:text-fg"
                title="Delete marker"
                onClick={() => removeMarker(m.id)}
              >
                <Trash2 size={12} />
              </button>
            </li>
          ))}
        </ul>
        {!markers.length && (
          <p className="text-[11px] text-fg-dim">
            Markers show on the ruler and act as snap points and shot boundaries.
          </p>
        )}
      </Section>
    </div>
  );
}
