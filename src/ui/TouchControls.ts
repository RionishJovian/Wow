import { CameraControls } from "../engine/CameraControls";
import { AbilitySystem } from "../combat/AbilitySystem";

/** Independent touch state preserves keyboard input during multi-touch play. */
export class TouchControls {
  keys = new Set<string>();
  private root = document.createElement("div");
  private abort = new AbortController();
  constructor(
    camera: CameraControls,
    combat: AbilitySystem,
    interact: () => void,
  ) {
    this.root.className = "touch-controls";
    this.root.innerHTML = `<div class="touch-stick" aria-label="Movement joystick"><span>MOVE</span><i></i></div><div class="touch-look" aria-label="Drag to orbit camera">LOOK ↔</div><div class="touch-arc"><button data-action="target" aria-label="Next target">◎<small>Target</small></button><button data-action="jump" aria-label="Jump">↑<small>Jump</small></button><button data-action="interact" aria-label="Interact">✦<small>Interact</small></button></div><div class="touch-zoom"><button data-action="in" aria-label="Zoom in">+</button><button data-action="out" aria-label="Zoom out">−</button></div>`;
    document.body.append(this.root);
    const signal = this.abort.signal;
    const stick = this.root.querySelector<HTMLElement>(".touch-stick")!;
    const knob = stick.querySelector<HTMLElement>("i")!;
    const look = this.root.querySelector<HTMLElement>(".touch-look")!;
    let stickId: number | undefined,
      lookId: number | undefined,
      jumpId: number | undefined;
    let lastX = 0,
      lastY = 0;
    const clearMovement = () => {
      for (const key of ["KeyW", "KeyS", "KeyA", "KeyD"]) this.keys.delete(key);
      knob.style.transform = "";
    };
    const move = (e: PointerEvent) => {
      const r = stick.getBoundingClientRect();
      let x = (e.clientX - r.left - r.width / 2) / 40,
        y = (e.clientY - r.top - r.height / 2) / 40;
      const length = Math.max(1, Math.hypot(x, y));
      x /= length;
      y /= length;
      clearMovement();
      if (x < -0.2) this.keys.add("KeyA");
      if (x > 0.2) this.keys.add("KeyD");
      if (y < -0.2) this.keys.add("KeyW");
      if (y > 0.2) this.keys.add("KeyS");
      knob.style.transform = `translate(${x * 34}px,${y * 34}px)`;
    };
    stick.addEventListener(
      "pointerdown",
      (e) => {
        if (stickId !== undefined) return;
        e.preventDefault();
        stickId = e.pointerId;
        stick.setPointerCapture(e.pointerId);
        move(e);
      },
      { signal },
    );
    stick.addEventListener(
      "pointermove",
      (e) => {
        if (e.pointerId === stickId) move(e);
      },
      { signal },
    );
    const releaseStick = (e: PointerEvent) => {
      if (e.pointerId === stickId) {
        stickId = undefined;
        clearMovement();
      }
    };
    for (const event of [
      "pointerup",
      "pointercancel",
      "lostpointercapture",
    ] as const)
      stick.addEventListener(event, releaseStick, { signal });
    look.addEventListener(
      "pointerdown",
      (e) => {
        if (lookId !== undefined) return;
        e.preventDefault();
        lookId = e.pointerId;
        lastX = e.clientX;
        lastY = e.clientY;
        look.setPointerCapture(e.pointerId);
      },
      { signal },
    );
    look.addEventListener(
      "pointermove",
      (e) => {
        if (e.pointerId !== lookId) return;
        camera.yaw -= (e.clientX - lastX) * 0.008;
        camera.pitch = Math.max(
          0.15,
          Math.min(1.2, camera.pitch + (e.clientY - lastY) * 0.006),
        );
        lastX = e.clientX;
        lastY = e.clientY;
      },
      { signal },
    );
    const releaseLook = (e: PointerEvent) => {
      if (e.pointerId === lookId) lookId = undefined;
    };
    for (const event of [
      "pointerup",
      "pointercancel",
      "lostpointercapture",
    ] as const)
      look.addEventListener(event, releaseLook, { signal });
    const jump = this.root.querySelector<HTMLElement>('[data-action="jump"]')!;
    jump.addEventListener(
      "pointerdown",
      (e) => {
        if (jumpId !== undefined) return;
        e.preventDefault();
        jumpId = e.pointerId;
        jump.setPointerCapture(e.pointerId);
        this.keys.add("Space");
      },
      { signal },
    );
    const releaseJump = (e: PointerEvent) => {
      if (e.pointerId === jumpId) {
        jumpId = undefined;
        this.keys.delete("Space");
      }
    };
    for (const event of [
      "pointerup",
      "pointercancel",
      "lostpointercapture",
    ] as const)
      jump.addEventListener(event, releaseJump, { signal });
    this.root.addEventListener(
      "click",
      (e) => {
        const action = (e.target as HTMLElement).closest<HTMLElement>("button")
          ?.dataset.action;
        if (action === "target") combat.tab();
        if (action === "interact") interact();
        if (action === "in") camera.distance = Math.max(5, camera.distance - 2);
        if (action === "out")
          camera.distance = Math.min(23, camera.distance + 2);
      },
      { signal },
    );
    const reset = () => {
      stickId = lookId = jumpId = undefined;
      this.keys.clear();
      knob.style.transform = "";
    };
    window.addEventListener("blur", reset, { signal });
    document.addEventListener(
      "visibilitychange",
      () => {
        if (document.hidden) reset();
      },
      { signal },
    );
  }
  dispose() {
    this.abort.abort();
    this.keys.clear();
    this.root.remove();
  }
}
