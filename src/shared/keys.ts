/**
 * Keyboard mapping for the table buttons, shared by the play page and the lab.
 * Several keys can drive one button; only real press/release transitions are sent.
 */
import type { InputKind } from '../core/sim/simulation.ts';

export const BUTTON_KEYS: Record<string, InputKind> = {
  KeyZ: 'flipperLeft',
  ShiftLeft: 'flipperLeft',
  ArrowLeft: 'flipperLeft',
  Slash: 'flipperRight',
  ShiftRight: 'flipperRight',
  ArrowRight: 'flipperRight',
  Enter: 'plunger',
  ArrowDown: 'plunger',
};

export const NUDGE_KEYS: Record<string, [number, number]> = {
  Space: [0, -1],
  KeyQ: [-1, 0],
  KeyE: [1, 0],
};

export class ButtonState {
  private held = new Set<string>();
  constructor(private send: (kind: InputKind, down: boolean) => void) {}

  /** Returns true if the key is a table button (caller should preventDefault). */
  key(code: string, down: boolean): boolean {
    const kind = BUTTON_KEYS[code];
    if (!kind) return false;
    const isDown = () => [...this.held].some((c) => BUTTON_KEYS[c] === kind);
    const before = isDown();
    if (down) this.held.add(code);
    else this.held.delete(code);
    const after = isDown();
    if (before !== after) this.send(kind, after);
    return true;
  }

  releaseAll(): void {
    for (const c of [...this.held]) this.key(c, false);
  }
}
