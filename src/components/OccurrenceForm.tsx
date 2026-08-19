import { useMemo, useState, type FormEvent } from "react";
import type { SchoolOperations } from "../data/schoolOperations";
import {
  occurrenceDescriptions,
  occurrenceLabels,
  type Occurrence,
  type OccurrenceAttachment,
  type OccurrenceType,
  type Student,
} from "../domain/school";
import { Icon } from "./Icons";

interface OccurrenceFormProps {
  adapter: SchoolOperations;
  student: Student;
  onCreated: (occurrence: Occurrence) => void;
}
const occurrenceTypes = Object.keys(occurrenceLabels) as OccurrenceType[];

function localDateTimeValue(date: Date) {
  const offset = date.getTimezoneOffset();
  return new Date(date.getTime() - offset * 60_000).toISOString().slice(0, 16);
}

function toAttachment(file: File | null): OccurrenceAttachment | undefined {
  if (!file) return undefined;
  return { name: file.name, size: file.size, mediaType: file.type || "application/octet-stream" };
}

export function OccurrenceForm({ adapter, student, onCreated }: OccurrenceFormProps) {
  const [type, setType] = useState<OccurrenceType>("late_arrival");
  const [reason, setReason] = useState("");
  const [description, setDescription] = useState("");
  const [responsibleName, setResponsibleName] = useState("");
  const [participants, setParticipants] = useState("");
  const [occurredAt, setOccurredAt] = useState(() => localDateTimeValue(new Date()));
  const [attachment, setAttachment] = useState<File | null>(null);
  const [status, setStatus] = useState<
    | { kind: "idle" }
    | { kind: "saving" }
    | { kind: "success"; protocol: string }
    | { kind: "error"; message: string }
  >({ kind: "idle" });

  const supportsAttachment = useMemo(
    () => ["school_record", "meeting_minutes", "warning"].includes(type),
    [type],
  );

  function resetSecondaryFields(nextType: OccurrenceType) {
    setType(nextType);
    setResponsibleName("");
    setParticipants("");
    setAttachment(null);
    setStatus({ kind: "idle" });
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!reason.trim()) {
      setStatus({ kind: "error", message: "Informe o motivo antes de continuar." });
      return;
    }

    setStatus({ kind: "saving" });
    try {
      const occurrence = await adapter.createOccurrence({
        studentId: student.id,
        type,
        reason,
        description,
        responsibleName,
        participants,
        attachment: toAttachment(attachment),
        occurredAt: new Date(occurredAt).toISOString(),
        identificationSource: "manual",
      });
      onCreated(occurrence);
      setStatus({ kind: "success", protocol: occurrence.id });
      setReason("");
      setDescription("");
      setResponsibleName("");
      setParticipants("");
      setAttachment(null);
      setOccurredAt(localDateTimeValue(new Date()));
    } catch (error) {
      setStatus({
        kind: "error",
        message: error instanceof Error ? error.message : "Não foi possível salvar a ocorrência.",
      });
    }
  }

  return (
    <section className="occurrence-panel" aria-labelledby="occurrence-title">
      <div className="panel-heading">
        <div>
          <span className="section-eyebrow">Novo atendimento</span>
          <h2 id="occurrence-title">O que deseja registrar?</h2>
        </div>
        <span className="automatic-time"><Icon name="clock" /> Horário automático</span>
      </div>

      <div className="occurrence-type-grid" role="radiogroup" aria-label="Tipo de ocorrência">
        {occurrenceTypes.map((item) => (
          <button
            aria-checked={type === item}
            className={type === item ? "type-card type-card--selected" : "type-card"}
            key={item}
            onClick={() => resetSecondaryFields(item)}
            role="radio"
            type="button"
          >
            <span className="type-indicator" aria-hidden="true" />
            <strong>{occurrenceLabels[item]}</strong>
            <small>{occurrenceDescriptions[item]}</small>
          </button>
        ))}
      </div>

      <form className="occurrence-form" onSubmit={handleSubmit} noValidate>
        <div className="form-grid">
          <label>
            <span>Data e horário</span>
            <input
              name="occurredAt"
              onChange={(event) => setOccurredAt(event.target.value)}
              required
              type="datetime-local"
              value={occurredAt}
            />
          </label>
          <label>
            <span>Motivo <b aria-hidden="true">*</b></span>
            <input
              aria-describedby="reason-help"
              name="reason"
              onChange={(event) => setReason(event.target.value)}
              placeholder="Resuma o motivo do registro"
              required
              value={reason}
            />
            <small id="reason-help">Este texto aparecerá no histórico do aluno.</small>
          </label>
        </div>

        {type === "early_departure" && (
          <label>
            <span>Responsável pela retirada <em>opcional</em></span>
            <input
              name="responsibleName"
              onChange={(event) => setResponsibleName(event.target.value)}
              placeholder="Nome completo"
              value={responsibleName}
            />
          </label>
        )}

        {type === "meeting_minutes" && (
          <label>
            <span>Participantes <em>opcional</em></span>
            <input
              name="participants"
              onChange={(event) => setParticipants(event.target.value)}
              placeholder="Ex.: coordenação, estudante e responsável"
              value={participants}
            />
          </label>
        )}

        <label>
          <span>Descrição detalhada <em>opcional</em></span>
          <textarea
            name="description"
            onChange={(event) => setDescription(event.target.value)}
            placeholder="Acrescente informações importantes para compreender o registro."
            rows={4}
            value={description}
          />
        </label>

        {supportsAttachment && (
          <label className="file-field">
            <Icon name="file" />
            <span>
              <strong>{attachment ? attachment.name : "Adicionar documento"}</strong>
              <small>PDF ou imagem · metadado local nesta primeira integração</small>
            </span>
            <input
              accept="application/pdf,image/*"
              name="attachment"
              onChange={(event) => setAttachment(event.target.files?.[0] ?? null)}
              type="file"
            />
          </label>
        )}

        <div className="form-footer">
          <div className="form-status" aria-live="polite">
            {status.kind === "error" && (
              <span className="status-error" role="alert">{status.message}</span>
            )}
            {status.kind === "success" && (
              <span className="status-success">
                <Icon name="check" /> Registro criado: {status.protocol}
              </span>
            )}
          </div>
          <button className="primary-button" disabled={status.kind === "saving"} type="submit">
            {status.kind === "saving" ? "Registrando…" : "Confirmar registro"}
          </button>
        </div>
      </form>
    </section>
  );
}
