export type StudentStatus = "active" | "inactive";

export type FaceEnrollmentStatus = "not_enrolled" | "enrolled" | "review_needed";

export interface Student {
  id: string;
  schoolId: string;
  name: string;
  preferredName: string | null;
  enrollmentCode: string;
  classroom: string;
  shift: "Manhã" | "Tarde" | "Noite";
  status: StudentStatus;
  initials: string;
  faceEnrollmentStatus: FaceEnrollmentStatus;
}

export type OccurrenceType =
  | "late_arrival"
  | "early_departure"
  | "school_record"
  | "meeting_minutes"
  | "warning";

export interface OccurrenceAttachment {
  name: string;
  size: number;
  mediaType: string;
}

export interface Occurrence {
  id: string;
  schoolId: string;
  studentId: string;
  type: OccurrenceType;
  reason: string;
  description: string | null;
  responsibleName: string | null;
  participants: string | null;
  attachment: OccurrenceAttachment | null;
  occurredAt: string;
  createdAt: string;
  createdBy: {
    id: string;
    name: string;
  };
  identificationSource: "manual" | "facial";
  status: "active" | "cancelled";
}

export interface CreateOccurrenceInput {
  studentId: string;
  type: OccurrenceType;
  reason: string;
  description?: string;
  responsibleName?: string;
  participants?: string;
  attachment?: OccurrenceAttachment;
  occurredAt: string;
  identificationSource: "manual" | "facial";
}

export const occurrenceLabels: Record<OccurrenceType, string> = {
  late_arrival: "Atraso",
  early_departure: "Saída antecipada",
  school_record: "Registro escolar",
  meeting_minutes: "Ata",
  warning: "Advertência",
};
export const occurrenceDescriptions: Record<OccurrenceType, string> = {
  late_arrival: "Registrar horário de chegada e motivo informado.",
  early_departure: "Registrar saída, motivo e responsável pela retirada.",
  school_record: "Documentar uma ocorrência no histórico escolar.",
  meeting_minutes: "Formalizar uma conversa, reunião ou encaminhamento.",
  warning: "Registrar uma advertência e seu fundamento.",
};
