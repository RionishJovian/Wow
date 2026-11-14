import "./style.css";
import { GameEngine } from "./engine/GameEngine";
const root = document.querySelector<HTMLElement>("#app")!;
try {
  const game = new GameEngine(root);
  Object.assign(window, { emberfall: game });
  window.addEventListener("pagehide", () => game.dispose(), { once: true });
} catch (error) {
  root.innerHTML =
    '<div class="boot-error"><h1>The Reach could not awaken.</h1><p>A browser with WebGL2 support is required. Please enable hardware acceleration and reload.</p></div>';
  console.error(error);
}
