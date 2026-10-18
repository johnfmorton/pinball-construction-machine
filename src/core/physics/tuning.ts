/**
 * Every physics constant lives here so the tuning harness can expose it as a
 * slider. Units are SI (meters, kilograms, seconds, radians) unless noted.
 */
export interface Tuning {
  gravity: number;
  /** Overrides the table's slope when set >= 0 (degrees). -1 = use table. */
  slopeOverride: number;

  ballRadius: number;
  ballMass: number;
  /** Sliding friction between ball and playfield (skid → roll transition). */
  floorFriction: number;
  /** Rolling resistance as a fraction of normal force. */
  rollingResistance: number;
  /** Decay rate of spin about the vertical axis (1/s). */
  spinDamping: number;
  maxBallSpeed: number;

  /** Moment of inertia of flipper + linkage (kg·m²). */
  flipperInertia: number;
  /** Coil torque while the flipper is swinging up (N·m). */
  flipperCoilTorque: number;
  /** Weaker hold-coil torque once at the end-of-stroke (N·m). */
  flipperHoldTorque: number;
  /** Return spring torque when released (N·m). */
  flipperReturnTorque: number;
  /** Bounce off the end stops (0 = dead stop). */
  flipperStopBounce: number;

  bumperKick: number;
  /** Minimum normal impact speed that fires a slingshot (m/s). */
  slingThreshold: number;
  slingKick: number;
  /** Minimum normal impact speed that fires a pop bumper (m/s). */
  bumperThreshold: number;

  plungerMass: number;
  plungerSpring: number;
  /** Pull speed while the plunger button is held (m/s). */
  plungerPullSpeed: number;

  /** Velocity change applied to balls on a nudge (m/s). */
  nudgeStrength: number;
  /** Tilt meter: added per nudge; decays per second; tilt at threshold. */
  tiltPerNudge: number;
  tiltDecay: number;
  tiltWarning: number;
  tiltThreshold: number;

  /** Impacts slower than this are treated as resting contact (no bounce). */
  restingSpeed: number;
  /** Global multipliers applied on top of material presets. */
  elasticityScale: number;
  frictionScale: number;
}

export const DEFAULT_TUNING: Tuning = {
  gravity: 9.81,
  slopeOverride: -1,

  ballRadius: 0.0135,
  ballMass: 0.08,
  floorFriction: 0.15,
  rollingResistance: 0.008,
  spinDamping: 0.6,
  maxBallSpeed: 12,

  // Effective inertia includes the coil plunger and linkage, which is why it is
  // much larger than the bat alone. Stroke ≈ 30 ms, return ≈ 50 ms.
  flipperInertia: 1.5e-3,
  flipperCoilTorque: 3.6,
  flipperHoldTorque: 1.25,
  flipperReturnTorque: 1.1,
  flipperStopBounce: 0.25,

  bumperKick: 1.6,
  bumperThreshold: 0.15,
  slingThreshold: 0.35,
  slingKick: 1.4,

  plungerMass: 0.06,
  plungerSpring: 1100,
  plungerPullSpeed: 0.12,

  nudgeStrength: 0.18,
  tiltPerNudge: 1,
  tiltDecay: 0.6,
  tiltWarning: 2,
  tiltThreshold: 3.2,

  restingSpeed: 0.06,
  elasticityScale: 1,
  frictionScale: 1,
};

export interface TuningSpec {
  key: keyof Tuning;
  label: string;
  min: number;
  max: number;
  step: number;
  group: string;
}

/** Slider definitions for the tuning harness. */
export const TUNING_SPECS: TuningSpec[] = [
  { key: 'slopeOverride', label: 'Slope (°, -1 = table)', min: -1, max: 12, step: 0.1, group: 'Table' },
  { key: 'gravity', label: 'Gravity', min: 1, max: 20, step: 0.01, group: 'Table' },
  { key: 'ballMass', label: 'Ball mass (kg)', min: 0.02, max: 0.3, step: 0.001, group: 'Ball' },
  { key: 'floorFriction', label: 'Floor slide friction', min: 0, max: 0.6, step: 0.005, group: 'Ball' },
  { key: 'rollingResistance', label: 'Rolling resistance', min: 0, max: 0.05, step: 0.0005, group: 'Ball' },
  { key: 'spinDamping', label: 'Spin damping (1/s)', min: 0, max: 5, step: 0.05, group: 'Ball' },
  { key: 'flipperInertia', label: 'Flipper inertia (kg·m²)', min: 2e-4, max: 50e-4, step: 0.5e-5, group: 'Flippers' },
  { key: 'flipperCoilTorque', label: 'Coil torque (N·m)', min: 0.2, max: 10, step: 0.05, group: 'Flippers' },
  { key: 'flipperHoldTorque', label: 'Hold torque (N·m)', min: 0, max: 5, step: 0.05, group: 'Flippers' },
  { key: 'flipperReturnTorque', label: 'Return torque (N·m)', min: 0.05, max: 4, step: 0.05, group: 'Flippers' },
  { key: 'flipperStopBounce', label: 'End-stop bounce', min: 0, max: 0.8, step: 0.01, group: 'Flippers' },
  { key: 'bumperKick', label: 'Bumper kick (m/s)', min: 0, max: 4, step: 0.05, group: 'Kickers' },
  { key: 'bumperThreshold', label: 'Bumper threshold', min: 0, max: 1, step: 0.01, group: 'Kickers' },
  { key: 'slingKick', label: 'Sling kick (m/s)', min: 0, max: 4, step: 0.05, group: 'Kickers' },
  { key: 'slingThreshold', label: 'Sling threshold', min: 0, max: 2, step: 0.01, group: 'Kickers' },
  { key: 'plungerSpring', label: 'Plunger spring (N/m)', min: 100, max: 3000, step: 10, group: 'Plunger' },
  { key: 'plungerMass', label: 'Plunger mass (kg)', min: 0.01, max: 0.3, step: 0.005, group: 'Plunger' },
  { key: 'elasticityScale', label: 'Elasticity ×', min: 0.2, max: 1.5, step: 0.01, group: 'Materials' },
  { key: 'frictionScale', label: 'Friction ×', min: 0, max: 2, step: 0.01, group: 'Materials' },
  { key: 'restingSpeed', label: 'Resting speed', min: 0, max: 0.3, step: 0.005, group: 'Materials' },
  { key: 'nudgeStrength', label: 'Nudge (m/s)', min: 0, max: 0.6, step: 0.01, group: 'Nudge & tilt' },
  { key: 'tiltThreshold', label: 'Tilt threshold', min: 1, max: 10, step: 0.1, group: 'Nudge & tilt' },
];
