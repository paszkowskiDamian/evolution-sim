import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import type { Agent, Structure, WorldResource } from './types';
import { terrainHeight, WORLD_SIZE } from './terrain';
import { WorldEngine } from './WorldEngine';

interface Props {
  engine: WorldEngine;
}

interface AgentVisual extends THREE.Group {
  userData: { agentId: string; label: THREE.Sprite; labelText: string; ring: THREE.Mesh };
}

function markAgent(object: THREE.Object3D, id: string): void {
  object.userData.agentId = id;
  for (const child of object.children) markAgent(child, id);
}

function makeTextSprite(text: string): THREE.Sprite {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 128;
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, transparent: true, depthTest: false }));
  sprite.scale.set(6.4, 1.6, 1);
  updateTextSprite(sprite, text);
  return sprite;
}

function updateTextSprite(sprite: THREE.Sprite, text: string): void {
  const material = sprite.material as THREE.SpriteMaterial;
  const canvas = material.map?.image as HTMLCanvasElement;
  const context = canvas.getContext('2d');
  if (!context) return;
  context.clearRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = 'rgba(12, 18, 24, .86)';
  context.beginPath();
  context.roundRect(8, 12, 496, 98, 28);
  context.fill();
  context.strokeStyle = 'rgba(255,255,255,.22)';
  context.lineWidth = 3;
  context.stroke();
  context.fillStyle = '#f8f4e8';
  context.font = '600 28px Inter, system-ui, sans-serif';
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  const clipped = text.length > 34 ? `${text.slice(0, 33)}…` : text;
  context.fillText(clipped, 256, 61, 460);
  if (material.map) material.map.needsUpdate = true;
}

function createAgentVisual(agent: Agent): AgentVisual {
  const group = new THREE.Group() as AgentVisual;
  const color = new THREE.Color(agent.color);
  const body = new THREE.Mesh(
    new THREE.CapsuleGeometry(0.42, 0.72, 5, 10),
    new THREE.MeshStandardMaterial({ color, roughness: 0.72 }),
  );
  body.position.y = 0.9;
  body.castShadow = true;
  const head = new THREE.Mesh(
    new THREE.SphereGeometry(0.38, 18, 12),
    new THREE.MeshStandardMaterial({ color: color.clone().offsetHSL(0, -0.08, 0.14), roughness: 0.8 }),
  );
  head.position.y = 1.72;
  head.castShadow = true;
  const eyeMaterial = new THREE.MeshBasicMaterial({ color: '#172027' });
  for (const x of [-0.13, 0.13]) {
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.045, 8, 6), eyeMaterial);
    eye.position.set(x, 1.78, 0.35);
    group.add(eye);
  }
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(0.66, 0.76, 32),
    new THREE.MeshBasicMaterial({ color: agent.controlledBy === 'human' ? '#ffffff' : '#f6d879', transparent: true, opacity: 0.9, side: THREE.DoubleSide }),
  );
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.035;
  ring.visible = agent.controlledBy === 'human';
  const label = makeTextSprite(agent.name);
  label.position.y = 2.65;
  group.add(body, head, ring, label);
  markAgent(group, agent.id);
  group.userData = { agentId: agent.id, label, labelText: agent.name, ring };
  return group;
}

