import { useEffect, useState } from "react";
import type { Classroom, FaceCaptureFrame } from "../domain/face";
import type { Student } from "../domain/school";
import type { SchoolOperations } from "../data/schoolOperations";
import { CameraCapture } from "./CameraCapture";
import { Icon } from "./Icons";

interface StudentEnrollmentProps {
  adapter: SchoolOperations;
  existingStudent?: Student | null;
  onComplete: (student: Student) => void;
}

export function StudentEnrollment({
  adapter,
  existingStudent = null,
  onComplete,
}: StudentEnrollmentProps) {
  const [classrooms, setClassrooms] = useState<Classroom[]>([]);
  const [name, setName] = useState(existingStudent?.name ?? "");
  const [preferredName, setPreferredName] = useState(existingStudent?.preferredName ?? "");
  const [enrollmentCode, setEnrollmentCode] = useState(existingStudent?.enrollmentCode ?? "");
  const [classroomId, setClassroomId] = useState("");
  const [createdStudent, setCreatedStudent] = useState<Student | null>(existingStudent);
  const [status, setStatus] = useState<
    | { kind: "idle" }
    | { kind: "saving" }
    | { kind: "success"; student: Student; frames: number }
    | { kind: "error"; message: string }
  >({ kind: "idle" });

  useEffect(() => {
    const controller = new AbortController();
    adapter.listClassrooms(controller.signal)
      .then((items) => {
        setClassrooms(items);
        setClassroomId((current) => current
          || items.find((item) => (
            item.name === existingStudent?.classroom && item.shift === existingStudent.shift
          ))?.id
          || items[0]?.id
          || "");
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setStatus({ kind: "error", message: "Não foi possível carregar as turmas." });
      });
    return () => controller.abort();
  }, [adapter, existingStudent]);

  const missingFields = [
    name.trim().length < 2 ? "nome completo" : null,
    !enrollmentCode.trim() ? "matrícula" : null,
    !classroomId ? "turma" : null,
  ].filter((field): field is string => field !== null);
  const formValid = missingFields.length === 0;
  const disabledReason = missingFields.length > 0
    ? `Preencha ${missingFields.join(", ")} para habilitar o cadastro.`
    : undefined;

  async function handleFrames(frames: FaceCaptureFrame[]) {
    setStatus({ kind: "saving" });
    try {
      const input = {
        name: name.trim(),
        preferredName: preferredName.trim() || undefined,
        enrollmentCode: enrollmentCode.trim(),
        classroomId,
      };
      const enrollment = createdStudent
        ? await adapter.enrollFace(createdStudent.id, frames)
        : await adapter.createStudentWithFaceEnrollment({ ...input, frames });
      setCreatedStudent(enrollment.student);
      setStatus({
        kind: "success",
        student: enrollment.student,
        frames: enrollment.framesAccepted,
      });
    } catch (error) {
      setStatus({
        kind: "error",
        message: error instanceof Error ? error.message : "Não foi possível cadastrar o aluno.",
      });
    }
  }

  return (
    <div className="feature-page">
      <header className="feature-page-heading feature-page-heading--split">
        <div className="feature-heading-copy">
          <span className="page-context"><Icon name="students" /> {existingStudent ? "Atualização biométrica" : "Novo cadastro"}</span>
          <h1>{existingStudent ? "Atualizar cadastro facial" : "Cadastro do aluno e do rosto"}</h1>
          <p>
            {existingStudent
              ? `Substitua a biometria de ${existingStudent.name} por quinze imagens guiadas.`
              : "Preencha os dados e capture quinze imagens guiadas para criar uma biometria mais completa."}
          </p>
        </div>
        <div className="feature-assurance">
          <span className="assurance-icon"><Icon name="check" /></span>
          <span>
            <strong>Processamento local</strong>
            <small>As fotos são descartadas após gerar a biometria.</small>
          </span>
        </div>
      </header>

      <div className="enrollment-grid">
        <section className="feature-card feature-card--details" aria-labelledby="student-data-title">
          <div className="feature-card-heading">
            <span>1</span>
            <div>
              <h2 id="student-data-title">Dados do aluno</h2>
              <p>Informações usadas para localizar e confirmar o estudante.</p>
            </div>
          </div>
          <div className="enrollment-form">
            <label>
              <span>Nome completo <strong aria-hidden="true">*</strong></span>
              <input autoComplete="name" disabled={createdStudent !== null} onChange={(event) => setName(event.target.value)} placeholder="Ex.: Ana Beatriz da Silva" value={name} />
            </label>
            <label>
              <span>Nome preferido <em>opcional</em></span>
              <input disabled={createdStudent !== null} onChange={(event) => setPreferredName(event.target.value)} placeholder="Como prefere ser chamado" value={preferredName} />
            </label>
            <label>
              <span>Matrícula <strong aria-hidden="true">*</strong></span>
              <input autoComplete="off" disabled={createdStudent !== null} onChange={(event) => setEnrollmentCode(event.target.value)} placeholder="Código da matrícula" value={enrollmentCode} />
            </label>
            <label>
              <span>Turma <strong aria-hidden="true">*</strong></span>
              <select disabled={createdStudent !== null} onChange={(event) => setClassroomId(event.target.value)} value={classroomId}>
                {classrooms.map((classroom) => (
                  <option key={classroom.id} value={classroom.id}>
                    {classroom.name} · {classroom.shift}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </section>

        <section className="feature-card feature-card--camera" aria-labelledby="face-data-title">
          <div className="feature-card-heading">
            <span>2</span>
            <div>
              <h2 id="face-data-title">Cadastro facial</h2>
              <p>Cinco posições criam uma biometria mais completa no computador local.</p>
            </div>
          </div>
          <CameraCapture
            captureLabel="Iniciar cadastro guiado"
            captureMode="guided"
            disabled={!formValid || status.kind === "saving"}
            disabledReason={disabledReason}
            onCapture={handleFrames}
          />
        </section>
      </div>

      {status.kind === "error" && (
        <div className="page-feedback page-feedback--error" role="alert">{status.message}</div>
      )}
      {status.kind === "success" && (
        <div className="page-feedback page-feedback--success" role="status">
          <Icon name="check" />
          <div>
            <strong>
              {existingStudent
                ? `A biometria de ${status.student.name} foi atualizada`
                : `${status.student.name} foi cadastrado com sucesso`}
            </strong>
            <span>{status.frames} imagens válidas foram convertidas em biometria.</span>
          </div>
          <button className="primary-button" onClick={() => onComplete(status.student)} type="button">
            Abrir atendimento
          </button>
        </div>
      )}
    </div>
  );
}
