"use client";

import { Suspense, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { ContactShadows, Edges, OrbitControls } from "@react-three/drei";
import { DoubleSide, type Mesh, type MeshBasicMaterial, type PerspectiveCamera } from "three";
import { catalogItemFor } from "@/lib/catalog";
import { useRackStore } from "@/lib/store";
import type { Category, Design, Placement } from "@/lib/types";

// Real rack geometry, scaled to scene units: 1U = 44.45mm, 19" mounting width.
const U_H = 0.4445;
const RACK_W = 4.826;
const DEPTH_SCALE = 0.004; // mm -> scene units

const CATEGORY_COLOR: Record<Category, string> = {
  server: "#4a9eda",
  switch: "#a874e8",
  storage: "#3fb98a",
  ups: "#e0a33e",
  pdu: "#c98a2e",
  patch: "#7a8595",
  blank: "#3a424f",
};

function DeviceBox({
  placement,
  design,
  rackHeightU,
  violated,
  selected,
  onSelect,
}: {
  placement: Placement;
  design: Design;
  rackHeightU: number;
  violated: boolean;
  selected: boolean;
  onSelect: () => void;
}) {
  const item = catalogItemFor(design, placement.catalogId);
  const meshRef = useRef<Mesh>(null);

  const depth = item && item.heightU > 0 ? Math.max(item.depthMm * DEPTH_SCALE, 0.4) : 0;
  const facing = placement.face === "front" ? 1 : -1;
  const restZ = placement.face === "front" ? depth / 2 - 0.9 : 0.9 - depth / 2;

  // Devices slide into the rack when they appear, staggered bottom-up, so a
  // generated design reads as being racked rather than teleporting in. Driven
  // by refs in useFrame — declarative animation would need another dependency
  // for one effect.
  const elapsed = useRef(0);
  const slideDelay = Math.min(placement.startU * 0.02, 0.4);

  useFrame(({ clock }, delta) => {
    const mesh = meshRef.current;
    if (!mesh) return;

    elapsed.current += delta;
    const t = Math.min(1, Math.max(0, (elapsed.current - slideDelay) / 0.5));
    const eased = 1 - Math.pow(1 - t, 3);
    mesh.position.z = restZ + (1 - eased) * 2.2 * facing;
    mesh.scale.setScalar(0.9 + eased * 0.1);

    const material = mesh.material as { emissiveIntensity?: number };
    if (violated) {
      // Violations pulse so a bad device is findable while orbiting.
      material.emissiveIntensity = 0.35 + Math.sin(clock.elapsedTime * 4) * 0.25;
    } else if (selected) {
      material.emissiveIntensity = 0.32 + Math.sin(clock.elapsedTime * 2.2) * 0.14;
    }
  });

  if (!item || item.heightU <= 0) return null;

  const height = item.heightU * U_H * 0.94;
  // U1 sits at the bottom; centre the rack on the origin.
  const centerU = placement.startU + item.heightU / 2 - 0.5;
  const y = (centerU - rackHeightU / 2) * U_H;

  return (
    <mesh
      ref={meshRef}
      position={[0, y, restZ]}
      onClick={(e) => {
        e.stopPropagation();
        onSelect();
      }}
    >
      <boxGeometry args={[RACK_W, height, depth]} />
      <meshStandardMaterial
        color={violated ? "#e5484d" : CATEGORY_COLOR[item.category]}
        emissive={violated ? "#e5484d" : selected ? "#5aa9e6" : "#000000"}
        emissiveIntensity={violated ? 0.4 : selected ? 0.4 : 0}
        metalness={0.3}
        roughness={0.55}
      />
      <Edges threshold={15} color={selected ? "#9ecbf0" : "#10151c"} />
    </mesh>
  );
}

function RackFrame({ heightU }: { heightU: number }) {
  const h = heightU * U_H;
  const postW = 0.12;
  const depth = 3.4;

  return (
    <group>
      {/* Four corner posts */}
      {[
        [-RACK_W / 2 - postW / 2, -depth / 2],
        [RACK_W / 2 + postW / 2, -depth / 2],
        [-RACK_W / 2 - postW / 2, depth / 2],
        [RACK_W / 2 + postW / 2, depth / 2],
      ].map(([x, z], i) => (
        <mesh key={i} position={[x, 0, z]}>
          <boxGeometry args={[postW, h, postW]} />
          <meshStandardMaterial color="#2a313c" metalness={0.6} roughness={0.4} />
        </mesh>
      ))}

      {/* Top and bottom plates */}
      {[h / 2 + postW / 2, -h / 2 - postW / 2].map((y, i) => (
        <mesh key={i} position={[0, y, 0]}>
          <boxGeometry args={[RACK_W + postW * 2, postW, depth + postW]} />
          <meshStandardMaterial color="#232a34" metalness={0.5} roughness={0.5} />
        </mesh>
      ))}
    </group>
  );
}

/** Every-5U tick marks on the front rails. Deliberately geometry, not drei's
 *  <Text> — that suspends on font loading and stalls the whole scene. The 2D
 *  elevation is the precise view; 3D is for spatial reading. */
function URulers({ heightU }: { heightU: number }) {
  const marks = useMemo(
    () => Array.from({ length: heightU }, (_, i) => i + 1).filter((u) => u % 5 === 0),
    [heightU]
  );

  return (
    <group>
      {marks.map((u) => (
        <mesh key={u} position={[-RACK_W / 2 - 0.16, (u - 0.5 - heightU / 2) * U_H, 1.72]}>
          <boxGeometry args={[0.22, 0.04, 0.04]} />
          <meshStandardMaterial color="#6b7684" emissive="#6b7684" emissiveIntensity={0.3} />
        </mesh>
      ))}
    </group>
  );
}

/**
 * A plane of light travelling up the rack while agents hold the design. Same
 * job as the 2D scan line: there is no honest progress figure to show, so it
 * says "busy" and nothing more.
 */
function ScanPlane({ heightU, active }: { heightU: number; active: boolean }) {
  const ref = useRef<Mesh>(null);
  const PERIOD = 2.4;

  useFrame(({ clock }) => {
    const mesh = ref.current;
    if (!mesh) return;
    const h = heightU * U_H;
    const phase = (clock.elapsedTime % PERIOD) / PERIOD;
    mesh.position.y = -h / 2 + phase * h;
    (mesh.material as MeshBasicMaterial).opacity = 0.34 * Math.sin(phase * Math.PI);
  });

  if (!active) return null;

  return (
    <mesh ref={ref} rotation={[-Math.PI / 2, 0, 0]}>
      <planeGeometry args={[RACK_W + 1.4, 4]} />
      <meshBasicMaterial color="#5aa9e6" transparent opacity={0} depthWrite={false} side={DoubleSide} />
    </mesh>
  );
}

/** Frames the whole rack regardless of its height — a 42U rack is ~18.7 scene
 *  units tall, far too big for a fixed camera distance. */
function CameraRig({ heightU }: { heightU: number }) {
  const { camera } = useThree();
  const fitted = useRef(0);

  useEffect(() => {
    if (fitted.current === heightU) return;
    fitted.current = heightU;

    const rackH = heightU * U_H;
    const fovRad = ((camera as PerspectiveCamera).fov * Math.PI) / 180;
    const distance = (rackH / 2 / Math.tan(fovRad / 2)) * 1.15;

    camera.position.set(distance * 0.45, rackH * 0.14, distance * 0.92);
    camera.lookAt(0, 0, 0);
    camera.updateProjectionMatrix();
  }, [camera, heightU]);

  return null;
}

function Scene({ design, violatedIds }: { design: Design; violatedIds: Set<string> }) {
  const selectedPlacementId = useRackStore((s) => s.selectedPlacementId);
  const selectPlacement = useRackStore((s) => s.selectPlacement);
  const isRunning = useRackStore((s) => s.isRunning);
  const heightU = design.rack.heightU;

  return (
    <>
      <CameraRig heightU={heightU} />
      <ambientLight intensity={0.55} />
      <directionalLight position={[6, 10, 8]} intensity={1.5} castShadow />
      <directionalLight position={[-6, 4, -8]} intensity={0.5} color="#6aa6d8" />

      <group onPointerMissed={() => selectPlacement(null)}>
        <RackFrame heightU={heightU} />
        <URulers heightU={heightU} />
        <ScanPlane heightU={heightU} active={isRunning} />
        {design.placements.map((p) => (
          <DeviceBox
            key={p.id}
            placement={p}
            design={design}
            rackHeightU={heightU}
            violated={violatedIds.has(p.id)}
            selected={selectedPlacementId === p.id}
            onSelect={() => selectPlacement(p.id)}
          />
        ))}
      </group>

      <gridHelper args={[26, 26, "#2a313c", "#1d232c"]} position={[0, -(heightU * U_H) / 2 - 0.3, 0]} />
      {/* Grounds the rack on the floor plane — without it the whole thing
          floats. Local renderer, no asset to fetch. */}
      <ContactShadows
        position={[0, -(heightU * U_H) / 2 - 0.28, 0]}
        opacity={0.5}
        scale={16}
        blur={2.4}
        far={4}
      />
      <OrbitControls
        enablePan
        enableDamping
        dampingFactor={0.08}
        minDistance={4}
        maxDistance={40}
        target={[0, 0, 0]}
        // Turns under its own power only while the agents are working, so the
        // motion means something instead of being ambient fidgeting.
        autoRotate={isRunning}
        autoRotateSpeed={0.6}
      />
    </>
  );
}

export function Rack3D() {
  const design = useRackStore((s) => s.design);
  const violatedIds = useRackStore((s) => s.violatedPlacementIds);

  // R3F sizes itself from a ResizeObserver on its container, but when the
  // canvas is mounted by a tab switch the container's size never *changes*
  // after observation starts — so the callback may never fire and the canvas
  // sticks at its 300x150 default. Measuring here and mounting <Canvas> only
  // once we have real pixels removes the race entirely (a timer-based nudge
  // was flaky).
  const containerRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);

  useLayoutEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const measure = () => {
      const { width, height } = el.getBoundingClientRect();
      if (width > 0 && height > 0) {
        setSize((prev) => (prev?.w === width && prev?.h === height ? prev : { w: width, h: height }));
      }
    };

    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);

    // ResizeObserver doesn't reliably deliver the 0 -> real transition when the
    // page was hidden while mounting (background tab, hidden panel), so cover
    // those two cases explicitly.
    window.addEventListener("resize", measure);
    document.addEventListener("visibilitychange", measure);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", measure);
      document.removeEventListener("visibilitychange", measure);
    };
  }, []);

  // Even with a correctly sized container, R3F's internal measurement doesn't
  // fire in this setup — its wrapper ends up 950x493 while the <canvas> stays
  // at the 300x150 default, i.e. setSize() never ran. A window resize makes it
  // recompute. The guard above means the canvas definitely exists by now, so
  // these only cover R3F attaching its own listener a beat later.
  useEffect(() => {
    if (!size) return;
    const timers = [0, 50, 150, 400].map((delay) =>
      setTimeout(() => window.dispatchEvent(new Event("resize")), delay)
    );
    return () => timers.forEach(clearTimeout);
  }, [size]);

  return (
    // absolute inset-0 rather than h-full: a flex child has no definite height
    // for percentage sizing to resolve against.
    <div ref={containerRef} className="absolute inset-0">
      {size && (
        <Canvas
          camera={{ position: [7, 3, 12], fov: 42 }}
          dpr={[1, 2]}
          resize={{ offsetSize: true }}
          gl={{ antialias: true }}
          style={{ width: size.w, height: size.h, background: "transparent" }}
        >
          <Suspense fallback={null}>
            <Scene design={design} violatedIds={violatedIds} />
          </Suspense>
        </Canvas>
      )}
      <p className="pointer-events-none absolute bottom-2 left-1/2 -translate-x-1/2 font-mono text-[10px] text-muted-foreground/70">
        drag to orbit · scroll to zoom · click a device to select
      </p>
    </div>
  );
}
