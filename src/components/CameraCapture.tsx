import { useEffect, useRef, useState, useCallback } from "react";
import type { EnrollmentPose, FaceCaptureFrame } from "../domain/face";
import {
  analyzeFaceInOval,
  checkPoseMatch,
  type FacePositionAssessment,
} from "../lib/faceDetector";
import { Icon } from "./Icons";

interface CameraCaptureProps {
  captureLabel: string;
  captureMode?: "burst" | "guided";
  disabled?: boolean;
  disabledReason?: string;
  autoStart?: boolean;
  variant?: "default" | "fullscreen" | "kiosk";
  autoCaptureOnOvalFit?: boolean;
  onCancel?: () => void;
  onCapture: (frames: FaceCaptureFrame[]) => Promise<void>;
}

type CameraState =
  | { kind: "idle" }
  | { kind: "requesting" }
  | { kind: "ready" }
  | {
      kind: "capturing";
      captured: number;
      total: number;
      stepIndex: number | null;
      countdown: number | null;
    }
  | { kind: "error"; message: string };

const BURST_FRAME_COUNT = 5;
const FRAMES_PER_POSE = 3;

const GUIDED_STEPS: ReadonlyArray<{
  pose: EnrollmentPose;
  label: string;
  instruction: string;
  actionGuide: string;
}> = [
  {
    pose: "front",
    label: "Frente",
    instruction: "Olhe diretamente para a frente",
    actionGuide: "Centralize o rosto no contorno oval",
  },
  {
    pose: "left",
    label: "Esquerda",
    instruction: "Vire o rosto para a ESQUERDA",
    actionGuide: "Gire a cabeça suavemente para o lado esquerdo",
  },
  {
    pose: "right",
    label: "Direita",
    instruction: "Vire o rosto para a DIREITA",
    actionGuide: "Gire a cabeça suavemente para o lado direito",
  },
  {
    pose: "up",
    label: "Para Cima",
    instruction: "Incline o queixo para CIMA",
    actionGuide: "Incline levemente a cabeça para o alto",
  },
  {
    pose: "down",
    label: "Para Baixo",
    instruction: "Incline o queixo para BAIXO",
    actionGuide: "Incline levemente a cabeça para baixo",
  },
];

function wait(milliseconds: number) {
  return new Promise<void>((resolve) => window.setTimeout(resolve, milliseconds));
}

function playFaceIdChime(type: "tick" | "success" | "lock") {
  try {
    const AudioContextClass =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AudioContextClass) return;
    const ctx = new AudioContextClass();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.connect(gain);
    gain.connect(ctx.destination);

    if (type === "tick") {
      osc.type = "sine";
      osc.frequency.setValueAtTime(587.33, ctx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(880, ctx.currentTime + 0.08);
      gain.gain.setValueAtTime(0.08, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.08);
      osc.start(ctx.currentTime);
      osc.stop(ctx.currentTime + 0.08);
    } else if (type === "lock") {
      osc.type = "sine";
      osc.frequency.setValueAtTime(523.25, ctx.currentTime);
      osc.frequency.setValueAtTime(659.25, ctx.currentTime + 0.06);
      gain.gain.setValueAtTime(0.1, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.15);
      osc.start(ctx.currentTime);
      osc.stop(ctx.currentTime + 0.15);
    } else if (type === "success") {
      osc.type = "sine";
      osc.frequency.setValueAtTime(523.25, ctx.currentTime);
      osc.frequency.setValueAtTime(659.25, ctx.currentTime + 0.08);
      osc.frequency.setValueAtTime(783.99, ctx.currentTime + 0.16);
      osc.frequency.setValueAtTime(1046.5, ctx.currentTime + 0.24);
      gain.gain.setValueAtTime(0.12, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.35);
      osc.start(ctx.currentTime);
      osc.stop(ctx.currentTime + 0.35);
    }
  } catch {
    // Audio playback fallback
  }
}

function canvasBlob(canvas: HTMLCanvasElement) {
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("Não foi possível capturar a imagem."))),
      "image/jpeg",
      0.9
    );
  });
}

