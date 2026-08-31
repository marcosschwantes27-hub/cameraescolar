import { useCallback, useState } from "react";
import { NavigationRail } from "./components/NavigationRail";
import type { AppView } from "./components/NavigationRail";
import { LateArrivalFlow } from "./components/LateArrivalFlow";
import { FaceIdentification } from "./components/FaceIdentification";
import { StudentEnrollment } from "./components/StudentEnrollment";
import { OccurrenceForm } from "./components/OccurrenceForm";
import { StudentHistory } from "./components/StudentHistory";
import { StudentSearch } from "./components/StudentSearch";
import type { StudentSearchStatus } from "./components/StudentSearch";
import { Icon } from "./components/Icons";
import { schoolOperations } from "./data/schoolOperations";
import type { Occurrence, Student } from "./domain/school";

function faceStatusLabel(student: Student) {
  if (student.faceEnrollmentStatus === "enrolled") return "Biometria cadastrada";
  if (student.faceEnrollmentStatus === "review_needed") return "Biometria para revisar";
  return "Biometria não cadastrada";
}

export function App() {
  const [selectedStudent, setSelectedStudent] = useState<Student | null>(null);
  const [latestOccurrence, setLatestOccurrence] = useState<Occurrence | null>(null);
  const [activeView, setActiveView] = useState<AppView>("late_arrival");
  const [reenrollmentStudent, setReenrollmentStudent] = useState<Student | null>(null);
  const [studentSearchStatus, setStudentSearchStatus] = useState<StudentSearchStatus>("loading");

  const handleSelectStudent = useCallback((student: Student) => {
    setSelectedStudent(student);
    setLatestOccurrence(null);
  }, []);

  function openStudentAttendance(student: Student) {
    handleSelectStudent(student);
    setReenrollmentStudent(null);
    setActiveView("attendance");
  }

  function handleNavigation(view: AppView) {
    setReenrollmentStudent(null);
    setActiveView(view);
  }

  function startFaceReenrollment(student: Student) {
    setReenrollmentStudent(student);
    setActiveView("enrollment");
  }

  return (
    <div className={activeView === "attendance" ? "app-shell" : "app-shell app-shell--focused"}>
      <NavigationRail activeView={activeView} onChange={handleNavigation} />
      {activeView === "attendance" && (
        <StudentSearch
          adapter={schoolOperations}
          onSelect={handleSelectStudent}
          onStateChange={setStudentSearchStatus}
          selectedStudentId={selectedStudent?.id ?? null}
        />
      )}

      <main id="conteudo-principal" className="workspace" tabIndex={-1}>
        <header className="topbar">
          <div>
            <span>Escola Estadual Horizonte</span>
            <small>Ano letivo 2026 · Processamento local</small>
          </div>
          <div className="coordinator-chip">
            <span aria-hidden="true">MS</span>
            <div>
              <strong>Marina Souza</strong>
              <small>Coordenação</small>
            </div>
          </div>
        </header>

        {activeView === "late_arrival" && (
          <LateArrivalFlow adapter={schoolOperations} />
        )}

        {activeView === "enrollment" && (
          <StudentEnrollment
            adapter={schoolOperations}
            existingStudent={reenrollmentStudent}
            key={reenrollmentStudent?.id ?? "new-student"}
            onComplete={openStudentAttendance}
          />
        )}

        {activeView === "identification" && (
          <FaceIdentification adapter={schoolOperations} onConfirm={openStudentAttendance} />
        )}

        {activeView === "attendance" ? (selectedStudent ? <><section className="student-header" aria-labelledby="selected-student-name">
          <div className="student-avatar student-avatar--large" aria-hidden="true">
            {selectedStudent.initials}
          </div>
          <div className="student-header-copy">
            <span className="section-eyebrow">Aluno selecionado</span>
            <h2 id="selected-student-name">{selectedStudent.name}</h2>
            <div className="student-metadata">
              <span>Matrícula {selectedStudent.enrollmentCode}</span>
              <span>{selectedStudent.classroom}</span>
              <span>Turno da {selectedStudent.shift.toLocaleLowerCase("pt-BR")}</span>
            </div>
          </div>
          <div className={`face-status face-status--${selectedStudent.faceEnrollmentStatus}`}>
            <Icon name="camera" />
            <span>
              <small>Identificação facial</small>
              <strong>{faceStatusLabel(selectedStudent)}</strong>
            </span>
            <button
              className="face-status-action"
              onClick={() => startFaceReenrollment(selectedStudent)}
              type="button"
            >
              {selectedStudent.faceEnrollmentStatus === "enrolled" ? "Atualizar" : "Cadastrar rosto"}
            </button>
          </div>
        </section>

        <div className="workspace-grid">
          <OccurrenceForm
            adapter={schoolOperations}
            key={selectedStudent.id}
            onCreated={setLatestOccurrence}
            student={selectedStudent}
          />
          <StudentHistory
            adapter={schoolOperations}
            latestOccurrence={latestOccurrence}
            student={selectedStudent}
          />
        </div>
        </> : (
          <section className="no-student-selected">
            <span className="empty-state-icon"><Icon name={studentSearchStatus === "empty" ? "students" : "search"} /></span>
            <span className="section-eyebrow">Atendimento escolar</span>
            <h2>
              {studentSearchStatus === "loading" && "Carregando alunos…"}
              {studentSearchStatus === "empty" && "Cadastre o primeiro aluno"}
              {studentSearchStatus === "ready" && "Selecione um aluno"}
              {studentSearchStatus === "error" && "Não foi possível carregar os alunos"}
            </h2>
            <p>
              {studentSearchStatus === "empty"
                ? "A lista está vazia. Comece pelos dados do estudante e depois faça o cadastro facial guiado."
                : "Use a busca ao lado para iniciar um atendimento."}
            </p>
            {studentSearchStatus === "empty" && (
              <button className="primary-button" onClick={() => setActiveView("enrollment")} type="button">
                Cadastrar primeiro aluno
              </button>
            )}
          </section>
        )) : null}
      </main>
    </div>
  );
}
