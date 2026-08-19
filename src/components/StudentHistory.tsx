import { useEffect, useState } from "react";
import type { SchoolOperations } from "../data/schoolOperations";
import { occurrenceLabels, type Occurrence, type Student } from "../domain/school";

interface StudentHistoryProps {
  adapter: SchoolOperations;
  student: Student;
  latestOccurrence: Occurrence | null;
}

function formatDate(isoDate: string) {
  return new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(isoDate));
}

export function StudentHistory({ adapter, student, latestOccurrence }: StudentHistoryProps) {
  const [history, setHistory] = useState<Occurrence[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    adapter
      .getStudentHistory(student.id, controller.signal)
      .then(setHistory)
      .catch((requestError: unknown) => {
        if (requestError instanceof DOMException && requestError.name === "AbortError") return;
        setError("Não foi possível carregar o histórico.");
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [adapter, student.id, latestOccurrence]);

  return (
    <aside className="history-panel" aria-labelledby="history-title">
      <div className="history-heading">
        <div>
          <span className="section-eyebrow">Linha do tempo</span>
          <h2 id="history-title">Histórico recente</h2>
        </div>
        <span className="history-scope">Últimos 4</span>
      </div>

      {loading && <div className="history-loading">Carregando histórico…</div>}

      {error && <div className="inline-message inline-message--error" role="alert">{error}</div>}

      {!loading && !error && history.length === 0 && (
        <div className="history-empty">
          <strong>Nenhum registro anterior</strong>
          <span>As novas ocorrências aparecerão aqui.</span>
        </div>
      )}

      <ol className="timeline">
        {history.slice(0, 4).map((occurrence) => (
          <li key={occurrence.id}>
            <span className={`timeline-dot timeline-dot--${occurrence.type}`} aria-hidden="true" />
            <div>
              <div className="timeline-meta">
                <strong>{occurrenceLabels[occurrence.type]}</strong>
                <time dateTime={occurrence.occurredAt}>{formatDate(occurrence.occurredAt)}</time>
              </div>
              <p>{occurrence.reason}</p>
              <small>{occurrence.createdBy.name} · {occurrence.id}</small>
            </div>
          </li>
        ))}
      </ol>
    </aside>
  );
}
