/**
 * The shared material kit. Every part draws from these few materials so the
 * table reads as one object and new parts don't need new look-dev.
 */
import * as THREE from 'three';
import type { Theme } from './themes.ts';

export interface MaterialKit {
  chrome: THREE.MeshStandardMaterial;
  steel: THREE.MeshStandardMaterial;
  ball: THREE.MeshStandardMaterial;
  rubber: THREE.MeshStandardMaterial;
  flipperRubber: THREE.MeshStandardMaterial;
  whitePlastic: THREE.MeshPhysicalMaterial;
  wall: THREE.MeshPhysicalMaterial;
  cabinet: THREE.MeshPhysicalMaterial;
  blackPlastic: THREE.MeshStandardMaterial;
  /** Painted translucent plastic (sling covers). Emissive is animated per part. */
  plastic: (color: string) => THREE.MeshPhysicalMaterial;
  /** A light insert or lamp: emissive intensity is animated per part. */
  lamp: (color: string) => THREE.MeshStandardMaterial;
  target: (color: string) => THREE.MeshStandardMaterial;
}

export function makeMaterials(theme: Theme): MaterialKit {
  const cache = new Map<string, THREE.Material>();
  const memo = <T extends THREE.Material>(key: string, make: () => T): T => {
    let m = cache.get(key) as T | undefined;
    if (!m) cache.set(key, (m = make()));
    return m;
  };
  return {
    chrome: new THREE.MeshStandardMaterial({ color: 0xffffff, metalness: 1, roughness: 0.12 }),
    steel: new THREE.MeshStandardMaterial({ color: 0xb8bec8, metalness: 1, roughness: 0.35 }),
    ball: new THREE.MeshStandardMaterial({ color: 0xffffff, metalness: 1, roughness: 0.05 }),
    rubber: new THREE.MeshStandardMaterial({ color: 0xf2efe6, metalness: 0, roughness: 0.75 }),
    flipperRubber: new THREE.MeshStandardMaterial({ color: 0xd8262b, metalness: 0, roughness: 0.6 }),
    whitePlastic: new THREE.MeshPhysicalMaterial({ color: 0xf6f3ea, roughness: 0.35, clearcoat: 0.6, clearcoatRoughness: 0.2 }),
    wall: new THREE.MeshPhysicalMaterial({ color: theme.wall, roughness: 0.55, clearcoat: 0.3, clearcoatRoughness: 0.4 }),
    cabinet: new THREE.MeshPhysicalMaterial({ color: theme.cabinet, roughness: 0.45, clearcoat: 0.8, clearcoatRoughness: 0.25 }),
    blackPlastic: new THREE.MeshStandardMaterial({ color: 0x111215, roughness: 0.4 }),
    plastic: (color) =>
      memo(`plastic:${color}`, () =>
        new THREE.MeshPhysicalMaterial({
          color,
          roughness: 0.25,
          clearcoat: 1,
          clearcoatRoughness: 0.1,
          emissive: new THREE.Color(color),
          emissiveIntensity: 0.25,
        }),
      ),
    lamp: (color) =>
      new THREE.MeshStandardMaterial({
        color: new THREE.Color(color).multiplyScalar(0.35),
        roughness: 0.3,
        emissive: new THREE.Color(color),
        emissiveIntensity: 0.15,
      }),
    target: (color) => memo(`target:${color}`, () => new THREE.MeshStandardMaterial({ color, roughness: 0.4 })),
  };
}
