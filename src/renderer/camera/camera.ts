import { clamp } from '../../core/utils/math';

const DEFAULT_OVERSCAN_PX = 2;

/**
 * Kamera 2D — czysta matematyka, bez zależności od Pixi i DOM.
 * Renderer tylko przepisuje jej stan na transformację kontenera.
 */
export class Camera {
  /** Punkt świata w centrum widoku. */
  x = 0;
  y = 0;
  zoom = 1;

  maxZoom = 8;

  viewWidth = 1;
  viewHeight = 1;

  private worldWidth = 1;
  private worldHeight = 1;
  private minZoomValue = 1;
  private hasWorldBounds = false;
  private readonly overscanPx: number;

  /** Id śledzonego agenta albo null. */
  followId: number | null = null;

  constructor(overscanPx = DEFAULT_OVERSCAN_PX) {
    this.overscanPx = Math.max(0, overscanPx);
  }

  /** Minimum jest wyliczane z bieżącego viewportu i rozmiaru świata. */
  get minZoom(): number {
    return this.minZoomValue;
  }

  setViewport(w: number, h: number): void {
    this.viewWidth = Math.max(1, w);
    this.viewHeight = Math.max(1, h);
    this.updateConstraints();
  }

  setWorldBounds(width: number, height = width): void {
    this.worldWidth = Math.max(1, width);
    this.worldHeight = Math.max(1, height);
    this.hasWorldBounds = true;
    this.updateConstraints();
  }

  /** Zoom wokół punktu ekranu (kursora), a nie środka widoku. */
  zoomAt(screenX: number, screenY: number, factor: number): void {
    const before = this.screenToWorld(screenX, screenY);
    const maxZoom = Math.max(this.maxZoom, this.minZoomValue);
    this.zoom = clamp(this.zoom * factor, this.minZoomValue, maxZoom);
    const after = this.screenToWorld(screenX, screenY);
    this.x += before.x - after.x;
    this.y += before.y - after.y;
    this.clampCenter();
  }

  panByScreen(dx: number, dy: number): void {
    this.x -= dx / this.zoom;
    this.y -= dy / this.zoom;
    this.followId = null;
    this.clampCenter();
  }

  screenToWorld(sx: number, sy: number): { x: number; y: number } {
    return {
      x: (sx - this.viewWidth / 2) / this.zoom + this.x,
      y: (sy - this.viewHeight / 2) / this.zoom + this.y,
    };
  }

  worldToScreen(wx: number, wy: number): { x: number; y: number } {
    return {
      x: (wx - this.x) * this.zoom + this.viewWidth / 2,
      y: (wy - this.y) * this.zoom + this.viewHeight / 2,
    };
  }

  /** Płynne dogonienie śledzonego celu, z zachowaniem granic świata. */
  followTarget(tx: number, ty: number, smoothing = 0.15): void {
    this.x += (tx - this.x) * smoothing;
    this.y += (ty - this.y) * smoothing;
    this.clampCenter();
  }

  /**
   * Widok pokrywający cały viewport bez odsłaniania tła poza światem.
   * `zoomMultiplier = 2` daje bliższy widok startowy, a zwykłe fit/reset
   * korzystają z wartości 1.
   */
  fitWorld(worldSize: number, zoomMultiplier = 1): void {
    this.setWorldBounds(worldSize);
    this.x = this.worldWidth / 2;
    this.y = this.worldHeight / 2;
    const maxZoom = Math.max(this.maxZoom, this.minZoomValue);
    this.zoom = clamp(this.minZoomValue * zoomMultiplier, this.minZoomValue, maxZoom);
    this.followId = null;
    this.clampCenter();
  }

  /** Re-apply bounds after external state changes without changing follow. */
  constrain(): void {
    this.updateConstraints();
  }

  private updateConstraints(): void {
    if (!this.hasWorldBounds) return;
    this.minZoomValue = Math.max(
      (this.viewWidth + this.overscanPx * 2) / this.worldWidth,
      (this.viewHeight + this.overscanPx * 2) / this.worldHeight,
    );
    this.zoom = clamp(this.zoom, this.minZoomValue, Math.max(this.maxZoom, this.minZoomValue));
    this.clampCenter();
  }

  private clampCenter(): void {
    if (!this.hasWorldBounds) return;
    const halfVisibleWidth = this.viewWidth / (2 * this.zoom);
    const halfVisibleHeight = this.viewHeight / (2 * this.zoom);
    this.x = clamp(this.x, halfVisibleWidth, this.worldWidth - halfVisibleWidth);
    this.y = clamp(this.y, halfVisibleHeight, this.worldHeight - halfVisibleHeight);
  }
}
