import { ALL_SLOTS } from '@/lib/convert/humanoid';
import type { HumanSlot } from '@/lib/convert/types';

/** "leftUpperArm" → "Left upper arm" (model's left). */
export const SLOT_LABEL: Record<string, string> = Object.fromEntries(
  ALL_SLOTS.map((s) => {
    const words = s.replace(/([A-Z])/g, ' $1').toLowerCase().trim();
    return [s, words[0].toUpperCase() + words.slice(1)];
  }),
);

/** Humanoid diagram rows: model's right on the viewer's left (the model faces you). */
export const DIAGRAM: (HumanSlot | null)[][] = [
  [null, 'head', null],
  ['rightEye', 'neck', 'leftEye'],
  ['rightShoulder', 'upperChest', 'leftShoulder'],
  ['rightUpperArm', 'chest', 'leftUpperArm'],
  ['rightLowerArm', 'spine', 'leftLowerArm'],
  ['rightHand', 'hips', 'leftHand'],
  ['rightUpperLeg', null, 'leftUpperLeg'],
  ['rightLowerLeg', null, 'leftLowerLeg'],
  ['rightFoot', null, 'leftFoot'],
  ['rightToes', null, 'leftToes'],
];

export const FINGER_ROWS: HumanSlot[] = ALL_SLOTS.filter((s) => /(Thumb|Index|Middle|Ring|Little)/.test(s));
