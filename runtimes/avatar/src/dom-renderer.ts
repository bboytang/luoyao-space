import type { AvatarRenderer, AvatarState } from "./runtime";
import { toAvatarRenderModel } from "./render-model";
import { LUOYAO_AVATAR_CSS } from "./avatar-css";

export interface DomAvatarRendererOptions {
  root: HTMLElement;
}

/** Minimal dependency-free browser renderer for the first interactive avatar shell. */
export class DomAvatarRenderer implements AvatarRenderer {
  private readonly root: HTMLElement;
  private readonly character: HTMLDivElement;
  private readonly face: HTMLDivElement;
  private readonly mouth: HTMLDivElement;
  private readonly status: HTMLDivElement;
  private readonly style: HTMLStyleElement;

  constructor(options: DomAvatarRendererOptions) {
    this.root = options.root;
    this.character = document.createElement("div");
    this.face = document.createElement("div");
    this.mouth = document.createElement("div");
    this.status = document.createElement("div");
    this.style = document.createElement("style");

    this.character.setAttribute("data-avatar", "luoyao");
    this.face.setAttribute("data-avatar-face", "true");
    this.mouth.setAttribute("data-avatar-mouth", "true");
    this.status.setAttribute("data-avatar-status", "true");
    this.style.setAttribute("data-luoyao-avatar-style", "true");
    this.style.textContent = LUOYAO_AVATAR_CSS;

    this.character.append(this.face, this.mouth, this.status);
    if (!this.root.querySelector("[data-luoyao-avatar-style]")) this.root.appendChild(this.style);
    this.root.appendChild(this.character);
  }

  render(state: Readonly<AvatarState>): void {
    const model = toAvatarRenderModel(state);
    this.character.dataset.emotion = model.emotion;
    this.character.dataset.expression = model.expression;
    this.character.dataset.activity = model.activity;
    this.character.dataset.gesture = model.gesture;
    this.character.style.setProperty("--avatar-emotion-intensity", String(model.emotionIntensity));
    this.character.style.setProperty("--avatar-mouth-open", String(model.mouthOpen));
    this.character.style.setProperty("--avatar-gaze-x", String(model.gaze.x));
    this.character.style.setProperty("--avatar-gaze-y", String(model.gaze.y));
    this.character.setAttribute("aria-label", `Luoyao ${model.activity}`);
    this.status.textContent = model.speaking ? "speaking" : model.activity;
  }

  dispose(): void {
    this.character.remove();
    if (this.style.parentElement === this.root && !this.root.querySelector("[data-avatar=\"luoyao\"]")) this.style.remove();
  }
}
