import type {
  CreateOccurrenceInput,
  Occurrence,
  OccurrenceAttachment,
  Student,
} from "../domain/school";
import type {
  Classroom,
  CreateStudentFaceEnrollmentInput,
  CreateStudentInput,
  FaceCaptureFrame,
  FaceEnrollmentResult,
  FaceRecognitionResult,
} from "../domain/face";
import type { SchoolOperations } from "./schoolOperations";

type JsonRecord = Record<string, unknown>;

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requiredString(record: JsonRecord, key: string): string {
  const value = record[key];
  if (typeof value !== "string") throw new Error("A API retornou dados inválidos.");
  return value;
}

function optionalString(record: JsonRecord, key: string): string | null {
  const value = record[key];
  if (value === null) return null;
  if (typeof value !== "string") throw new Error("A API retornou dados inválidos.");
  return value;
}

function requiredNumber(record: JsonRecord, key: string): number {
  const value = record[key];
  if (typeof value !== "number") throw new Error("A API retornou dados inválidos.");
  return value;
}

function requiredBoolean(record: JsonRecord, key: string): boolean {
  const value = record[key];
  if (typeof value !== "boolean") throw new Error("A API retornou dados inválidos.");
  return value;
}

function parseStudent(value: unknown): Student {
  if (!isRecord(value)) throw new Error("A API retornou um aluno inválido.");
  const shift = requiredString(value, "shift");
  const status = requiredString(value, "status");
  const faceStatus = requiredString(value, "faceEnrollmentStatus");
  if (!["Manhã", "Tarde", "Noite"].includes(shift)) throw new Error("Turno inválido.");
  if (!["active", "inactive"].includes(status)) throw new Error("Status inválido.");
  if (!["not_enrolled", "enrolled", "review_needed"].includes(faceStatus)) {
    throw new Error("Status facial inválido.");
  }
  return {
    id: requiredString(value, "id"),
    schoolId: requiredString(value, "schoolId"),
    name: requiredString(value, "name"),
    preferredName: optionalString(value, "preferredName"),
    enrollmentCode: requiredString(value, "enrollmentCode"),
    classroom: requiredString(value, "classroom"),
    shift: shift as Student["shift"],
    status: status as Student["status"],
    initials: requiredString(value, "initials"),
    faceEnrollmentStatus: faceStatus as Student["faceEnrollmentStatus"],
  };
}

function parseAttachment(value: unknown): OccurrenceAttachment | null {
  if (value === null) return null;
  if (!isRecord(value) || typeof value.size !== "number") {
    throw new Error("A API retornou um anexo inválido.");
  }
  return {
    name: requiredString(value, "name"),
    size: value.size,
    mediaType: requiredString(value, "mediaType"),
  };
}

function parseOccurrence(value: unknown): Occurrence {
  if (!isRecord(value) || !isRecord(value.createdBy)) {
    throw new Error("A API retornou uma ocorrência inválida.");
  }
  const type = requiredString(value, "type");
  const source = requiredString(value, "identificationSource");
  const status = requiredString(value, "status");
  if (!["late_arrival", "early_departure", "school_record", "meeting_minutes", "warning"].includes(type)) {
    throw new Error("Tipo de ocorrência inválido.");
  }
  if (!["manual", "facial"].includes(source) || !["active", "cancelled"].includes(status)) {
    throw new Error("Estado de ocorrência inválido.");
  }
  return {
    id: requiredString(value, "id"),
    schoolId: requiredString(value, "schoolId"),
    studentId: requiredString(value, "studentId"),
    type: type as Occurrence["type"],
    reason: requiredString(value, "reason"),
    description: optionalString(value, "description"),
    responsibleName: optionalString(value, "responsibleName"),
    participants: optionalString(value, "participants"),
    attachment: parseAttachment(value.attachment),
    occurredAt: requiredString(value, "occurredAt"),
    createdAt: requiredString(value, "createdAt"),
    createdBy: {
      id: requiredString(value.createdBy, "id"),
      name: requiredString(value.createdBy, "name"),
    },
    identificationSource: source as Occurrence["identificationSource"],
    status: status as Occurrence["status"],
  };
}

function parseClassroom(value: unknown): Classroom {
  if (!isRecord(value)) throw new Error("A API retornou uma turma inválida.");
  const shift = requiredString(value, "shift");
  if (!["Manhã", "Tarde", "Noite"].includes(shift)) throw new Error("Turno inválido.");
  return {
    id: requiredString(value, "id"),
    name: requiredString(value, "name"),
    academicYear: requiredNumber(value, "academicYear"),
    shift: shift as Classroom["shift"],
  };
}

function parseEnrollment(value: unknown): FaceEnrollmentResult {
  if (!isRecord(value)) throw new Error("A API retornou um cadastro facial inválido.");
  return {
    student: parseStudent(value.student),
    framesReceived: requiredNumber(value, "framesReceived"),
    framesAccepted: requiredNumber(value, "framesAccepted"),
    modelVersion: requiredString(value, "modelVersion"),
  };
}

