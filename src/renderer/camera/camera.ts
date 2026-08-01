import { clamp } from '../../core/utils/math';

/**
 * Kamera 2D — czysta matematyka, bez zależności od Pixi i DOM.
 * Renderer tylko przepisuje jej stan na transformację kontenera.
 */
export class Camera {
  /** Punkt świata w centrum widoku. */
  x = 0;
  y = 0;
  zoom = 1;

  minZoom = 0.05;
  maxZoom = 8;

  viewWidth = 1;
  viewHeight = 1;

  /** Id śledzonego agenta albo null. */
  followId: number | null = null;

  setViewport(w: number, h: number): void {
    this.viewWidth = w;
    this.viewHeight = h;
  }

  /** Zoom wokół punktu ekranu (kursora), a nie środka widoku. */
  zoomAt(screenX: number, screenY: number, factor: number): void {
    const before = this.screenToWorld(screenX, screenY);
    this.zoom = clamp(this.zoom * factor, this.minZoom, this.maxZoom);
    const after = this.screenToWorld(screenX, screenY);
    this.x += before.x - after.x;
    this.y += before.y - after.y;
  }

  panByScreen(dx: number, dy: number): void {
    this.x -= dx / this.zoom;
    this.y -= dy / this.zoom;
    this.followId = null;
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

  /** Płynne dogonienie śledzonego celu. */
  followTarget(tx: number, ty: number, smoothing = 0.15): void {
    this.x += (tx - this.x) * smoothing;
    this.y += (ty - this.y) * smoothing;
  }

  fitWorld(worldSize: number): void {
    this.x = worldSize / 2;
    this.y = worldSize / 2;
    this.zoom = clamp(
      Math.min(this.viewWidth, this.viewHeight) / (worldSize * 1.05),
      this.minZoom,
      this.maxZoom,
    );
    this.followId = null;
  }
}
