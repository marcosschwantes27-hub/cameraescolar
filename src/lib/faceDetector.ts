export interface FacePositionAssessment {
  detected: boolean;
  insideOval: boolean;
  centered: boolean;
  appropriateDistance: boolean; // Not too far, not too close
  lightingGood: boolean;
  confidence: number;
  message: string;
  detectedPose: "front" | "left" | "right" | "up" | "down";
  poseConfidence: number;
  horizontalAngleScore: number; // -1 (far left) to +1 (far right)
  verticalAngleScore: number; // -1 (far up) to +1 (far down)
}

/**
 * Analyzes video feed frame for Face ID oval target alignment and 3D head pose orientation.
 * Uses anatomical human head oval aspect ratio and facial mass/gradient asymmetry analysis.
 */
export function analyzeFaceInOval(
  video: HTMLVideoElement,
  tempCanvas?: HTMLCanvasElement
): FacePositionAssessment {
  if (!video || video.videoWidth === 0 || video.videoHeight === 0) {
    return {
      detected: false,
      insideOval: false,
      centered: false,
      appropriateDistance: false,
      lightingGood: false,
      confidence: 0,
      message: "Posicione o rosto dentro do contorno oval",
      detectedPose: "front",
      poseConfidence: 0,
      horizontalAngleScore: 0,
      verticalAngleScore: 0,
    };
  }

  const canvas = tempCanvas || document.createElement("canvas");
  const sampleW = 80;
  const sampleH = 104; // 3:4 anatomical face ratio
  canvas.width = sampleW;
  canvas.height = sampleH;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) {
    return {
      detected: false,
      insideOval: false,
      centered: false,
      appropriateDistance: false,
      lightingGood: false,
      confidence: 0,
      message: "Aguardando câmera...",
      detectedPose: "front",
      poseConfidence: 0,
      horizontalAngleScore: 0,
      verticalAngleScore: 0,
    };
  }

  const srcW = video.videoWidth;
  const srcH = video.videoHeight;

  // Crop central area respecting aspect ratio
  const targetAspect = sampleW / sampleH;
  let cropW = srcW;
  let cropH = srcW / targetAspect;
  if (cropH > srcH) {
    cropH = srcH;
    cropW = srcH * targetAspect;
  }
  const startX = (srcW - cropW) / 2;
  const startY = (srcH - cropH) / 2;

  ctx.drawImage(video, startX, startY, cropW, cropH, 0, 0, sampleW, sampleH);
  const imgData = ctx.getImageData(0, 0, sampleW, sampleH);
  const data = imgData.data;

  const centerX = sampleW / 2;
  const centerY = sampleH / 2;
  const radiusX = sampleW * 0.42;
  const radiusY = sampleH * 0.44;

  let skinPixelsInOval = 0;
  let totalOvalPixels = 0;
  let skinPixelsOutsideOval = 0;
  let totalOutsidePixels = 0;

  let weightedSkinX = 0;
  let weightedSkinY = 0;
  let totalLuminanceInOval = 0;

  // Spatial quadrant counters for Pose (Yaw / Pitch) estimation
  let leftHalfSkin = 0;
  let rightHalfSkin = 0;
  let topHalfSkin = 0;
  let bottomHalfSkin = 0;

  let leftHalfDarkness = 0;
  let rightHalfDarkness = 0;
  let topHalfDarkness = 0;
  let bottomHalfDarkness = 0;

  // Face color range heuristic in YCbCr color space (robust across diverse skin tones)
  for (let y = 0; y < sampleH; y++) {
    for (let x = 0; x < sampleW; x++) {
      const idx = (y * sampleW + x) * 4;
      const r = data[idx];
      const g = data[idx + 1];
      const b = data[idx + 2];

      const Y = 0.299 * r + 0.587 * g + 0.114 * b;
      const Cb = 128 - 0.168736 * r - 0.331264 * g + 0.5 * b;
      const Cr = 128 + 0.5 * r - 0.418688 * g - 0.081312 * b;

      // Distance normalized for ellipse equation: (x/rx)^2 + (y/ry)^2 <= 1
      const normalizedDistSq = ((x - centerX) / radiusX) ** 2 + ((y - centerY) / radiusY) ** 2;
      const isInside = normalizedDistSq <= 1.0;

      // YCbCr skin tone detection envelope
      const isSkin =
        Cb >= 77 &&
        Cb <= 135 &&
        Cr >= 130 &&
        Cr <= 178 &&
        Y >= 35 &&
        Y <= 245;

      const isFeatureDark = Y < 80; // Eye sockets, brows, nostrils, mouth

      if (isInside) {
        totalOvalPixels++;
        totalLuminanceInOval += Y;
        if (isSkin) {
          skinPixelsInOval++;
          weightedSkinX += x;
          weightedSkinY += y;

          if (x < centerX) leftHalfSkin++;
          else rightHalfSkin++;

          if (y < centerY) topHalfSkin++;
          else bottomHalfSkin++;
        }

        if (isFeatureDark) {
          if (x < centerX) leftHalfDarkness++;
          else rightHalfDarkness++;
          if (y < centerY) topHalfDarkness++;
          else bottomHalfDarkness++;
        }
      } else {
        totalOutsidePixels++;
        if (isSkin) {
          skinPixelsOutsideOval++;
        }
      }
    }
  }

  const avgLuminance = totalLuminanceInOval / (totalOvalPixels || 1);
  const lightingGood = avgLuminance >= 40 && avgLuminance <= 230;

  const skinRatioInOval = skinPixelsInOval / (totalOvalPixels || 1);
  const skinRatioOutside = skinPixelsOutsideOval / (totalOutsidePixels || 1);

  if (skinRatioInOval < 0.16) {
    return {
      detected: false,
      insideOval: false,
      centered: false,
      appropriateDistance: false,
      lightingGood,
      confidence: 0.1,
      message: "Posicione o rosto dentro do contorno oval",
      detectedPose: "front",
      poseConfidence: 0,
      horizontalAngleScore: 0,
      verticalAngleScore: 0,
    };
  }

  // Calculate center of mass of the detected face
  const avgSkinX = weightedSkinX / skinPixelsInOval;
  const avgSkinY = weightedSkinY / skinPixelsInOval;
  const offsetFromCenterX = (avgSkinX - centerX) / radiusX;
  const offsetFromCenterY = (avgSkinY - centerY) / radiusY;
  const offsetDist = Math.sqrt(offsetFromCenterX ** 2 + offsetFromCenterY ** 2);

  // Check distance (skin occupancy ratio inside oval)
  const tooFar = skinRatioInOval < 0.26;
  const tooClose = skinRatioInOval > 0.90;
  const appropriateDistance = !tooFar && !tooClose;

  // Centered if center of mass is within reasonable boundary of oval center
  const centered = offsetDist <= 0.35;

  // Face is inside oval if mostly centered and well proportioned
  const insideOval = centered && appropriateDistance && (skinRatioInOval > skinRatioOutside * 0.82);

  // ----------------------------------------------------
  // Head Pose (Yaw / Pitch) Estimation
  // ----------------------------------------------------
  // Note: in a user-facing mirrored preview (CSS scaleX(-1)):
  // - Turning face to user's left moves skin mass & feature darkness towards raw-frame right (sampleW),
  //   which corresponds to screen-left for the user.
  // We compute score normalized from -1 (user's Left) to +1 (user's Right):
  const rawHorizSkinDiff = (rightHalfSkin - leftHalfSkin) / ((leftHalfSkin + rightHalfSkin) || 1);
  const rawHorizDarkDiff = (rightHalfDarkness - leftHalfDarkness) / ((leftHalfDarkness + rightHalfDarkness) || 1);
  // In mirrored view: positive rawHorizDiff means user turned to their LEFT on screen
  const horizontalAngleScore = rawHorizSkinDiff * 0.6 + rawHorizDarkDiff * 0.4 + offsetFromCenterX * 0.5;

  const rawVertSkinDiff = (bottomHalfSkin - topHalfSkin) / ((topHalfSkin + bottomHalfSkin) || 1);
  const rawVertDarkDiff = (bottomHalfDarkness - topHalfDarkness) / ((topHalfDarkness + bottomHalfDarkness) || 1);
  const verticalAngleScore = rawVertSkinDiff * 0.5 + rawVertDarkDiff * 0.3 + offsetFromCenterY * 0.5;

  // Determine detected pose from scores
  let detectedPose: "front" | "left" | "right" | "up" | "down";
  let poseConfidence: number;

  const YAW_THRESHOLD = 0.16;
  const PITCH_THRESHOLD = 0.18;

  if (Math.abs(horizontalAngleScore) > Math.abs(verticalAngleScore)) {
    if (horizontalAngleScore > YAW_THRESHOLD) {
      detectedPose = "left";
      poseConfidence = Math.min(1, (horizontalAngleScore - YAW_THRESHOLD) / 0.3 + 0.6);
    } else if (horizontalAngleScore < -YAW_THRESHOLD) {
      detectedPose = "right";
      poseConfidence = Math.min(1, (-horizontalAngleScore - YAW_THRESHOLD) / 0.3 + 0.6);
    } else {
      detectedPose = "front";
      poseConfidence = Math.max(0.6, 1 - Math.abs(horizontalAngleScore) * 2.5);
    }
  } else {
    if (verticalAngleScore < -PITCH_THRESHOLD) {
      detectedPose = "up";
      poseConfidence = Math.min(1, (-verticalAngleScore - PITCH_THRESHOLD) / 0.3 + 0.6);
    } else if (verticalAngleScore > PITCH_THRESHOLD) {
      detectedPose = "down";
      poseConfidence = Math.min(1, (verticalAngleScore - PITCH_THRESHOLD) / 0.3 + 0.6);
    } else {
      detectedPose = "front";
      poseConfidence = Math.max(0.6, 1 - Math.abs(verticalAngleScore) * 2.5);
    }
  }

  let message = "Rosto encaixado!";
  if (!lightingGood) {
    message = avgLuminance < 40 ? "Ambiente muito escuro" : "Muita luz direta";
  } else if (tooFar) {
    message = "Aproxime o rosto";
  } else if (tooClose) {
    message = "Afaste um pouco o rosto";
  } else if (offsetFromCenterX < -0.32) {
    message = "Mova um pouco para a direita";
  } else if (offsetFromCenterX > 0.32) {
    message = "Mova um pouco para a esquerda";
  } else if (offsetFromCenterY < -0.32) {
    message = "Abaixe um pouco o rosto";
  } else if (offsetFromCenterY > 0.32) {
    message = "Levante um pouco o rosto";
  } else if (insideOval) {
    message = "Rosto alinhado no contorno";
  }

  const confidence = Math.min(
    1,
    Math.max(0, skinRatioInOval * 1.1 * (1 - offsetDist * 0.4))
  );

  return {
    detected: true,
    insideOval,
    centered,
    appropriateDistance,
    lightingGood,
    confidence,
    message,
    detectedPose,
    poseConfidence,
    horizontalAngleScore,
    verticalAngleScore,
  };
}

