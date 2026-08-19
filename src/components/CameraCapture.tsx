import { useEffect, useRef, useState } from "react";
import type { EnrollmentPose, FaceCaptureFrame } from "../domain/face";
import { Icon } from "./Icons";

interface CameraCaptureProps {
  captureLabel: string;
  captureMode?: "burst" | "guided";
  disabled?: boolean;
  disabledReason?: string;
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
}> = [
  { pose: "front", label: "Frente", instruction: "Olhe diretamente para a câmera" },
  { pose: "left", label: "Esquerda", instruction: "Vire levemente para a esquerda" },
  { pose: "right", label: "Direita", instruction: "Vire levemente para a direita" },
  { pose: "up", label: "Acima", instruction: "Levante um pouco o queixo" },
  { pose: "down", label: "Abaixo", instruction: "Abaixe um pouco o queixo" },
];

function wait(milliseconds: number) {
  return new Promise<void>((resolve) => window.setTimeout(resolve, milliseconds));
}

function canvasBlob(canvas: HTMLCanvasElement) {
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) => blob ? resolve(blob) : reject(new Error("Não foi possível capturar a imagem.")),
      "image/jpeg",
      0.9,
    );
  });
}

export function CameraCapture({
  captureLabel,
  captureMode = "burst",
  disabled = false,
  disabledReason,
  onCapture,
}: CameraCaptureProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const mountedRef = useRef(true);
  const [state, setState] = useState<CameraState>({ kind: "idle" });
  const [cameras, setCameras] = useState<MediaDeviceInfo[]>([]);
  const [selectedCameraId, setSelectedCameraId] = useState("");

  function stopCamera() {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
  }

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
    return () => {
      mountedRef.current = false;
      navigator.mediaDevices?.removeEventListener?.("devicechange", handleDeviceChange);
      stopCamera();
    };
  }, []);

  async function startCamera(cameraId = selectedCameraId) {
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
      const unavailable = error instanceof DOMException
        && (error.name === "NotFoundError" || error.name === "NotReadableError");
      setState({
        kind: "error",
        message: denied
          ? "Permita o uso da câmera no navegador para continuar."
          : unavailable
            ? "A câmera selecionada não está disponível. Verifique a conexão do celular com o Windows."
            : "Não foi possível iniciar a câmera.",
      });
    }
  }

  async function changeCamera(cameraId: string) {
    setSelectedCameraId(cameraId);
    if (cameraActive) await startCamera(cameraId);
  }

  async function captureFrames() {
    const video = videoRef.current;
    if (!video || video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) {
      setState({ kind: "error", message: "A câmera ainda não está pronta." });
      return;
    }
    try {
      const canvas = document.createElement("canvas");
      const sourceWidth = video.videoWidth;
      const sourceHeight = video.videoHeight;
      canvas.width = Math.min(sourceWidth, 960);
      canvas.height = Math.round(canvas.width * (sourceHeight / sourceWidth));
      const context = canvas.getContext("2d");
      if (!context) throw new Error("Não foi possível preparar a captura.");

      const frames: FaceCaptureFrame[] = [];
      if (captureMode === "guided") {
        const total = GUIDED_STEPS.length * FRAMES_PER_POSE;
        for (let stepIndex = 0; stepIndex < GUIDED_STEPS.length; stepIndex += 1) {
          const step = GUIDED_STEPS[stepIndex];
          if (!step) continue;
          for (let countdown = 3; countdown >= 1; countdown -= 1) {
            setState({
              kind: "capturing",
              captured: frames.length,
              total,
              stepIndex,
              countdown,
            });
            await wait(700);
            if (!mountedRef.current) return;
          }
          for (let frameIndex = 0; frameIndex < FRAMES_PER_POSE; frameIndex += 1) {
            setState({
              kind: "capturing",
              captured: frames.length,
              total,
              stepIndex,
              countdown: null,
            });
            context.drawImage(video, 0, 0, canvas.width, canvas.height);
            frames.push({ image: await canvasBlob(canvas), pose: step.pose });
            if (frameIndex < FRAMES_PER_POSE - 1) await wait(300);
          }
        }
      } else {
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
          if (index < BURST_FRAME_COUNT - 1) await wait(320);
        }
      }
      setState({
        kind: "capturing",
        captured: frames.length,
        total: frames.length,
        stepIndex: null,
        countdown: null,
      });
      await onCapture(frames);
      stopCamera();
      if (mountedRef.current) setState({ kind: "idle" });
    } catch (error) {
      if (mountedRef.current) {
        stopCamera();
        setState({
          kind: "error",
          message: error instanceof Error ? error.message : "Não foi possível processar as imagens.",
        });
      }
    }
  }

  const cameraActive = state.kind === "ready" || state.kind === "capturing";
  const progress = state.kind === "capturing" ? state.captured : 0;
  const total = state.kind === "capturing"
    ? state.total
    : captureMode === "guided"
      ? GUIDED_STEPS.length * FRAMES_PER_POSE
      : BURST_FRAME_COUNT;
  const activeStep = state.kind === "capturing" && state.stepIndex !== null
    ? GUIDED_STEPS[state.stepIndex]
    : null;
  const activeStepNumber = state.kind === "capturing" && state.stepIndex !== null
    ? state.stepIndex + 1
    : null;
  const isProcessing = state.kind === "capturing"
    && state.stepIndex === null
    && state.captured >= state.total;
  const completedPoseCount = captureMode === "guided"
    ? Math.floor(progress / FRAMES_PER_POSE)
    : 0;

  let sessionLabel = "Câmera ainda não ativada";
  let sessionTitle = captureMode === "guided" ? "Prepare o cadastro facial" : "Prepare a identificação";
  let sessionDescription = captureMode === "guided"
    ? "Ative a câmera e siga cada movimento. Três imagens serão capturadas em cada posição."
    : "Ative a câmera e mantenha apenas um rosto centralizado durante a sequência.";

  if (state.kind === "requesting") {
    sessionLabel = "Conectando";
    sessionTitle = "Abrindo a câmera";
    sessionDescription = "Aguarde enquanto o navegador conecta ao dispositivo selecionado.";
  } else if (state.kind === "error") {
    sessionLabel = "Câmera indisponível";
    sessionTitle = "A câmera precisa de atenção";
    sessionDescription = "Confira a conexão do dispositivo e tente ativar a câmera novamente.";
  } else if (isProcessing) {
    sessionLabel = `${progress} imagens capturadas`;
    sessionTitle = captureMode === "guided" ? "Criando a biometria" : "Comparando as imagens";
    sessionDescription = "A captura terminou. Aguarde o processamento local concluir esta operação.";
  } else if (activeStep) {
    sessionLabel = `Posição ${activeStepNumber} de ${GUIDED_STEPS.length}`;
    sessionTitle = activeStep.instruction;
    sessionDescription = "Três imagens serão registradas antes do avanço automático para a próxima posição.";
  } else if (state.kind === "capturing") {
    sessionLabel = `${progress} de ${total} imagens capturadas`;
    sessionTitle = "Mantenha o rosto centralizado";
    sessionDescription = "A sequência registra cinco imagens e encerra assim que todas forem capturadas.";
  } else if (state.kind === "ready") {
    sessionLabel = captureMode === "guided" ? "Câmera pronta · 5 posições" : "Câmera pronta · 5 imagens";
    sessionTitle = captureMode === "guided" ? "Tudo pronto para começar" : "Rosto no centro, olhar para a câmera";
    sessionDescription = captureMode === "guided"
      ? "Ao iniciar, você será guiado por frente, esquerda, direita, acima e abaixo."
      : "A identificação captura cinco imagens em sequência para comparar o resultado.";
  }

  const studioClassName = [
    "capture-studio",
    cameraActive ? "capture-studio--active" : "",
    state.kind === "capturing" && !isProcessing ? "capture-studio--capturing" : "",
    isProcessing ? "capture-studio--processing" : "",
  ].filter(Boolean).join(" ");
  const sessionKey = activeStep?.pose ?? (isProcessing ? "processing" : state.kind);
  const countdownKey = state.kind === "capturing"
    ? `${state.stepIndex ?? "burst"}-${state.countdown ?? progress}`
    : "idle";

  return (
    <section className="camera-capture" aria-label="Captura facial">
      <div className={studioClassName}>
        <div className="capture-preview">
          <video aria-label="Imagem da câmera" className="capture-feed" muted playsInline ref={videoRef} />

          {cameraActive && (
            <div className="capture-live-status">
              <span aria-hidden="true" />
              Câmera ativa
            </div>
          )}

          {cameraActive && (
            <div className="capture-face-frame" aria-hidden="true">
              <span className="capture-frame-corner capture-frame-corner--top-left" />
              <span className="capture-frame-corner capture-frame-corner--top-right" />
              <span className="capture-frame-corner capture-frame-corner--bottom-left" />
              <span className="capture-frame-corner capture-frame-corner--bottom-right" />
              {state.kind === "capturing" && progress > 0 && !isProcessing && (
                <span className="capture-frame-flash" key={progress} />
              )}
            </div>
          )}

          {!cameraActive && (
            <div className="capture-preview-placeholder">
              <span><Icon name="camera" /></span>
              <strong>{state.kind === "requesting" ? "Conectando…" : "Câmera desligada"}</strong>
              <small>Sua imagem aparecerá aqui.</small>
            </div>
          )}
        </div>

        <div className="capture-session" aria-live="polite">
          <div className="capture-session-copy" key={sessionKey}>
            <h3>{sessionTitle}</h3>
            <div className="capture-session-state">
              <span>{sessionLabel}</span>
              {activeStep && (
                <span className={`capture-pose-cue capture-pose-cue--${activeStep.pose}`} aria-hidden="true">
                  <Icon name={activeStep.pose === "front" ? "camera" : "arrow"} />
                </span>
              )}
            </div>
            <p>{sessionDescription}</p>
          </div>

          {activeStep && state.kind === "capturing" && (
            <div className="capture-countdown" key={countdownKey} aria-hidden="true">
              {state.countdown ? <strong>{state.countdown}</strong> : <Icon name="camera" />}
              <span>{state.countdown ? "Prepare-se" : "Registrando"}</span>
            </div>
          )}

          {isProcessing && (
            <div className="capture-processing" role="status">
              <span aria-hidden="true" />
              Processamento em andamento
            </div>
          )}

          {captureMode === "guided" ? (
            <ol className="capture-pose-track" aria-label="Progresso das posições do cadastro facial">
              {GUIDED_STEPS.map((step, index) => {
                const completed = index < completedPoseCount || isProcessing;
                const current = activeStepNumber === index + 1 && !completed;
                const className = [
                  completed ? "capture-pose-track__item--complete" : "",
                  current ? "capture-pose-track__item--current" : "",
                ].filter(Boolean).join(" ");
                return (
                  <li
                    aria-current={current ? "step" : undefined}
                    aria-label={`${step.label}: ${completed ? "concluída" : current ? "posição atual" : "pendente"}`}
                    className={className}
                    key={step.pose}
                  >
                    <span>{completed ? <Icon name="check" /> : index + 1}</span>
                    <small>{step.label}</small>
                  </li>
                );
              })}
            </ol>
          ) : (
            <div className="capture-burst-track" aria-label={`${progress} de ${total} imagens capturadas`}>
              {Array.from({ length: BURST_FRAME_COUNT }, (_, index) => (
                <span className={index < progress ? "capture-burst-track__item--complete" : ""} key={index} />
              ))}
            </div>
          )}

          <p className="capture-local-note">
            <Icon name="check" />
            Processamento local · imagens não ficam armazenadas
          </p>
        </div>
      </div>

      {state.kind === "error" && (
        <div className="inline-message inline-message--error" role="alert">{state.message}</div>
      )}

      {cameraActive && disabled && disabledReason && (
        <div className="capture-requirement" role="status">
          <Icon name="info" />
          <span>{disabledReason}</span>
        </div>
      )}

      <div className="capture-control-bar">
        {cameras.length > 0 && (
          <label className="camera-selector">
            <span>Fonte de vídeo</span>
            <select
              aria-label="Selecionar câmera"
              disabled={state.kind === "requesting" || state.kind === "capturing"}
              onChange={(event) => void changeCamera(event.target.value)}
              value={selectedCameraId}
            >
              {!selectedCameraId && <option value="">Câmera padrão</option>}
              {cameras.map((camera, index) => (
                <option key={camera.deviceId} value={camera.deviceId}>
                  {camera.label || `Câmera ${index + 1}`}
                </option>
              ))}
            </select>
          </label>
        )}

        {state.kind !== "capturing" && (
          <div className="camera-actions">
            {!cameraActive ? (
              <button
                className="secondary-button"
                disabled={state.kind === "requesting"}
                onClick={() => void startCamera()}
                type="button"
              >
                <Icon name="camera" />
                {state.kind === "requesting" ? "Ativando…" : "Ativar câmera"}
              </button>
            ) : (
              <button
                className="primary-button"
                disabled={disabled}
                onClick={captureFrames}
                title={disabled ? disabledReason : undefined}
                type="button"
              >
                <Icon name="camera" />
                {captureLabel}
              </button>
            )}
          </div>
        )}
      </div>
    </section>
  );
}
