import { useEffect, useRef, useState } from "react";
import type { Student } from "../domain/school";
import type { SchoolOperations } from "../data/schoolOperations";
import { Icon } from "./Icons";

interface StudentSearchProps {
  adapter: SchoolOperations;
  selectedStudentId: string | null;
  onSelect: (student: Student) => void;
  onStateChange: (status: StudentSearchStatus) => void;
}

export type StudentSearchStatus = "loading" | "ready" | "empty" | "error";

type SearchState =
  | { status: "loading"; students: Student[] }
  | { status: "ready"; students: Student[] }
  | { status: "error"; students: Student[]; message: string };

export function StudentSearch({
  adapter,
  selectedStudentId,
  onSelect,
  onStateChange,
}: StudentSearchProps) {
  const [query, setQuery] = useState("");
  const [state, setState] = useState<SearchState>({ status: "loading", students: [] });
  const requestId = useRef(0);
  const selectedStudentIdRef = useRef(selectedStudentId);

  useEffect(() => {
    selectedStudentIdRef.current = selectedStudentId;
  }, [selectedStudentId]);

  useEffect(() => {
    const controller = new AbortController();
    const currentRequest = ++requestId.current;
    setState((current) => ({ status: "loading", students: current.students }));
    onStateChange("loading");

    adapter
      .searchStudents(query, controller.signal)
      .then((students) => {
        if (currentRequest === requestId.current) {
          setState({ status: "ready", students });
          onStateChange(students.length === 0 ? "empty" : "ready");
          if (selectedStudentIdRef.current === null && students[0]) onSelect(students[0]);
        }
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        if (currentRequest === requestId.current) {
          onStateChange("error");
          setState({
            status: "error",
            students: [],
            message: "Não foi possível buscar os alunos.",
          });
        }
      });

    return () => controller.abort();
  }, [adapter, onSelect, onStateChange, query]);

  return (
    <section className="student-search" aria-labelledby="student-search-title">
      <div className="section-eyebrow">Atendimento escolar</div>
      <h1 id="student-search-title">Localizar aluno</h1>
      <p className="section-description">
        Pesquise por nome, matrícula ou turma para iniciar um registro.
      </p>

      <label className="search-field">
        <span className="sr-only">Buscar aluno</span>
        <Icon name="search" />
        <input
          autoComplete="off"
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Nome ou matrícula"
          type="search"
          value={query}
        />
      </label>

      <div className="result-heading">
        <span>{query ? "Resultados" : "Alunos recentes"}</span>
        {state.status === "loading" && <span className="loading-label">Buscando…</span>}
      </div>

      {state.status === "error" && (
        <div className="inline-message inline-message--error" role="alert">
          {state.message}
        </div>
      )}

      {state.status === "ready" && state.students.length === 0 && (
        <div className="empty-search">
          <strong>Nenhum aluno encontrado</strong>
          <span>Confira o nome ou tente buscar pela matrícula.</span>
        </div>
      )}

      <ul className="student-results" aria-busy={state.status === "loading"}>
        {state.students.map((student) => (
          <li key={student.id}>
            <button
              className={
                selectedStudentId === student.id
                  ? "student-result student-result--selected"
                  : "student-result"
              }
              onClick={() => onSelect(student)}
              type="button"
            >
              <span className="student-avatar" aria-hidden="true">{student.initials}</span>
              <span className="student-result-copy">
                <strong>{student.preferredName ?? student.name}</strong>
                <span>{student.classroom} · {student.shift}</span>
                <small>Matrícula {student.enrollmentCode}</small>
              </span>
              <Icon name="arrow" />
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