function createResourceVisual(resource: WorldResource): THREE.Group {
  const group = new THREE.Group();
  if (resource.kind === 'rock') {
    const material = new THREE.MeshStandardMaterial({ color: '#78828a', roughness: 0.95, flatShading: true });
    for (let i = 0; i < 3; i += 1) {
      const rock = new THREE.Mesh(new THREE.DodecahedronGeometry(0.48 + i * 0.12, 0), material);
      rock.position.set((i - 1) * 0.48, 0.38 + i * 0.08, (i % 2) * 0.28);
      rock.rotation.set(i * 0.7, i * 1.3, 0);
      rock.castShadow = true;
      group.add(rock);
    }
  } else if (resource.kind === 'wood') {
    const logMaterial = new THREE.MeshStandardMaterial({ color: '#6f422c', roughness: 1 });
    for (let i = 0; i < 3; i += 1) {
      const log = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.16, 1.7, 9), logMaterial);
      log.rotation.z = Math.PI / 2;
      log.rotation.y = i * 0.45;
      log.position.set(0, 0.18 + i * 0.19, 0);
      log.castShadow = true;
      group.add(log);
    }
  } else {
    const leaves = new THREE.Mesh(
      new THREE.IcosahedronGeometry(0.8, 1),
      new THREE.MeshStandardMaterial({ color: '#3f865b', roughness: 0.92, flatShading: true }),
    );
    leaves.position.y = 0.65;
    leaves.castShadow = true;
    group.add(leaves);
    const berryMaterial = new THREE.MeshStandardMaterial({ color: '#d84062', roughness: 0.7 });
    for (let i = 0; i < 7; i += 1) {
      const berry = new THREE.Mesh(new THREE.SphereGeometry(0.09, 8, 6), berryMaterial);
      const angle = i * 2.4;
      berry.position.set(Math.cos(angle) * 0.58, 0.55 + (i % 3) * 0.22, Math.sin(angle) * 0.58);
      group.add(berry);
    }
  }
  return group;
}

function createStructureVisual(structure: Structure): THREE.Group {
  const group = new THREE.Group();
  if (structure.kind === 'campfire') {
    const wood = new THREE.MeshStandardMaterial({ color: '#493025', roughness: 1 });
    for (const rotation of [-0.72, 0.72]) {
      const log = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.15, 1.4, 9), wood);
      log.rotation.z = Math.PI / 2;
      log.rotation.y = rotation;
      log.position.y = 0.16;
      log.castShadow = true;
      group.add(log);
    }
    const flame = new THREE.Mesh(
      new THREE.ConeGeometry(0.4, 1.2, 9),
      new THREE.MeshStandardMaterial({ color: '#ff9f43', emissive: '#ff6b24', emissiveIntensity: 2.5 }),
    );
    flame.position.y = 0.75;
    const glow = new THREE.PointLight('#ff9d54', 18, 11, 2);
    glow.position.y = 1.2;
    group.add(flame, glow);
  } else if (structure.kind === 'storehouse') {
    const walls = new THREE.Mesh(
      new THREE.BoxGeometry(4.2, 2.5, 3.3),
      new THREE.MeshStandardMaterial({ color: '#775038', roughness: 1 }),
    );
    walls.position.y = 1.25;
    walls.castShadow = true;
    const roof = new THREE.Mesh(new THREE.ConeGeometry(3.2, 1.6, 4), new THREE.MeshStandardMaterial({ color: '#394e41', roughness: 1 }));
    roof.position.y = 3.25;
    roof.rotation.y = Math.PI / 4;
    roof.castShadow = true;
    const door = new THREE.Mesh(new THREE.BoxGeometry(1.15, 1.8, 0.12), new THREE.MeshStandardMaterial({ color: '#2e211b' }));
    door.position.set(0, 0.9, 1.7);
    group.add(walls, roof, door);
  } else if (structure.kind === 'workshop') {
    const postMaterial = new THREE.MeshStandardMaterial({ color: '#6e482f', roughness: 1 });
    for (const x of [-1.7, 1.7]) for (const z of [-1.35, 1.35]) {
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.18, 2.5, 8), postMaterial);
      post.position.set(x, 1.25, z);
      post.castShadow = true;
      group.add(post);
    }
    const roof = new THREE.Mesh(new THREE.ConeGeometry(3.1, 1.2, 4), new THREE.MeshStandardMaterial({ color: '#637148', roughness: 1 }));
    roof.position.y = 3;
    roof.rotation.y = Math.PI / 4;
    roof.castShadow = true;
    const bench = new THREE.Mesh(new THREE.BoxGeometry(2.8, 0.22, 1), new THREE.MeshStandardMaterial({ color: '#8d603e' }));
    bench.position.y = 0.85;
    bench.castShadow = true;
    group.add(roof, bench);
  } else if (structure.kind === 'shelter') {
    const wall = new THREE.MeshStandardMaterial({ color: '#8c5b38', roughness: 1 });
    const roof = new THREE.MeshStandardMaterial({ color: '#405d45', roughness: 0.95, flatShading: true });
    const cabin = new THREE.Mesh(new THREE.BoxGeometry(3.4, 2.1, 2.8), wall);
    cabin.position.y = 1.05;
    cabin.castShadow = true;
    const roofMesh = new THREE.Mesh(new THREE.ConeGeometry(2.75, 1.5, 4), roof);
    roofMesh.position.y = 2.72;
    roofMesh.rotation.y = Math.PI / 4;
    roofMesh.castShadow = true;
    const door = new THREE.Mesh(new THREE.BoxGeometry(0.75, 1.45, 0.08), new THREE.MeshStandardMaterial({ color: '#36261f' }));
    door.position.set(0, 0.73, 1.44);
    group.add(cabin, roofMesh, door);
  } else {
    const wall = new THREE.Mesh(
      new THREE.BoxGeometry(3.2, 1.4, 0.38),
      new THREE.MeshStandardMaterial({ color: '#8a7660', roughness: 1 }),
    );
    wall.position.y = 0.7;
    wall.castShadow = true;
    group.add(wall);
  }
  return group;
}

