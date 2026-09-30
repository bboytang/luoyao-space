import type { AvatarRenderModel } from "./render-model";

export interface AvatarMotion {
  headTilt: number;
  bodyOffsetY: number;
  bodyRotation: number;
  gestureScale: number;
  gesturePhase: number;
}

/** Converts semantic avatar gestures into normalized presentation motion. */
export function toAvatarMotion(model: Readonly<AvatarRenderModel>, phase = 0): AvatarMotion {
  const wave = Math.sin(phase * Math.PI * 2);
  switch (model.gesture) {
    case "listen":
      return { headTilt: 0.08, bodyOffsetY: -0.01, bodyRotation: -0.01, gestureScale: 0.96, gesturePhase: wave };
    case "think":
      return { headTilt: 0.06, bodyOffsetY: -0.015, bodyRotation: 0.015, gestureScale: 0.98, gesturePhase: wave };
    case "speak":
      return { headTilt: wave * 0.025, bodyOffsetY: -0.01, bodyRotation: wave * 0.012, gestureScale: 1 + Math.abs(wave) * 0.012, gesturePhase: wave };
    case "playful":
      return { headTilt: wave * 0.12, bodyOffsetY: -0.012, bodyRotation: wave * 0.025, gestureScale: 1 + Math.abs(wave) * 0.025, gesturePhase: wave };
    case "warm":
      return { headTilt: 0.025, bodyOffsetY: -0.008, bodyRotation: 0, gestureScale: 1.01, gesturePhase: wave };
    default:
      return { headTilt: 0, bodyOffsetY: 0, bodyRotation: 0, gestureScale: 1, gesturePhase: wave };
  }
}
