"use client";

import { OrbitControls, Stars } from "@react-three/drei";
import { Canvas, useFrame, useThree, type ThreeEvent } from "@react-three/fiber";
import { useEffect, useLayoutEffect, useMemo, useRef, type RefObject } from "react";
import * as THREE from "three";
import { fileCount } from "@/lib/languages";
import type { Galaxy, GalaxyNode } from "@/lib/layout";

export interface GalaxyProps {
  galaxy: Galaxy;
  /** False for the decorative backdrop: no picking, no labels. */
  interactive: boolean;
  selected: number | null;
  hovered: number | null;
  /** When set, every other body is dimmed. */
  highlight: Set<number> | null;
  /** Ask the camera to fly to a body, or to the overview when id is -1. `tick` changes on every request. */
  focus: { id: number; tick: number } | null;
  reducedMotion: boolean;
  onHover: (id: number | null) => void;
  onSelect: (id: number | null) => void;
}

const NIGHT = new THREE.Color("#0B1026");
const FOLDER = new THREE.Color("#F3E9CF");
const BRASS = "#E0B15A";

/** A soft round sprite, drawn once, used for every glow. */
function useGlowTexture() {
  return useMemo(() => {
    const size = 128;
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = size;
    const ctx = canvas.getContext("2d")!;
    const gradient = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    gradient.addColorStop(0, "rgba(255,255,255,1)");
    gradient.addColorStop(0.25, "rgba(255,255,255,0.45)");
    gradient.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, size, size);
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    return texture;
  }, []);
}

function Bodies({ galaxy, interactive, highlight, onHover, onSelect }: GalaxyProps) {
  const filesRef = useRef<THREE.InstancedMesh>(null);
  const dirsRef = useRef<THREE.InstancedMesh>(null);
  const pickRef = useRef<THREE.InstancedMesh>(null);
  const glow = useGlowTexture();

  const { files, dirs, fileGlow, dirGlow, branchLines, orbitLines } = useMemo(() => {
    const files = galaxy.nodes.filter((n) => n.kind === "file");
    const dirs = galaxy.nodes.filter((n) => n.kind === "dir");

    const positions = (list: GalaxyNode[]) => {
      const array = new Float32Array(list.length * 3);
      list.forEach((n, i) => array.set([n.x, n.y, n.z], i * 3));
      return array;
    };

    const branch: number[] = [];
    const orbit: number[] = [];
    for (const node of galaxy.nodes) {
      if (node.parent < 0) continue;
      const parent = galaxy.nodes[node.parent];
      (node.kind === "dir" ? branch : orbit).push(parent.x, parent.y, parent.z, node.x, node.y, node.z);
    }

    const geometry = (array: Float32Array, withColor: boolean) => {
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.BufferAttribute(array, 3));
      if (withColor) g.setAttribute("color", new THREE.BufferAttribute(new Float32Array(array.length), 3));
      return g;
    };

    return {
      files,
      dirs,
      fileGlow: geometry(positions(files), true),
      dirGlow: geometry(positions(dirs), true),
      branchLines: geometry(new Float32Array(branch), false),
      orbitLines: geometry(new Float32Array(orbit), false),
    };
  }, [galaxy]);

  // Positions and sizes: set once per galaxy.
  useLayoutEffect(() => {
    const dummy = new THREE.Object3D();
    const write = (mesh: THREE.InstancedMesh | null, list: GalaxyNode[], scale: (n: GalaxyNode) => number) => {
      if (!mesh) return;
      list.forEach((node, i) => {
        dummy.position.set(node.x, node.y, node.z);
        dummy.scale.setScalar(scale(node));
        dummy.updateMatrix();
        mesh.setMatrixAt(i, dummy.matrix);
      });
      mesh.instanceMatrix.needsUpdate = true;
      mesh.computeBoundingSphere();
    };
    write(filesRef.current, files, (n) => n.radius);
    write(dirsRef.current, dirs, (n) => n.radius);
    // The pick mesh is invisible and a little larger than the body, so small files are easy to tap.
    write(pickRef.current, galaxy.nodes, (n) => n.radius * 1.7 + 0.14);
  }, [galaxy, files, dirs]);

  // Colours: redone whenever the highlight changes.
  useLayoutEffect(() => {
    const color = new THREE.Color();
    const paint = (
      mesh: THREE.InstancedMesh | null,
      glowGeometry: THREE.BufferGeometry,
      list: GalaxyNode[],
      base: (n: GalaxyNode) => THREE.Color,
    ) => {
      if (!mesh) return;
      const glowColors = glowGeometry.getAttribute("color") as THREE.BufferAttribute;
      list.forEach((node, i) => {
        color.copy(base(node));
        const dimmed = highlight !== null && !highlight.has(node.id);
        if (dimmed) color.lerp(NIGHT, 0.84);
        mesh.setColorAt(i, color);
        glowColors.setXYZ(i, color.r, color.g, color.b);
      });
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      glowColors.needsUpdate = true;
    };
    const tmp = new THREE.Color();
    paint(filesRef.current, fileGlow, files, (n) => tmp.set(n.color));
    paint(dirsRef.current, dirGlow, dirs, () => tmp.copy(FOLDER));
  }, [files, dirs, fileGlow, dirGlow, highlight]);

  const hoverAt = (e: ThreeEvent<PointerEvent>) => {
    e.stopPropagation();
    if (e.instanceId !== undefined) onHover(e.instanceId);
  };

  return (
    <group>
      <lineSegments geometry={orbitLines}>
        <lineBasicMaterial color="#8FA3D9" transparent opacity={0.09} depthWrite={false} />
      </lineSegments>
      <lineSegments geometry={branchLines}>
        <lineBasicMaterial color="#B9C6EE" transparent opacity={0.38} depthWrite={false} />
      </lineSegments>

      <points geometry={fileGlow}>
        <pointsMaterial
          map={glow}
          size={1.5}
          sizeAttenuation
          vertexColors
          transparent
          opacity={0.55}
          depthWrite={false}
          blending={THREE.AdditiveBlending}
        />
      </points>
      <points geometry={dirGlow}>
        <pointsMaterial
          map={glow}
          size={4.2}
          sizeAttenuation
          vertexColors
          transparent
          opacity={0.5}
          depthWrite={false}
          blending={THREE.AdditiveBlending}
        />
      </points>

      <instancedMesh ref={filesRef} args={[undefined, undefined, files.length]} frustumCulled={false}>
        <sphereGeometry args={[1, 16, 12]} />
        <meshBasicMaterial toneMapped={false} />
      </instancedMesh>
      <instancedMesh ref={dirsRef} args={[undefined, undefined, dirs.length]} frustumCulled={false}>
        <icosahedronGeometry args={[1, 3]} />
        <meshBasicMaterial toneMapped={false} />
      </instancedMesh>

      {interactive && (
        <instancedMesh
          ref={pickRef}
          args={[undefined, undefined, galaxy.nodes.length]}
          onPointerMove={hoverAt}
          onPointerOut={() => onHover(null)}
          onClick={(e) => {
            e.stopPropagation();
            // A drag that ends on a body is an orbit, not a selection.
            if (e.delta > 6 || e.instanceId === undefined) return;
            onSelect(e.instanceId);
          }}
        >
          <sphereGeometry args={[1, 8, 6]} />
          <meshBasicMaterial transparent opacity={0} depthWrite={false} />
        </instancedMesh>
      )}
    </group>
  );
}