export function CameraCapture({
  captureLabel,
  captureMode = "guided",
  disabled = false,
  disabledReason,
  autoStart = false,
  variant = "default",
  autoCaptureOnOvalFit = false,
  onCancel,
  onCapture,
}: CameraCaptureProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const mountedRef = useRef(true);
  const animFrameRef = useRef<number | null>(null);

  const [state, setState] = useState<CameraState>({ kind: "idle" });
  const [cameras, setCameras] = useState<MediaDeviceInfo[]>([]);
  const [selectedCameraId, setSelectedCameraId] = useState("");
  const [activeGuidedStepIndex, setActiveGuidedStepIndex] = useState<number | null>(null);
  const poseHoldProgressRef = useRef(0);
  const [clockString, setClockString] = useState("");

  const [faceAssessment, setFaceAssessment] = useState<FacePositionAssessment>({
    detected: false,
    insideOval: false,
    centered: false,
    appropriateDistance: false,
    lightingGood: true,
    confidence: 0,
    message: "Posicione o rosto dentro do contorno oval",
    detectedPose: "front",
    poseConfidence: 0,
    horizontalAngleScore: 0,
    verticalAngleScore: 0,
  });

  const capturedFramesRef = useRef<FaceCaptureFrame[]>([]);
  const isExecutingStepRef = useRef(false);

  // Update live clock for kiosk header
  useEffect(() => {
    const updateTime = () => {
      const d = new Date();
      setClockString(
        d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", second: "2-digit" })
      );
    };
    updateTime();
    const interval = window.setInterval(updateTime, 1000);
    return () => clearInterval(interval);
  }, []);

  function stopCamera() {
    if (animFrameRef.current) {
      cancelAnimationFrame(animFrameRef.current);
      animFrameRef.current = null;
    }
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    setActiveGuidedStepIndex(null);
    poseHoldProgressRef.current = 0;
    isExecutingStepRef.current = false;
  }

  const startCamera = useCallback(async (cameraId = selectedCameraId) => {
    if (!navigator.mediaDevices?.getUserMedia) {
      setState({ kind: "error", message: "Este navegador não permite acesso à câmera." });
      return;
    }
    setState({ kind: "requesting" });
    try {
      stopCamera();
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: cameraId
          ? {
              deviceId: { exact: cameraId },
              width: { ideal: 1280 },
              height: { ideal: 720 },
            }
          : {
              facingMode: "user",
              width: { ideal: 1280 },
              height: { ideal: 720 },
            },
      });
      if (!mountedRef.current) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      const activeCameraId = stream.getVideoTracks()[0]?.getSettings().deviceId ?? cameraId;
      const devices = await navigator.mediaDevices.enumerateDevices();
      if (mountedRef.current) {
        setCameras(devices.filter((device) => device.kind === "videoinput"));
        setSelectedCameraId(activeCameraId);
        setState({ kind: "ready" });
      }
    } catch (error) {
      const denied = error instanceof DOMException && error.name === "NotAllowedError";
      const unavailable =
        error instanceof DOMException &&
        (error.name === "NotFoundError" || error.name === "NotReadableError");
      setState({
        kind: "error",
        message: denied
          ? "Permita o uso da câmera no navegador para continuar."
          : unavailable
          ? "A câmera selecionada não está disponível. Verifique a conexão."
          : "Não foi possível iniciar a câmera.",
      });
    }
  }, [selectedCameraId]);

  // Captures the 3 frames for the current verified pose and advances to next
  const handleStepSuccess = useCallback(async (stepIndex: number) => {
    if (isExecutingStepRef.current) return;
    isExecutingStepRef.current = true;

    const video = videoRef.current;
    const step = GUIDED_STEPS[stepIndex];
    if (!video || !step) {
      isExecutingStepRef.current = false;
      return;
    }

    try {
      const canvas = document.createElement("canvas");
      canvas.width = Math.min(video.videoWidth, 960);
      canvas.height = Math.round(canvas.width * (video.videoHeight / video.videoWidth));
      const context = canvas.getContext("2d");
      if (!context) throw new Error("Falha ao preparar captura.");

      playFaceIdChime("lock");

      const total = GUIDED_STEPS.length * FRAMES_PER_POSE;

      // Capture frames for this confirmed pose
      for (let i = 0; i < FRAMES_PER_POSE; i++) {
        context.drawImage(video, 0, 0, canvas.width, canvas.height);
        const blob = await canvasBlob(canvas);
        capturedFramesRef.current.push({ image: blob, pose: step.pose });
        setState({
          kind: "capturing",
          captured: capturedFramesRef.current.length,
          total,
          stepIndex,
          countdown: null,
        });
        playFaceIdChime("tick");
        if (i < FRAMES_PER_POSE - 1) await wait(180);
      }

      const nextStepIndex = stepIndex + 1;
      poseHoldProgressRef.current = 0;

      if (nextStepIndex < GUIDED_STEPS.length) {
        setActiveGuidedStepIndex(nextStepIndex);
        isExecutingStepRef.current = false;
      } else {
        // All steps completed!
        playFaceIdChime("success");
        setState({
          kind: "capturing",
          captured: capturedFramesRef.current.length,
          total,
          stepIndex: null,
          countdown: null,
        });
        await onCapture(capturedFramesRef.current);
        stopCamera();
        if (mountedRef.current) setState({ kind: "idle" });
      }
    } catch (error) {
      isExecutingStepRef.current = false;
      if (mountedRef.current) {
        stopCamera();
        setState({
          kind: "error",
          message: error instanceof Error ? error.message : "Erro ao processar biometria.",
        });
      }
    }
  }, [onCapture]);

  // Initiates guided or burst capture
  const startEnrollmentFlow = useCallback(async () => {
    if (isExecutingStepRef.current) return;
    capturedFramesRef.current = [];
    poseHoldProgressRef.current = 0;

    if (captureMode === "guided") {
      setActiveGuidedStepIndex(0);
      setState({
        kind: "capturing",
        captured: 0,
        total: GUIDED_STEPS.length * FRAMES_PER_POSE,
        stepIndex: 0,
        countdown: null,
      });
    } else {
      // Burst mode
      const video = videoRef.current;
      if (!video) return;
      try {
        isExecutingStepRef.current = true;
        const canvas = document.createElement("canvas");
        canvas.width = Math.min(video.videoWidth, 960);
        canvas.height = Math.round(canvas.width * (video.videoHeight / video.videoWidth));
        const context = canvas.getContext("2d");
        if (!context) {
          isExecutingStepRef.current = false;
          return;
        }

        const frames: FaceCaptureFrame[] = [];
        playFaceIdChime("lock");

        for (let index = 0; index < BURST_FRAME_COUNT; index += 1) {
          setState({
            kind: "capturing",
            captured: index,
            total: BURST_FRAME_COUNT,
            stepIndex: null,
            countdown: null,
          });
          context.drawImage(video, 0, 0, canvas.width, canvas.height);
          frames.push({ image: await canvasBlob(canvas), pose: null });
          playFaceIdChime("tick");
          if (index < BURST_FRAME_COUNT - 1) await wait(220);
        }

        playFaceIdChime("success");
        await onCapture(frames);
        isExecutingStepRef.current = false;
        stopCamera();
        if (mountedRef.current) setState({ kind: "idle" });
      } catch (error) {
        isExecutingStepRef.current = false;
        if (mountedRef.current) {
          stopCamera();
          setState({
            kind: "error",
            message: error instanceof Error ? error.message : "Erro ao processar biometria.",
          });
        }
      }
    }
  }, [captureMode, onCapture]);

  // Real-time face tracking loop inside oval target with pose verification
  const runDetectionLoop = useCallback(() => {
    let lastCheck = 0;

    const checkFrame = (time: number) => {
      if (!mountedRef.current) return;
      if (
        time - lastCheck > 90 &&
        videoRef.current &&
        videoRef.current.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA
      ) {
        lastCheck = time;
        const result = analyzeFaceInOval(videoRef.current);
        setFaceAssessment(result);

        // If in guided mode and waiting for specific pose
        if (
          activeGuidedStepIndex !== null &&
          activeGuidedStepIndex < GUIDED_STEPS.length &&
          !isExecutingStepRef.current
        ) {
          const targetStep = GUIDED_STEPS[activeGuidedStepIndex];
          if (targetStep) {
            const poseMatch = checkPoseMatch(result, targetStep.pose);
            if (poseMatch.matches) {
              poseHoldProgressRef.current = Math.min(1, poseHoldProgressRef.current + 0.25);
              if (poseHoldProgressRef.current >= 1 && !isExecutingStepRef.current) {
                // Pose held successfully! Trigger capture of this pose step
                void handleStepSuccess(activeGuidedStepIndex);
              }
            } else {
              poseHoldProgressRef.current = Math.max(0, poseHoldProgressRef.current - 0.15);
            }
          }
        } else if (
          captureMode === "burst" &&
          autoCaptureOnOvalFit &&
          !isExecutingStepRef.current &&
          state.kind === "ready"
        ) {
          // Automatic capture in kiosk mode when face is comfortably fitted in the oval
          if (result.insideOval) {
            poseHoldProgressRef.current = Math.min(1, poseHoldProgressRef.current + 0.35);
            if (poseHoldProgressRef.current >= 1 && !isExecutingStepRef.current) {
              void startEnrollmentFlow();
            }
          } else {
            poseHoldProgressRef.current = Math.max(0, poseHoldProgressRef.current - 0.2);
          }
        }
      }
      animFrameRef.current = requestAnimationFrame(checkFrame);
    };

    animFrameRef.current = requestAnimationFrame(checkFrame);
  }, [
    activeGuidedStepIndex,
    autoCaptureOnOvalFit,
    captureMode,
    handleStepSuccess,
    startEnrollmentFlow,
    state.kind,
  ]);

  useEffect(() => {
    mountedRef.current = true;
    const refreshCameras = async () => {
      if (!navigator.mediaDevices?.enumerateDevices) return;
      const devices = await navigator.mediaDevices.enumerateDevices();
      if (mountedRef.current) {
        setCameras(devices.filter((device) => device.kind === "videoinput"));
      }
    };
    const handleDeviceChange = () => void refreshCameras();
    navigator.mediaDevices?.addEventListener?.("devicechange", handleDeviceChange);
    void refreshCameras();

    if (autoStart) {
      void startCamera();
    }

    return () => {
      mountedRef.current = false;
      navigator.mediaDevices?.removeEventListener?.("devicechange", handleDeviceChange);
      stopCamera();
    };
  }, [autoStart, startCamera]);

  // When state becomes ready, launch detection loop
  useEffect(() => {
    if (state.kind === "ready" || state.kind === "capturing") {
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
      runDetectionLoop();
    }
  }, [activeGuidedStepIndex, state.kind, runDetectionLoop]);

  async function changeCamera(cameraId: string) {
    setSelectedCameraId(cameraId);
    if (cameraActive) await startCamera(cameraId);
  }

  const cameraActive = state.kind === "ready" || state.kind === "capturing";
  const isCapturing = state.kind === "capturing";

  const currentTargetStep =
    activeGuidedStepIndex !== null ? GUIDED_STEPS[activeGuidedStepIndex] : null;
  const poseMatchResult = currentTargetStep
    ? checkPoseMatch(faceAssessment, currentTargetStep.pose)
    : null;

  const isProcessing = isCapturing && state.stepIndex === null && state.captured >= state.total;

  // Instructional texts based on live pose validation
  let instructionTitle = "Face ID Escolar";
  let instructionSubtitle = "Posicione o rosto dentro do contorno oval";

  if (!cameraActive) {
    instructionTitle = "Terminal Biométrico";
    instructionSubtitle = "Iniciando câmera para identificação facial...";
  } else if (isProcessing) {
    instructionTitle = "Identificando Aluno...";
    instructionSubtitle = "Consultando base biométrica da escola";
  } else if (isCapturing && captureMode === "burst") {
    instructionTitle = "Escaneando Rosto...";
    instructionSubtitle = "Permaneça olhando para a câmera";
  } else if (currentTargetStep && isCapturing) {
    instructionTitle = currentTargetStep.instruction;
    instructionSubtitle = poseMatchResult?.matches
      ? "Posição correta! Mantendo..."
      : poseMatchResult?.feedback || currentTargetStep.actionGuide;
  } else if (faceAssessment.insideOval) {
    instructionTitle = "Rosto Encaixado";
    instructionSubtitle = autoCaptureOnOvalFit
      ? "Identificando automaticamente..."
      : "Perfeito! Toque no botão para confirmar";
  } else if (faceAssessment.detected) {
    instructionTitle = faceAssessment.message;
    instructionSubtitle = "Ajuste o rosto para preencher o contorno oval";
  }

  const isPoseMatching = poseMatchResult?.matches || false;

  const ovalStateClass = !cameraActive
    ? "faceid-oval--offline"
    : isProcessing
    ? "faceid-oval--processing"
    : isCapturing && (captureMode === "burst" || isPoseMatching)
    ? "faceid-oval--matched"
    : isCapturing
    ? "faceid-oval--scanning"
    : faceAssessment.insideOval
    ? "faceid-oval--locked"
    : faceAssessment.detected
    ? "faceid-oval--adjusting"
    : "faceid-oval--searching";

  const isKioskMode = variant === "fullscreen" || variant === "kiosk";

  return (
    <section
      className={`faceid-enrollment-card ${isKioskMode ? "faceid-kiosk-mode-wrapper" : ""}`}
      aria-label="Cadastro de Face ID"
    >
      {/* Kiosk Mode Floating Top Header Bar */}
      {isKioskMode && (
        <div className="faceid-kiosk-topbar">
          <div className="faceid-kiosk-top-left">
            {onCancel && (
              <button className="faceid-kiosk-btn-back" onClick={onCancel} type="button">
                <Icon name="arrow" style={{ transform: "rotate(180deg)" }} />
                <span>Cancelar</span>
              </button>
            )}
            <div className="faceid-kiosk-brand">
              <span className="faceid-kiosk-dot" />
              <strong>Terminal Kiosk · Modo Tablet</strong>
            </div>
          </div>

          <div className="faceid-kiosk-top-center">
            <span className="faceid-kiosk-time">{clockString}</span>
          </div>

          <div className="faceid-kiosk-top-right">
            {cameras.length > 1 && (
              <div className="faceid-camera-picker faceid-camera-picker--kiosk">
                <select
                  aria-label="Selecionar câmera"
                  disabled={state.kind === "requesting" || isCapturing}
                  onChange={(e) => void changeCamera(e.target.value)}
                  value={selectedCameraId}
                >
                  {cameras.map((camera, index) => (
                    <option key={camera.deviceId} value={camera.deviceId}>
                      {camera.label || `Câmera ${index + 1}`}
                    </option>
                  ))}
                </select>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Face ID Stage Viewport */}
      <div
        className={`faceid-viewport faceid-viewport--oval ${ovalStateClass} ${
          isKioskMode ? "faceid-viewport--kiosk-fullscreen" : ""
        }`}
      >
        {/* Video feed element */}
        <video
          aria-label="Imagem da câmera"
          className={`faceid-video-feed ${isKioskMode ? "faceid-video-feed--fullscreen" : ""}`}
          muted
          playsInline
          ref={videoRef}
        />

        {/* Outer Dark Mask with Anatomical Oval Frame */}
        <div className="faceid-oval-mask">
          {/* Static Oval Dashed Guide Track */}
          <svg className="faceid-oval-svg" viewBox="0 0 300 400" aria-hidden="true">
            <ellipse cx="150" cy="200" rx="120" ry="165" className="faceid-oval-guide-track" />
          </svg>

          {/* Central Target Face Silhouette when Camera is Off */}
          {!cameraActive && (
            <div className="faceid-offline-placeholder">
              <div className="faceid-face-icon">
                <Icon name="face_id" />
              </div>
              <span>{state.kind === "requesting" ? "Ativando câmera..." : "Câmera Desativada"}</span>
            </div>
          )}
        </div>
      </div>

      {/* Instructional Feedback Panel */}
      <div className={`faceid-instructions ${isKioskMode ? "faceid-instructions--kiosk" : ""}`}>
        <h3 className="faceid-title">{instructionTitle}</h3>
        <p
          className={`faceid-subtitle ${
            isCapturing && !isPoseMatching && captureMode === "guided"
              ? "faceid-subtitle--alert"
              : ""
          }`}
        >
          {instructionSubtitle}
        </p>

        {/* Step dots for guided multi-angle registration */}
        {captureMode === "guided" && (
          <div className="faceid-steps-bar" aria-label="Progresso de posições">
            {GUIDED_STEPS.map((step, idx) => {
              const currentStepIdx = activeGuidedStepIndex;
              const isCompleted =
                isProcessing || (currentStepIdx !== null && idx < currentStepIdx);
              const isActive = currentStepIdx === idx;
              return (
                <div
                  key={step.pose}
                  className={`faceid-step-pill ${
                    isCompleted
                      ? "faceid-step-pill--completed"
                      : isActive
                      ? "faceid-step-pill--active"
                      : ""
                  }`}
                  title={`${step.label}: ${step.instruction}`}
                >
                  <span>{isCompleted ? "✓" : idx + 1}</span>
                  <small>{step.label}</small>
                </div>
              );
            })}
          </div>
        )}

        {/* Real-time Pose Feedback status bar */}
        {isCapturing && currentTargetStep && (
          <div
            className={`faceid-pose-status-banner ${
              isPoseMatching ? "faceid-pose-status-banner--ok" : "faceid-pose-status-banner--waiting"
            }`}
          >
            <span className="faceid-status-pulse" />
            <strong>
              {isPoseMatching
                ? `Posição correta (${currentTargetStep.label})! Mantenha firme...`
                : `Aguardando posição: ${currentTargetStep.label} (${
                    faceAssessment.detectedPose
                      ? `Detectado: ${faceAssessment.detectedPose}`
                      : "Procurando..."
                  })`}
            </strong>
          </div>
        )}
      </div>

      {/* Error Message if any */}
      {state.kind === "error" && (
        <div
          className={`inline-message inline-message--error ${
            isKioskMode ? "faceid-kiosk-error" : ""
          }`}
          role="alert"
        >
          {state.message}
        </div>
      )}

      {/* Requirement Notice if form incomplete */}
      {cameraActive && disabled && disabledReason && (
        <div className="capture-requirement" role="status">
          <Icon name="info" />
          <span>{disabledReason}</span>
        </div>
      )}

      {/* Control Actions Bar */}
      <div className={`faceid-actions-bar ${isKioskMode ? "faceid-actions-bar--kiosk" : ""}`}>
        {!isKioskMode && cameras.length > 1 && (
          <div className="faceid-camera-picker">
            <select
              aria-label="Selecionar câmera"
              disabled={state.kind === "requesting" || isCapturing}
              onChange={(e) => void changeCamera(e.target.value)}
              value={selectedCameraId}
            >
              {cameras.map((camera, index) => (
                <option key={camera.deviceId} value={camera.deviceId}>
                  {camera.label || `Câmera ${index + 1}`}
                </option>
              ))}
            </select>
          </div>
        )}

        <div className="faceid-button-group">
          {!cameraActive ? (
            <button
              className="primary-button faceid-btn-main"
              disabled={state.kind === "requesting"}
              onClick={() => void startCamera()}
              type="button"
            >
              <Icon name="camera" />
              {state.kind === "requesting" ? "Iniciando Câmera..." : "Ativar Câmera"}
            </button>
          ) : !isCapturing ? (
            <button
              className={`primary-button faceid-btn-main ${
                faceAssessment.insideOval ? "faceid-btn-pulse" : ""
              }`}
              disabled={disabled}
              onClick={() => void startEnrollmentFlow()}
              title={disabled ? disabledReason : undefined}
              type="button"
            >
              <Icon name="face_id" />
              {captureLabel}
            </button>
          ) : (
            <button
              className="secondary-button faceid-btn-cancel"
              onClick={() => {
                stopCamera();
                void startCamera();
              }}
              type="button"
            >
              Cancelar Escaneamento
            </button>
          )}
        </div>
      </div>
    </section>
  );
}
