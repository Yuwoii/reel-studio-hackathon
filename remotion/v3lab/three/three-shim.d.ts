// Minimal typings for the subset of three@0.178.0 used by the v3lab proofs. Hand-written instead of adding
// @types/three (the R3 task allowed only @remotion/three, three and @react-three/fiber as new dependencies).
// If 3D is adopted in Phase B, replace this with @types/three pinned to the three version.
declare module "three" {
  export interface Vector3Like {
    x: number;
    y: number;
    z: number;
  }
  export class Vector3 implements Vector3Like {
    constructor(x?: number, y?: number, z?: number);
    x: number;
    y: number;
    z: number;
    set(x: number, y: number, z: number): this;
    clone(): Vector3;
    project(camera: Camera): this;
  }
  export class Euler {
    x: number;
    y: number;
    z: number;
    set(x: number, y: number, z: number): this;
  }
  export class Object3D {
    name: string;
    visible: boolean;
    position: Vector3;
    rotation: Euler;
    up: Vector3;
    children: Object3D[];
    userData: Record<string, unknown>;
    add(...o: Object3D[]): this;
    traverse(cb: (o: Object3D) => void): void;
    getObjectByName(name: string): Object3D | undefined;
    getWorldPosition(target: Vector3): Vector3;
    lookAt(x: number, y: number, z: number): void;
    updateMatrixWorld(force?: boolean): void;
    updateWorldMatrix(parents: boolean, children: boolean): void;
    clone(recursive?: boolean): this;
  }
  export class Group extends Object3D {}
  export class Light extends Object3D {
    intensity: number;
  }
  export class HemisphereLight extends Light {
    constructor(sky?: string, ground?: string, intensity?: number);
  }
  export class DirectionalLight extends Light {
    constructor(color?: string, intensity?: number);
  }
  export class Camera extends Object3D {}
  export class PerspectiveCamera extends Camera {
    constructor(fov?: number, aspect?: number, near?: number, far?: number);
    fov: number;
    aspect: number;
    updateProjectionMatrix(): void;
  }
  export class Material {
    name: string;
    userData: Record<string, unknown>;
    transparent: boolean;
    opacity: number;
  }
  export interface MeshStandardMaterialParameters {
    color?: string;
    emissive?: string;
    emissiveIntensity?: number;
    roughness?: number;
    metalness?: number;
    transparent?: boolean;
    opacity?: number;
    depthWrite?: boolean;
  }
  export class MeshStandardMaterial extends Material {
    constructor(p?: MeshStandardMaterialParameters);
    emissiveIntensity: number;
  }
  export class BufferGeometry {}
  export class CircleGeometry extends BufferGeometry {
    constructor(radius?: number, segments?: number);
  }
  export class Mesh extends Object3D {
    constructor(geometry?: BufferGeometry, material?: Material | Material[]);
    isMesh: boolean;
    material: Material | Material[];
  }
  export class Box3 {
    setFromObject(o: Object3D): this;
    getCenter(target: Vector3): Vector3;
  }
}

declare module "three/examples/jsm/loaders/GLTFLoader.js" {
  import type { Group } from "three";
  export interface GLTF {
    scene: Group;
  }
  export class GLTFLoader {
    loadAsync(url: string): Promise<GLTF>;
  }
}
