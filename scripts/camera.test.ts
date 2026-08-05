import assert from 'node:assert/strict';
import { Camera } from '../src/renderer/camera/camera';

const EPSILON = 1e-8;

function assertWorldCovered(camera: Camera, worldSize: number): void {
  const topLeft = camera.screenToWorld(0, 0);
  const bottomRight = camera.screenToWorld(camera.viewWidth, camera.viewHeight);
  assert.ok(topLeft.x >= -EPSILON, `left edge escaped: ${topLeft.x}`);
  assert.ok(topLeft.y >= -EPSILON, `top edge escaped: ${topLeft.y}`);
  assert.ok(bottomRight.x <= worldSize + EPSILON, `right edge escaped: ${bottomRight.x}`);
  assert.ok(bottomRight.y <= worldSize + EPSILON, `bottom edge escaped: ${bottomRight.y}`);
}

function landscape(): void {
  const camera = new Camera();
  camera.setViewport(1200, 600);
  camera.fitWorld(1000);
  assert.ok(camera.minZoom > 1.2, 'overscan must be included in dynamic min zoom');
  assertWorldCovered(camera, 1000);

  camera.panByScreen(100_000, -100_000);
  assertWorldCovered(camera, 1000);

  camera.fitWorld(1000, 2);
  assert.ok(Math.abs(camera.zoom - camera.minZoom * 2) < EPSILON);
  assertWorldCovered(camera, 1000);
}

function portraitAndResize(): void {
  const camera = new Camera();
  camera.setViewport(600, 1200);
  camera.fitWorld(1000);
  assertWorldCovered(camera, 1000);

  camera.zoomAt(300, 600, 3);
  const cursorWorld = camera.screenToWorld(300, 600);
  assert.ok(Math.abs(cursorWorld.x - 500) < EPSILON);
  assert.ok(Math.abs(cursorWorld.y - 500) < EPSILON);
  assertWorldCovered(camera, 1000);

  camera.setViewport(1600, 500);
  assertWorldCovered(camera, 1000);
}

function followNearEveryEdge(): void {
  const camera = new Camera();
  camera.setViewport(900, 500);
  camera.fitWorld(1000, 2);
  for (const [x, y] of [[0, 0], [1000, 0], [0, 1000], [1000, 1000]]) {
    camera.followTarget(x, y, 1);
    assertWorldCovered(camera, 1000);
  }
}

landscape();
portraitAndResize();
followNearEveryEdge();
console.log('camera assertions passed');
