import { useState } from "react";
import type { FaceCaptureFrame, FaceRecognitionResult } from "../domain/face";
import type { Student } from "../domain/school";
import type { SchoolOperations } from "../data/schoolOperations";
import { CameraCapture } from "./CameraCapture";
import { Icon } from "./Icons";

interface FaceIdentificationProps {
  adapter: SchoolOperations;
  onConfirm: (student: Student) => void;
}

export function FaceIdentification({ adapter, onConfirm }: FaceIdentificationProps) {
  const [result, setResult] = useState<FaceRecognitionResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleFrames(frames: FaceCaptureFrame[]) {
    setError(null);
    setResult(null);
    try {
      setResult(await adapter.identifyFace(frames.map((frame) => frame.image)));
    } catch (requestError) {
      const message = requestError instanceof Error
        ? requestError.message
        : "Não foi possível realizar a identificação.";
      setError(message);
    }
  }

  return (
    <div className="feature-page identification-page">
      <header className="feature-page-heading feature-page-heading--split">
        <div className="feature-heading-copy">
          <span className="page-context"><Icon name="camera" /> Busca assistida</span>
          <h1>Reconhecer aluno pela câmera</h1>
          <p>O sistema compara cinco imagens e apresenta uma correspondência somente quando há concordância.</p>
        </div>
        <div className="feature-assurance">
          <span className="assurance-icon"><Icon name="info" /></span>
          <span>
            <strong>Confirmação obrigatória</strong>
            <small>O coordenador sempre valida o resultado antes do registro.</small>
          </span>
        </div>
      </header>

      <div className="identification-grid">
        <section className="feature-card feature-card--camera recognition-capture-card" aria-labelledby="recognition-capture-title">
          <div className="feature-card-heading feature-card-heading--compact">
            <div>
              <h2 id="recognition-capture-title">Captura ao vivo</h2>
              <p>Centralize apenas um rosto e mantenha boa iluminação.</p>
            </div>
          </div>
          <CameraCapture captureLabel="Identificar aluno" onCapture={handleFrames} />
        </section>

        <section className="identification-result" aria-live="polite">
          {!result && !error && (
            <div className="identification-empty">
              <span className="recognition-orbit" aria-hidden="true"><Icon name="students" /></span>
              <div className="identification-empty-copy">
                <span className="result-label">Área de confirmação</span>
                <strong>Aguardando identificação</strong>
                <p>O aluno reconhecido aparecerá aqui com turma e pontuação de similaridade.</p>
              </div>
              <ol className="recognition-process" aria-label="Etapas da identificação">
                <li><span>1</span>Capture cinco imagens</li>
                <li><span>2</span>Confira o aluno sugerido</li>
                <li><span>3</span>Confirme para abrir o atendimento</li>
              </ol>
            </div>
          )}

          {error && <div className="page-feedback page-feedback--error" role="alert">{error}</div>}

          {result && !result.matched && (
            <div className="recognition-card recognition-card--unknown">
              <span className="recognition-error-icon"><Icon name="search" /></span>
              <span className="result-label result-label--error">Nenhuma correspondência</span>
              <h2>Aluno não reconhecido</h2>
              <p>
                {result.framesAnalyzed === 0
                  ? "Não encontramos um rosto válido nas imagens. Confira a iluminação e tente novamente."
                  : result.message}
              </p>
              <small>
                {result.framesAnalyzed === 0
                  ? "Nenhum frame válido para comparação."
                  : `${result.agreeingFrames} de ${result.framesAnalyzed} frames concordaram.`}
              </small>
              <button className="secondary-button" onClick={() => setResult(null)} type="button">
                Tentar novamente
              </button>
            </div>
          )}

          {result?.matched && result.student && (
            <div className="recognition-card">
              <div className="student-avatar student-avatar--large" aria-hidden="true">
                {result.student.initials}
              </div>
              <span className="result-label">Correspondência encontrada</span>
              <h2>{result.student.name}</h2>
              <p>{result.student.classroom} · {result.student.shift}</p>
              <div className="similarity-meter">
                <span style={{ width: `${Math.min(result.similarity ?? 0, 100)}%` }} />
              </div>
              <strong className="similarity-score">Pontuação de similaridade <span>{result.similarity?.toFixed(1)}</span></strong>
              <small>{result.agreeingFrames} de {result.framesAnalyzed} frames concordaram.</small>
              <button
                className="primary-button"
                onClick={() => {
                  if (result.student) onConfirm(result.student);
                }}
                type="button"
              >
                Confirmar aluno e registrar ocorrência
              </button>
            </div>
          )}
        </section>
      </div>

      <p className="biometric-warning">
        O reconhecimento auxilia a busca, mas a confirmação visual do coordenador continua obrigatória.
      </p>
    </div>
  );
}