export function WorldView({ engine }: Props) {
  const hostRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color('#9fc8d0');
    scene.fog = new THREE.FogExp2('#b7d0ca', 0.012);
    const camera = new THREE.PerspectiveCamera(48, 1, 0.1, 180);
    camera.position.set(15, 15, 20);
    const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFShadowMap;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;
    host.appendChild(renderer.domElement);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.maxPolarAngle = Math.PI * 0.47;
    controls.minDistance = 7;
    controls.maxDistance = 42;
    controls.target.set(0, 0, 0);

    const hemi = new THREE.HemisphereLight('#d8f4ff', '#3f4b32', 2.2);
    scene.add(hemi);
    const sun = new THREE.DirectionalLight('#ffe6bd', 3.2);
    sun.position.set(-18, 30, 14);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.camera.left = -42;
    sun.shadow.camera.right = 42;
    sun.shadow.camera.top = 42;
    sun.shadow.camera.bottom = -42;
    scene.add(sun);

    const terrain = new THREE.PlaneGeometry(WORLD_SIZE, WORLD_SIZE, 56, 56);
    terrain.rotateX(-Math.PI / 2);
    const positions = terrain.getAttribute('position');
    const colors: number[] = [];
    const low = new THREE.Color('#66865a');
    const high = new THREE.Color('#92a66a');
    for (let i = 0; i < positions.count; i += 1) {
      const x = positions.getX(i);
      const z = positions.getZ(i);
      const y = terrainHeight(x, z);
      positions.setY(i, y);
      const color = low.clone().lerp(high, THREE.MathUtils.clamp((y + 1.3) / 2.8, 0, 1));
      colors.push(color.r, color.g, color.b);
    }
    terrain.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    terrain.computeVertexNormals();
    const ground = new THREE.Mesh(terrain, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1 }));
    ground.receiveShadow = true;
    scene.add(ground);

    const rimMaterial = new THREE.MeshStandardMaterial({ color: '#66755c', roughness: 1, flatShading: true });
    for (let i = 0; i < 24; i += 1) {
      const angle = (i / 24) * Math.PI * 2;
      const radius = 40 + (i % 3) * 3;
      const mountain = new THREE.Mesh(new THREE.ConeGeometry(5 + (i % 4), 8 + (i % 5) * 2, 6), rimMaterial);
      mountain.position.set(Math.cos(angle) * radius, 3, Math.sin(angle) * radius);
      mountain.rotation.y = angle;
      scene.add(mountain);
    }

    const agentVisuals = new Map<string, AgentVisual>();
    const resourceVisuals = new Map<string, THREE.Group>();
    const structureVisuals = new Map<string, THREE.Group>();
    let previousTime = performance.now();
    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();
    const keys = new Set<string>();
    let animationFrame = 0;

    const resize = () => {
      const { clientWidth, clientHeight } = host;
      camera.aspect = clientWidth / Math.max(1, clientHeight);
      camera.updateProjectionMatrix();
      renderer.setSize(clientWidth, clientHeight, false);
    };
    const resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(host);
    resize();

    const onPointerDown = (event: PointerEvent) => {
      const rect = renderer.domElement.getBoundingClientRect();
      pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
      pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(pointer, camera);
      const hit = raycaster.intersectObjects([...agentVisuals.values()], true)[0];
      const id = hit?.object.userData.agentId as string | undefined;
      engine.selectAgent(id ?? null);
    };
    renderer.domElement.addEventListener('pointerdown', onPointerDown);

    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.target as HTMLElement)?.matches('input, textarea, button')) return;
      keys.add(event.code);
      if (event.code === 'KeyE' && !event.repeat) engine.humanInteract();
      if (event.code === 'Space' && !event.repeat) {
        event.preventDefault();
        engine.setRunning(!engine.running);
      }
    };
    const onKeyUp = (event: KeyboardEvent) => keys.delete(event.code);
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);

    const animate = () => {
      animationFrame = requestAnimationFrame(animate);
      const now = performance.now();
      const dt = Math.min((now - previousTime) / 1000, 0.1);
      previousTime = now;
      const x = (keys.has('KeyD') || keys.has('ArrowRight') ? 1 : 0) - (keys.has('KeyA') || keys.has('ArrowLeft') ? 1 : 0);
      const z = (keys.has('KeyS') || keys.has('ArrowDown') ? 1 : 0) - (keys.has('KeyW') || keys.has('ArrowUp') ? 1 : 0);
      engine.setHumanMove(x, z);
      engine.update(dt);

      for (const agent of engine.agents) {
        if (!agent.alive) continue;
        let visual = agentVisuals.get(agent.id);
        if (!visual) {
          visual = createAgentVisual(agent);
          agentVisuals.set(agent.id, visual);
          scene.add(visual);
        }
        visual.position.set(agent.x, terrainHeight(agent.x, agent.z), agent.z);
        if (agent.target) visual.rotation.y = Math.atan2(agent.target.x - agent.x, agent.target.z - agent.z);
        const labelText = agent.speechUntil > engine.time && agent.speech ? agent.speech : agent.name;
        if (visual.userData.labelText !== labelText) {
          updateTextSprite(visual.userData.label, labelText);
          visual.userData.labelText = labelText;
        }
        visual.userData.ring.visible = agent.controlledBy === 'human' || engine.selectedAgentId === agent.id;
      }
      for (const [id, visual] of agentVisuals) {
        if (!engine.agents.some((agent) => agent.id === id && agent.alive)) {
          scene.remove(visual);
          agentVisuals.delete(id);
        }
      }

      for (const resource of engine.resources) {
        let visual = resourceVisuals.get(resource.id);
        if (!visual) {
          visual = createResourceVisual(resource);
          resourceVisuals.set(resource.id, visual);
          scene.add(visual);
        }
        visual.position.set(resource.x, terrainHeight(resource.x, resource.z), resource.z);
        visual.visible = resource.amount > 0.15;
        const scale = Math.max(0.45, resource.amount / resource.capacity);
        visual.scale.setScalar(0.72 + scale * 0.28);
      }
      for (const structure of engine.structures) {
        if (structureVisuals.has(structure.id)) continue;
        const visual = createStructureVisual(structure);
        visual.position.set(structure.x, terrainHeight(structure.x, structure.z), structure.z);
        visual.rotation.y = structure.rotation;
        structureVisuals.set(structure.id, visual);
        scene.add(visual);
      }

      const human = engine.human;
      if (human && keys.size > 0) {
        const desired = new THREE.Vector3(human.x, terrainHeight(human.x, human.z) + 0.8, human.z);
        controls.target.lerp(desired, Math.min(1, dt * 4));
      }
      const daylight = (Math.sin(engine.tick * 0.00035) + 1) / 2;
      sun.intensity = 1.3 + daylight * 2.2;
      controls.update();
      renderer.render(scene, camera);
    };
    animate();

    return () => {
      cancelAnimationFrame(animationFrame);
      resizeObserver.disconnect();
      renderer.domElement.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      controls.dispose();
      renderer.dispose();
      renderer.domElement.remove();
      scene.traverse((object) => {
        if (object instanceof THREE.Mesh || object instanceof THREE.Sprite) {
          object.geometry?.dispose();
          const materials = Array.isArray(object.material) ? object.material : [object.material];
          materials.forEach((material) => material.dispose());
        }
      });
    };
  }, [engine]);

  return <div className="world-canvas" ref={hostRef} aria-label="3D survival world" />;
}
