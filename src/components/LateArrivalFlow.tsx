import { useState, useEffect, useRef } from "react";
import type { Student } from "../domain/school";
import type { SchoolOperations } from "../data/schoolOperations";
import type { FaceCaptureFrame, FaceRecognitionResult } from "../domain/face";
import { CameraCapture } from "./CameraCapture";
import { Icon } from "./Icons";

interface LateArrivalFlowProps {
  adapter: SchoolOperations;
}

type FlowStep =
  | "home" // Initial home screen with big "Cheguei Atrasado" button
  | "camera" // Full-screen kiosk camera identification screen
  | "confirm" // Recognized student card with Name, Classroom, Time & Confirm button
  | "success"; // "Atraso Confirmado" screen with 5s countdown

export function LateArrivalFlow({ adapter }: LateArrivalFlowProps) {
  const [step, setStep] = useState<FlowStep>("home");
  const [recognizedStudent, setRecognizedStudent] = useState<Student | null>(null);
  const [recognitionResult, setRecognitionResult] = useState<FaceRecognitionResult | null>(null);
  const [currentTimeStr, setCurrentTimeStr] = useState("");
  const [occurredIso, setOccurredIso] = useState("");
  const [isRegistering, setIsRegistering] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successCountdown, setSuccessCountdown] = useState(5);
  const [liveClock, setLiveClock] = useState("");

  const countdownTimerRef = useRef<number | null>(null);

  // Live digital clock for tablet kiosk top header
  useEffect(() => {
    const tick = () => {
      const now = new Date();
      setLiveClock(
        now.toLocaleTimeString("pt-BR", {
          hour: "2-digit",
          minute: "2-digit",
          second: "2-digit",
        })
      );
    };
    tick();
    const interval = window.setInterval(tick, 1000);
    return () => clearInterval(interval);
  }, []);

  // Format current local time HH:mm
  function updateTime() {
    const now = new Date();
    const hours = String(now.getHours()).padStart(2, "0");
    const minutes = String(now.getMinutes()).padStart(2, "0");
    setCurrentTimeStr(`${hours}:${minutes}`);
    setOccurredIso(now.toISOString());
  }

  // Handle countdown for the 5-second return to home screen
  useEffect(() => {
    if (step === "success") {
      setSuccessCountdown(5);
      const timer = window.setInterval(() => {
        setSuccessCountdown((prev) => {
          if (prev <= 1) {
            clearInterval(timer);
            setStep("home");
            setRecognizedStudent(null);
            setRecognitionResult(null);
            setErrorMessage(null);
            return 5;
          }
          return prev - 1;
        });
      }, 1000);
      countdownTimerRef.current = timer;

      return () => {
        if (countdownTimerRef.current) clearInterval(countdownTimerRef.current);
      };
    }
  }, [step]);

  function handleStartFlow() {
    updateTime();
    setErrorMessage(null);
    setRecognizedStudent(null);
    setRecognitionResult(null);
    setStep("camera");
  }

  function handleCancelFlow() {
    if (countdownTimerRef.current) clearInterval(countdownTimerRef.current);
    setStep("home");
    setRecognizedStudent(null);
    setRecognitionResult(null);
    setErrorMessage(null);
  }

  async function handleFrames(frames: FaceCaptureFrame[]) {
    setErrorMessage(null);
    try {
      const result = await adapter.identifyFace(frames.map((f) => f.image));
      setRecognitionResult(result);
      if (result.matched && result.student) {
        updateTime();
        setRecognizedStudent(result.student);
        setStep("confirm");
      } else {
        setErrorMessage(
          result.message ||
            "Aluno não identificado. Por favor, centralize o rosto no contorno oval e tente novamente."
        );
      }
    } catch (err) {
      setErrorMessage(
        err instanceof Error ? err.message : "Erro ao processar biometria. Tente novamente."
      );
    }
  }

  async function handleConfirmLateArrival() {
    if (!recognizedStudent) return;
    setIsRegistering(true);
    setErrorMessage(null);
    try {
      const timeToUse = occurredIso || new Date().toISOString();
      await adapter.createOccurrence({
        studentId: recognizedStudent.id,
        type: "late_arrival",
        reason: `Chegada atrasada às ${currentTimeStr} - Identificação facial no terminal kiosk`,
        occurredAt: timeToUse,
        identificationSource: "facial",
      });
      setIsRegistering(false);
      setStep("success");
    } catch (err) {
      setIsRegistering(false);
      setErrorMessage(
        err instanceof Error ? err.message : "Falha ao registrar atraso. Tente novamente."
      );
    }
  }

  return (
    <div className="late-arrival-kiosk-container" id="late-arrival-flow">
      {/* 1. TELA PRINCIPAL: Tablet Kiosk Home com botão gigante "Cheguei Atrasado" */}
      {step === "home" && (
        <div className="late-home-screen">
          {/* Top Kiosk Header */}
          <div className="late-kiosk-header">
            <div className="late-kiosk-header-left">
              <div className="late-school-badge">
                <span className="late-badge-indicator" />
                <Icon name="students" />
                <span>Escola Estadual Horizonte</span>
              </div>
            </div>
            <div className="late-kiosk-header-center">
              <span className="late-kiosk-clock">{liveClock}</span>
            </div>
            <div className="late-kiosk-header-right">
              <span className="late-kiosk-mode-tag">Terminal Kiosk</span>
            </div>
          </div>

          {/* Central Hero Touch Area */}
          <div className="late-kiosk-center-hero">
            <div className="late-hero-intro">
              <h1 className="late-home-title">Terminal de Atrasos</h1>
              <p className="late-home-subtitle">
                Chegou após o toque de entrada? Toque no botão abaixo para escanear seu rosto e
                registrar seu comprovante de entrada.
              </p>
            </div>

            <div className="late-hero-action-area">
              <button
                className="late-arrival-hero-button"
                id="btn-cheguei-atrasado"
                onClick={handleStartFlow}
                type="button"
                aria-label="Cheguei Atrasado - Iniciar reconhecimento facial"
              >
                <div className="late-button-glow-ring" />
                <div className="late-button-icon-halo">
                  <Icon name="face_id" />
                </div>
                <div className="late-button-text-group">
                  <span className="late-button-main-text">Cheguei Atrasado</span>
                  <span className="late-button-sub-text">Toque para escanear seu rosto</span>
                </div>
              </button>
            </div>
          </div>

          {/* Footer Guidelines */}
          <div className="late-home-footer-info">
            <div className="late-info-pill">
              <Icon name="camera" />
              <span>Câmera em Tela Inteira com Oval Face ID</span>
            </div>
            <div className="late-info-pill">
              <Icon name="clock" />
              <span>Horário e turma registrados automaticamente</span>
            </div>
            <div className="late-info-pill">
              <Icon name="check" />
              <span>Sem filas na coordenação</span>
            </div>
          </div>
        </div>
      )}

      {/* 2. TELA DE IDENTIFICAÇÃO: Câmera na Tela Inteira (Modo Kiosk) */}
      {step === "camera" && (
        <div className="late-camera-fullscreen-screen">
          {errorMessage && (
            <div className="late-kiosk-floating-error" role="alert">
              <Icon name="info" />
              <div className="late-kiosk-error-text">
                <strong>Não foi possível identificar</strong>
                <span>{errorMessage}</span>
              </div>
              <button
                className="late-retry-text-btn"
                onClick={() => setErrorMessage(null)}
                type="button"
              >
                Tentar novamente
              </button>
            </div>
          )}

          <div className="late-kiosk-camera-container">
            <CameraCapture
              autoCaptureOnOvalFit={true}
              autoStart={true}
              captureLabel="Identificar meu Rosto"
              captureMode="burst"
              onCancel={handleCancelFlow}
              onCapture={handleFrames}
              variant="fullscreen"
            />
          </div>
        </div>
      )}

      {/* 3. TELA DE CONFIRMAÇÃO DO ALUNO (Nome, Turma, Horário + Botão Confirmar) */}
      {step === "confirm" && recognizedStudent && (
        <div className="late-confirm-screen">
          <div className="late-kiosk-header">
            <div className="late-kiosk-header-left">
              <button className="late-back-btn" onClick={handleCancelFlow} type="button">
                <Icon name="arrow" style={{ transform: "rotate(180deg)" }} />
                <span>Cancelar</span>
              </button>
            </div>
            <div className="late-kiosk-header-center">
              <span className="late-kiosk-clock">{liveClock}</span>
            </div>
            <div className="late-kiosk-header-right">
              <span className="late-step-indicator">Passo 2 de 2</span>
            </div>
          </div>

          <div className="late-confirm-card-wrapper">
            {errorMessage && (
              <div className="late-error-banner" role="alert">
                <Icon name="info" />
                <span>{errorMessage}</span>
              </div>
            )}

            <div className="late-student-card-panel">
              <div className="late-card-badge-header">
                <span className="late-match-tag">
                  <Icon name="check" /> Aluno Reconhecido com Sucesso
                </span>
                {recognitionResult?.similarity && (
                  <span className="late-similarity-tag">
                    Precisão: {Math.round(recognitionResult.similarity)}%
                  </span>
                )}
              </div>

              <div className="late-student-details-grid">
                <div className="late-student-avatar-box">
                  <span>{recognizedStudent.initials}</span>
                </div>

                <div className="late-student-meta-list">
                  <div className="late-meta-item">
                    <span className="late-meta-label">Nome Completo do Aluno</span>
                    <strong className="late-meta-value late-meta-name">
                      {recognizedStudent.name}
                    </strong>
                  </div>

                  <div className="late-meta-row">
                    <div className="late-meta-item">
                      <span className="late-meta-label">Turma</span>
                      <strong className="late-meta-value">{recognizedStudent.classroom}</strong>
                    </div>

                    <div className="late-meta-item">
                      <span className="late-meta-label">Turno</span>
                      <strong className="late-meta-value">{recognizedStudent.shift}</strong>
                    </div>

                    <div className="late-meta-item late-meta-item--highlight">
                      <span className="late-meta-label">Horário de Chegada</span>
                      <strong className="late-meta-value late-meta-time">
                        <Icon name="clock" /> {currentTimeStr}
                      </strong>
                    </div>
                  </div>
                </div>
              </div>

              <div className="late-confirm-actions">
                <button
                  className="late-btn-confirm"
                  disabled={isRegistering}
                  id="btn-confirmar-atraso"
                  onClick={() => void handleConfirmLateArrival()}
                  type="button"
                >
                  <Icon name="check" />
                  <span>{isRegistering ? "Gravando atraso..." : "Confirmar Atraso"}</span>
                </button>

                <button
                  className="late-btn-reidentify"
                  disabled={isRegistering}
                  onClick={handleStartFlow}
                  type="button"
                >
                  Não sou eu / Repetir Escaneamento
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 4. TELA DE ATRASO CONFIRMADO (Retorno automático em 5 segundos) */}
      {step === "success" && (
        <div className="late-success-screen" role="status">
          <div className="late-success-card">
            <div className="late-success-icon-bubble">
              <Icon name="check" />
            </div>

            <span className="late-success-eyebrow">Comprovante Digital de Entrada</span>
            <h2 className="late-success-title">Atraso Confirmado!</h2>

            <p className="late-success-message">
              O atraso de <strong>{recognizedStudent?.name}</strong> foi registrado na coordenação
              da escola às <strong>{currentTimeStr}</strong>.
            </p>

            <div className="late-receipt-box">
              <div className="late-receipt-row">
                <span>Aluno:</span>
                <strong>{recognizedStudent?.name}</strong>
              </div>
              <div className="late-receipt-row">
                <span>Turma:</span>
                <strong>{recognizedStudent?.classroom}</strong>
              </div>
              <div className="late-receipt-row">
                <span>Horário Registrado:</span>
                <strong>{currentTimeStr}</strong>
              </div>
              <div className="late-receipt-row">
                <span>Status da Ocorrência:</span>
                <strong className="late-status-recorded">Justificativa em Aberto</strong>
              </div>
            </div>

            <div className="late-countdown-bar-container">
              <div
                className="late-countdown-bar-fill"
                style={{ width: `${(successCountdown / 5) * 100}%` }}
              />
            </div>

            <p className="late-return-notice">
              Retornando à tela inicial em <strong>{successCountdown}s</strong> para o próximo aluno...
            </p>

            <button className="late-btn-now" onClick={handleCancelFlow} type="button">
              Voltar para Tela Inicial Agora
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
