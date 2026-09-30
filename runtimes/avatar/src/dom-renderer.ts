import type { AvatarRenderer, AvatarState } from "./runtime";
import { toAvatarRenderModel } from "./render-model";

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

  constructor(options: DomAvatarRendererOptions) {
    this.root = options.root;
    this.character = document.createElement("div");
    this.face = document.createElement("div");
    this.mouth = document.createElement("div");
    this.status = document.createElement("div");

    this.character.setAttribute("data-avatar", "luoyao");
    this.face.setAttribute("data-avatar-face", "true");
    this.mouth.setAttribute("data-avatar-mouth", "true");
    this.status.setAttribute("data-avatar-status", "true");

    this.character.append(this.face, this.mouth, this.status);
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
  }
}
