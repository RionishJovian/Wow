import * as T from "three";
export class CameraControls {
  keys = new Set<string>();
  yaw = 0;
  pitch = 0.58;
  distance = 13;
  drag = false;
  private abort = new AbortController();
  constructor(
    public camera: T.PerspectiveCamera,
    private canvas: HTMLCanvasElement,
  ) {
    const signal = this.abort.signal;
    window.addEventListener(
      "keydown",
      (e) => {
        if (
          [
            "Space",
            "Tab",
            "Digit1",
            "Digit2",
            "Digit3",
            "Digit4",
            "Digit5",
            "Digit6",
          ].includes(e.code)
        )
          e.preventDefault();
        this.keys.add(e.code);
      },
      { signal },
    );
    window.addEventListener("keyup", (e) => this.keys.delete(e.code), {
      signal,
    });
    window.addEventListener(
      "blur",
      () => {
        this.keys.clear();
        this.drag = false;
      },
      { signal },
    );
    canvas.addEventListener("contextmenu", (e) => e.preventDefault(), {
      signal,
    });
    canvas.addEventListener(
      "pointerdown",
      (e) => {
        if (e.button === 2) {
          this.drag = true;
          canvas.setPointerCapture(e.pointerId);
        }
      },
      { signal },
    );
    canvas.addEventListener("pointerup", () => (this.drag = false), { signal });
    canvas.addEventListener(
      "pointermove",
      (e) => {
        if (this.drag) {
          this.yaw -= e.movementX * 0.006;
          this.pitch = T.MathUtils.clamp(
            this.pitch + e.movementY * 0.004,
            0.15,
            1.2,
          );
        }
      },
      { signal },
    );
    canvas.addEventListener(
      "wheel",
      (e) => {
        e.preventDefault();
        this.distance = T.MathUtils.clamp(
          this.distance + e.deltaY * 0.015,
          5,
          23,
        );
      },
      { signal, passive: false },
    );
  }
  update(position: T.Vector3, dt: number) {
    const target = position.clone().add(new T.Vector3(0, 1.2, 0));
    const desired = new T.Vector3(
      Math.sin(this.yaw) * Math.cos(this.pitch),
      Math.sin(this.pitch),
      Math.cos(this.yaw) * Math.cos(this.pitch),
    )
      .multiplyScalar(this.distance)
      .add(target);
    this.camera.position.lerp(desired, 1 - Math.exp(-dt * 12));
    this.camera.lookAt(target);
  }
  dispose() {
    this.abort.abort();
    this.keys.clear();
  }
}