/**
 * Checks if the student is currently matching the requested enrollment pose.
 */
export function checkPoseMatch(
  assessment: FacePositionAssessment,
  targetPose: "front" | "left" | "right" | "up" | "down"
): { matches: boolean; instruction: string; feedback: string } {
  if (!assessment.detected) {
    return {
      matches: false,
      instruction: "Posicione o rosto dentro do contorno oval",
      feedback: "Câmera procurando rosto...",
    };
  }

  if (!assessment.insideOval) {
    return {
      matches: false,
      instruction: assessment.message,
      feedback: "Encaixe o rosto no contorno",
    };
  }

  const detected = assessment.detectedPose;

  if (targetPose === "front") {
    if (detected === "front") {
      return {
        matches: true,
        instruction: "Perfeito! Olhe para a frente",
        feedback: "Posição frontal confirmada ✓",
      };
    }
    return {
      matches: false,
      instruction: "Olhe diretamente para a frente",
      feedback: `Detectado: ${poseLabel(detected)}. Centralize o olhar.`,
    };
  }

  if (targetPose === "left") {
    if (detected === "left") {
      return {
        matches: true,
        instruction: "Ótimo! Mantendo para a esquerda",
        feedback: "Giro para a esquerda identificado ✓",
      };
    }
    return {
      matches: false,
      instruction: "Vire o rosto para a ESQUERDA",
      feedback: `Aguardando virar para esquerda... (Atual: ${poseLabel(detected)})`,
    };
  }

  if (targetPose === "right") {
    if (detected === "right") {
      return {
        matches: true,
        instruction: "Ótimo! Mantendo para a direita",
        feedback: "Giro para a direita identificado ✓",
      };
    }
    return {
      matches: false,
      instruction: "Vire o rosto para a DIREITA",
      feedback: `Aguardando virar para direita... (Atual: ${poseLabel(detected)})`,
    };
  }

  if (targetPose === "up") {
    if (detected === "up") {
      return {
        matches: true,
        instruction: "Ótimo! Mantendo queixo para cima",
        feedback: "Inclinação para cima identificada ✓",
      };
    }
    return {
      matches: false,
      instruction: "Incline o queixo levemente para CIMA",
      feedback: `Aguardando inclinar para cima... (Atual: ${poseLabel(detected)})`,
    };
  }

  if (targetPose === "down") {
    if (detected === "down") {
      return {
        matches: true,
        instruction: "Ótimo! Mantendo queixo para baixo",
        feedback: "Inclinação para baixo identificada ✓",
      };
    }
    return {
      matches: false,
      instruction: "Incline o queixo levemente para BAIXO",
      feedback: `Aguardando inclinar para baixo... (Atual: ${poseLabel(detected)})`,
    };
  }

  return { matches: false, instruction: "Ajuste a posição do rosto", feedback: "" };
}

function poseLabel(pose: "front" | "left" | "right" | "up" | "down"): string {
  switch (pose) {
    case "front": return "Frente";
    case "left": return "Esquerda";
    case "right": return "Direita";
    case "up": return "Para Cima";
    case "down": return "Para Baixo";
  }
}