/** A ring that always faces the camera and marks one body. */
function Marker({ node, color, spin }: { node: GalaxyNode; color: string; spin: boolean }) {
  const ref = useRef<THREE.Group>(null);
  const inner = useRef<THREE.Mesh>(null);
  useFrame(({ camera }, dt) => {
    ref.current?.quaternion.copy(camera.quaternion);
    if (spin && inner.current) inner.current.rotation.z += dt * 0.9;
  });
  const size = node.radius * 1.9 + 0.22;
  return (
    <group ref={ref} position={[node.x, node.y, node.z]}>
      <mesh ref={inner}>
        <ringGeometry args={[size, size + 0.045, 48, 1, 0, spin ? Math.PI * 1.6 : Math.PI * 2]} />
        <meshBasicMaterial color={color} transparent opacity={0.95} side={THREE.DoubleSide} depthTest={false} toneMapped={false} />
      </mesh>
    </group>
  );
}

interface Anchor {
  node: GalaxyNode;
  /** World-space offset below the body, for labels that sit under it. */
  drop: number;
  el: RefObject<HTMLElement | null>;
}

/** Pins DOM labels (drawn over the canvas) to bodies in the scene, every frame. */
function Projector({ anchors }: { anchors: Anchor[] }) {
  const point = useMemo(() => new THREE.Vector3(), []);
  useFrame(({ camera, size }) => {
    for (const { node, drop, el } of anchors) {
      if (!el.current) continue;
      point.set(node.x, node.y - drop, node.z).project(camera);
      const behind = point.z > 1;
      el.current.style.display = behind ? "none" : "";
      if (behind) continue;
      const x = (point.x * 0.5 + 0.5) * size.width;
      const y = (-point.y * 0.5 + 0.5) * size.height;
      el.current.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px)`;
    }
  });
  return null;
}

function Rig({ galaxy, focus, interactive, selected, reducedMotion }: GalaxyProps) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const controls = useRef<any>(null);
  const { camera, size } = useThree();
  // Portrait screens need the camera further back to fit the same chart.
  const fit = size.width < size.height ? Math.pow(size.height / size.width, 0.8) : 1;
  const overview = (galaxy.radius * 1.55 + 7) * fit;
  const goal = useRef<{ target: THREE.Vector3; distance: number } | null>(null);
  const offset = useMemo(() => new THREE.Vector3(), []);

  // Opening move: start far out and glide in.
  useEffect(() => {
    const distance = interactive ? overview : galaxy.radius * 0.95;
    const start = reducedMotion ? 1 : interactive ? 2.4 : 1.25;
    camera.position.set(distance * 0.52 * start, distance * 0.4 * start, distance * 0.76 * start);
    controls.current?.target.set(0, 0, 0);
    goal.current = { target: new THREE.Vector3(0, 0, 0), distance };
    // Runs once per chart: resizing the window should not reset the camera.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [galaxy, camera, interactive, reducedMotion]);

  useEffect(() => {
    if (!focus) return;
    const node = galaxy.nodes[focus.id];
    if (!node || node.id === 0) {
      // No body, or the root: pull back to see everything.
      goal.current = { target: new THREE.Vector3(0, 0, 0), distance: overview };
      return;
    }
    const distance = (node.kind === "dir" ? 8 + 2.6 * Math.sqrt(node.count) : 10) * Math.sqrt(fit);
    goal.current = { target: new THREE.Vector3(node.x, node.y, node.z), distance };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focus, galaxy]);

  useFrame((_, dt) => {
    const c = controls.current;
    const g = goal.current;
    if (!c || !g) return;
    const k = reducedMotion ? 1 : 1 - Math.exp(-Math.min(dt, 0.05) * 3);
    c.target.lerp(g.target, k);
    offset.copy(camera.position).sub(c.target);
    const next = THREE.MathUtils.lerp(offset.length(), g.distance, k);
    offset.setLength(next);
    camera.position.copy(c.target).add(offset);
    c.update();
    if (Math.abs(next - g.distance) < 0.04 && c.target.distanceTo(g.target) < 0.04) goal.current = null;
  });

  return (
    <OrbitControls
      ref={controls}
      makeDefault
      enabled={interactive}
      enablePan={false}
      enableDamping
      dampingFactor={0.08}
      rotateSpeed={0.7}
      zoomSpeed={0.8}
      minDistance={2.5}
      maxDistance={galaxy.radius * 4 + 30}
      autoRotate={!reducedMotion && selected === null}
      autoRotateSpeed={interactive ? 0.32 : 0.5}
      onStart={() => {
        goal.current = null;
      }}
    />
  );
}

export default function GalaxyCanvas(props: GalaxyProps) {
  const { galaxy, interactive, selected, hovered, onSelect } = props;
  const selectedNode = selected !== null ? galaxy.nodes[selected] : null;
  const hoveredNode = hovered !== null ? galaxy.nodes[hovered] : null;

  const landmarks = useMemo(
    () =>
      interactive
        ? galaxy.nodes
            .filter((n) => n.kind === "dir" && n.depth === 1)
            .sort((a, b) => b.count - a.count)
            .slice(0, 12)
        : [],
    [galaxy, interactive],
  );
  const landmarkEls = useMemo(() => landmarks.map(() => ({ current: null as HTMLElement | null })), [landmarks]);
  const hoverEl = useRef<HTMLElement | null>(null);
  const selectedEl = useRef<HTMLElement | null>(null);

  const showSelectedTag = selectedNode && selectedNode.id !== hoveredNode?.id && selectedNode.depth !== 1 && selectedNode.id !== 0;
  const showHoverTag = hoveredNode && hoveredNode.id !== 0;

  const anchors: Anchor[] = landmarks.map((node, i) => ({ node, drop: node.radius + 0.5, el: landmarkEls[i] }));
  if (showSelectedTag) anchors.push({ node: selectedNode, drop: 0, el: selectedEl });
  if (showHoverTag) anchors.push({ node: hoveredNode, drop: 0, el: hoverEl });

  return (
    <div className="sky-frame">
      <Canvas
        dpr={[1, 2]}
        camera={{ fov: 50, near: 0.1, far: 4000, position: [0, 20, 60] }}
        gl={{ antialias: true, powerPreference: "high-performance" }}
        onPointerMissed={() => interactive && onSelect(null)}
        style={{ cursor: hoveredNode ? "pointer" : interactive ? "grab" : "default" }}
      >
        <color attach="background" args={["#0B1026"]} />
        <fog attach="fog" args={["#0B1026", galaxy.radius * 1.4 + 20, galaxy.radius * 5 + 90]} />
        <Stars radius={galaxy.radius * 3 + 60} depth={60} count={2600} factor={4} saturation={0} fade speed={props.reducedMotion ? 0 : 0.6} />
        <Bodies {...props} />
        {selectedNode && <Marker node={selectedNode} color={BRASS} spin={!props.reducedMotion} />}
        {hoveredNode && hoveredNode.id !== selectedNode?.id && <Marker node={hoveredNode} color="#EDE6D3" spin={false} />}
        <Rig {...props} />
        <Projector anchors={anchors} />
      </Canvas>

      <div className="sky-labels" aria-hidden>
        {landmarks.map((node, i) => (
          <span key={node.id} ref={(el) => void (landmarkEls[i].current = el)}>
            <span className="sky-label">{node.name}</span>
          </span>
        ))}
        {showSelectedTag && (
          <span ref={selectedEl}>
            <span className="sky-tag sky-tag-selected">{selectedNode.name}</span>
          </span>
        )}
        {showHoverTag && (
          <span ref={hoverEl}>
            <span className="sky-tag">
              {hoveredNode.name}
              <em>{hoveredNode.kind === "dir" ? fileCount(hoveredNode.count) : hoveredNode.language}</em>
            </span>
          </span>
        )}
      </div>
    </div>
  );
}