function parseRecognition(value: unknown): FaceRecognitionResult {
  if (!isRecord(value)) throw new Error("A API retornou uma identificação inválida.");
  const student = value.student === null ? null : parseStudent(value.student);
  const similarity = value.similarity;
  if (similarity !== null && typeof similarity !== "number") {
    throw new Error("A API retornou uma similaridade inválida.");
  }
  return {
    matched: requiredBoolean(value, "matched"),
    student,
    similarity,
    framesAnalyzed: requiredNumber(value, "framesAnalyzed"),
    agreeingFrames: requiredNumber(value, "agreeingFrames"),
    message: requiredString(value, "message"),
  };
}

function appendFaceFrames(form: FormData, frames: FaceCaptureFrame[]) {
  frames.forEach((frame, index) => {
    form.append("frames", frame.image, `frame-${index + 1}.jpg`);
    if (frame.pose) form.append("poses", frame.pose);
  });
}

async function errorMessage(response: Response) {
  const fallback = `A API respondeu com o código ${response.status}.`;
  try {
    const body: unknown = await response.json();
    return isRecord(body) && typeof body.detail === "string" ? body.detail : fallback;
  } catch {
    return fallback;
  }
}

export class ApiSchoolOperations implements SchoolOperations {
  constructor(private readonly baseUrl = import.meta.env.VITE_API_BASE_URL ?? "http://127.0.0.1:8000") {}

  private async request(path: string, init: RequestInit, signal?: AbortSignal): Promise<unknown> {
    const response = await fetch(`${this.baseUrl}${path}`, { ...init, signal });
    if (!response.ok) throw new Error(await errorMessage(response));
    return response.json() as Promise<unknown>;
  }

  async searchStudents(query: string, signal?: AbortSignal): Promise<Student[]> {
    const params = new URLSearchParams({ q: query });
    const body = await this.request(`/api/v1/students?${params}`, { method: "GET" }, signal);
    if (!Array.isArray(body)) throw new Error("A API retornou uma lista de alunos inválida.");
    return body.map(parseStudent);
  }

  async getStudentHistory(studentId: string, signal?: AbortSignal): Promise<Occurrence[]> {
    const body = await this.request(
      `/api/v1/students/${encodeURIComponent(studentId)}/occurrences`,
      { method: "GET" },
      signal,
    );
    if (!Array.isArray(body)) throw new Error("A API retornou um histórico inválido.");
    return body.map(parseOccurrence);
  }

  async createOccurrence(
    input: CreateOccurrenceInput,
    signal?: AbortSignal,
  ): Promise<Occurrence> {
    if (input.attachment) {
      throw new Error("O envio de anexos será habilitado na próxima etapa.");
    }
    const body = await this.request(
      `/api/v1/students/${encodeURIComponent(input.studentId)}/occurrences`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: input.type,
          reason: input.reason,
          description: input.description || null,
          responsibleName: input.responsibleName || null,
          participants: input.participants || null,
          occurredAt: input.occurredAt,
          identificationSource: input.identificationSource,
        }),
      },
      signal,
    );
    return parseOccurrence(body);
  }

  async listClassrooms(signal?: AbortSignal): Promise<Classroom[]> {
    const body = await this.request("/api/v1/classrooms", { method: "GET" }, signal);
    if (!Array.isArray(body)) throw new Error("A API retornou uma lista de turmas inválida.");
    return body.map(parseClassroom);
  }

  async createStudent(
    input: CreateStudentInput,
    signal?: AbortSignal,
  ): Promise<Student> {
    const body = await this.request(
      "/api/v1/students",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      },
      signal,
    );
    return parseStudent(body);
  }

  async createStudentWithFaceEnrollment(
    input: CreateStudentFaceEnrollmentInput,
    signal?: AbortSignal,
  ): Promise<FaceEnrollmentResult> {
    const form = new FormData();
    form.append("name", input.name);
    if (input.preferredName) form.append("preferredName", input.preferredName);
    form.append("enrollmentCode", input.enrollmentCode);
    form.append("classroomId", input.classroomId);
    appendFaceFrames(form, input.frames);
    const body = await this.request(
      "/api/v1/student-face-enrollments",
      { method: "POST", body: form },
      signal,
    );
    return parseEnrollment(body);
  }

  async enrollFace(
    studentId: string,
    frames: FaceCaptureFrame[],
    signal?: AbortSignal,
  ): Promise<FaceEnrollmentResult> {
    const form = new FormData();
    appendFaceFrames(form, frames);
    const body = await this.request(
      `/api/v1/students/${encodeURIComponent(studentId)}/face-enrollment`,
      { method: "POST", body: form },
      signal,
    );
    return parseEnrollment(body);
  }

  async identifyFace(
    frames: Blob[],
    signal?: AbortSignal,
  ): Promise<FaceRecognitionResult> {
    const form = new FormData();
    frames.forEach((frame, index) => form.append("frames", frame, `frame-${index + 1}.jpg`));
    const body = await this.request(
      "/api/v1/recognition/identify",
      { method: "POST", body: form },
      signal,
    );
    return parseRecognition(body);
  }
}

export const schoolOperations: SchoolOperations = new ApiSchoolOperations();
