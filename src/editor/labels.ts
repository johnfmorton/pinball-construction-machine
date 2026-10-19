import type { Part } from '../core/table/format.ts';

export const TYPE_LABELS: Record<Part['type'], string> = {
  wall: 'Wall',
  flipper: 'Flipper',
  post: 'Post',
  bumper: 'Pop bumper',
  slingshot: 'Slingshot',
  standupTarget: 'Standup target',
  dropTarget: 'Drop target',
  rollover: 'Rollover',
  gate: 'One-way gate',
  drain: 'Drain',
  plunger: 'Plunger',
  ballStart: 'Ball start',
};

export const TYPE_ORDER: Part['type'][] = [
  'flipper', 'slingshot', 'bumper', 'post', 'standupTarget', 'dropTarget', 'rollover', 'gate', 'wall', 'plunger', 'ballStart', 'drain',
];
