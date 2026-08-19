import type {
  CreateOccurrenceInput,
  Occurrence,
  Student,
} from "../domain/school";
import type {
  Classroom,
  CreateStudentFaceEnrollmentInput,
  CreateStudentInput,
  EnrollmentPose,
  FaceCaptureFrame,
  FaceEnrollmentResult,
  FaceRecognitionResult,
} from "../domain/face";
import { fixtureOccurrences, fixtureStudents } from "./fixtures";
import type { SchoolOperations } from "./schoolOperations";

interface FixtureAdapterOptions {
  latencyMs?: number;
  now?: () => Date;
}

function abortError() {
  return new DOMException("Operação cancelada", "AbortError");
}

async function waitForFixtureLatency(ms: number, signal?: AbortSignal) {
  if (signal?.aborted) throw abortError();
  if (ms === 0) return;

  await new Promise<void>((resolve, reject) => {
    const timer = window.setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        window.clearTimeout(timer);
        reject(abortError());
      },
      { once: true },
    );
  });
}

function normalize(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("pt-BR")
    .trim();
}

const guidedEnrollmentPoses: EnrollmentPose[] = ["front", "left", "right", "up", "down"];

function acceptedGuidedFrameCount(frames: FaceCaptureFrame[]) {
  const counts = new Map<EnrollmentPose, number>();
  frames.forEach((frame) => {
    if (frame.pose) counts.set(frame.pose, (counts.get(frame.pose) ?? 0) + 1);
  });
  if (
    frames.length !== 15
    || guidedEnrollmentPoses.some((pose) => counts.get(pose) !== 3)
  ) {
    throw new Error("Capture três imagens em cada uma das cinco posições.");
  }
  return guidedEnrollmentPoses.length * 2;
}

export class FixtureSchoolOperations implements SchoolOperations {
  private readonly latencyMs: number;
  private readonly now: () => Date;
  private readonly students: Student[];
  private readonly occurrences: Occurrence[];
  private sequence = 200;

  constructor(options: FixtureAdapterOptions = {}) {
    this.latencyMs = options.latencyMs ?? 240;
    this.now = options.now ?? (() => new Date());
    this.students = structuredClone(fixtureStudents);
    this.occurrences = structuredClone(fixtureOccurrences);
  }

  private assertEnrollmentCodeAvailable(enrollmentCode: string) {
    const normalizedCode = enrollmentCode.trim();
    if (this.students.some((student) => student.enrollmentCode === normalizedCode)) {
      throw new Error("Já existe um aluno com essa matrícula nesta escola");
    }
  }

  private buildStudent(
    input: CreateStudentInput,
    classroom: Classroom,
    faceEnrollmentStatus: Student["faceEnrollmentStatus"],
  ): Student {
    const name = input.name.trim();
    const preferredName = input.preferredName?.trim() || null;
    const enrollmentCode = input.enrollmentCode.trim();
    const initials = name
      .split(/\s+/)
      .filter(Boolean)
      .map((part) => part[0])
      .slice(0, 2)
      .join("")
      .toUpperCase();
    return {
      id: `student-${this.students.length + 1}`,
      schoolId: "school-demo",
      name,
      preferredName,
      enrollmentCode,
      classroom: classroom.name,
      shift: classroom.shift,
      status: "active",
      initials,
      faceEnrollmentStatus,
    };
  }

  async searchStudents(query: string, signal?: AbortSignal) {
    await waitForFixtureLatency(this.latencyMs, signal);
    const normalizedQuery = normalize(query);

    if (!normalizedQuery) return this.students.slice(0, 4);

    const queryTerms = normalizedQuery.split(/\s+/).filter(Boolean);

    return this.students.filter((student) => {
      const haystack = normalize(
        `${student.name} ${student.preferredName ?? ""} ${student.enrollmentCode} ${student.classroom}`,
      );
      return queryTerms.every((term) => haystack.includes(term));
    });
  }

  async getStudentHistory(studentId: string, signal?: AbortSignal) {
    await waitForFixtureLatency(this.latencyMs, signal);
    return this.occurrences
      .filter((occurrence) => occurrence.studentId === studentId)
      .sort((left, right) => right.occurredAt.localeCompare(left.occurredAt));
  }

  async createOccurrence(
    input: CreateOccurrenceInput,
    signal?: AbortSignal,
  ) {
    await waitForFixtureLatency(this.latencyMs, signal);

    if (!input.reason.trim()) {
      throw new Error("O motivo é obrigatório.");
    }

    const student = this.students.find((item) => item.id === input.studentId);
    if (!student) throw new Error("Aluno não encontrado.");

    this.sequence += 1;
    const createdAt = this.now().toISOString();
    const occurrence: Occurrence = {
      id: `OCO-2026-${String(this.sequence).padStart(4, "0")}`,
      schoolId: student.schoolId,
      studentId: student.id,
      type: input.type,
      reason: input.reason.trim(),
      description: input.description?.trim() || null,
      responsibleName: input.responsibleName?.trim() || null,
      participants: input.participants?.trim() || null,
      attachment: input.attachment ?? null,
      occurredAt: input.occurredAt,
      createdAt,
      createdBy: { id: "user-marina", name: "Marina Souza" },
      identificationSource: input.identificationSource,
      status: "active",
    };

    this.occurrences.push(occurrence);
    return structuredClone(occurrence);
  }

  async listClassrooms(signal?: AbortSignal): Promise<Classroom[]> {
    await waitForFixtureLatency(this.latencyMs, signal);
    const identities = new Map<string, Classroom>();
    this.students.forEach((student) => {
      const id = `${student.classroom}-${student.shift}`;
      identities.set(id, {
        id,
        name: student.classroom,
        academicYear: 2026,
        shift: student.shift,
      });
    });
    return [...identities.values()];
  }

  async createStudent(input: CreateStudentInput, signal?: AbortSignal): Promise<Student> {
    await waitForFixtureLatency(this.latencyMs, signal);
    const classrooms = await this.listClassrooms(signal);
    const classroom = classrooms.find((item) => item.id === input.classroomId);
    if (!classroom) throw new Error("Turma não encontrada.");
    this.assertEnrollmentCodeAvailable(input.enrollmentCode);
    const student = this.buildStudent(input, classroom, "not_enrolled");
    this.students.push(student);
    return structuredClone(student);
  }

  async createStudentWithFaceEnrollment(
    input: CreateStudentFaceEnrollmentInput,
    signal?: AbortSignal,
  ): Promise<FaceEnrollmentResult> {
    await waitForFixtureLatency(this.latencyMs, signal);
    const framesAccepted = acceptedGuidedFrameCount(input.frames);
    const classrooms = await this.listClassrooms(signal);
    const classroom = classrooms.find((item) => item.id === input.classroomId);
    if (!classroom) throw new Error("Turma não encontrada.");
    this.assertEnrollmentCodeAvailable(input.enrollmentCode);
    const student = this.buildStudent(input, classroom, "enrolled");
    this.students.push(student);
    return {
      student: structuredClone(student),
      framesReceived: input.frames.length,
      framesAccepted,
      modelVersion: "fixture",
    };
  }

  async enrollFace(
    studentId: string,
    frames: FaceCaptureFrame[],
    signal?: AbortSignal,
  ): Promise<FaceEnrollmentResult> {
    await waitForFixtureLatency(this.latencyMs, signal);
    const framesAccepted = frames.some((frame) => frame.pose !== null)
      ? acceptedGuidedFrameCount(frames)
      : frames.length;
    const student = this.students.find((item) => item.id === studentId);
    if (!student) throw new Error("Aluno não encontrado.");
    student.faceEnrollmentStatus = "enrolled";
    return {
      student: structuredClone(student),
      framesReceived: frames.length,
      framesAccepted,
      modelVersion: "fixture",
    };
  }

  async identifyFace(
    frames: Blob[],
    signal?: AbortSignal,
  ): Promise<FaceRecognitionResult> {
    await waitForFixtureLatency(this.latencyMs, signal);
    const student = this.students.find((item) => item.faceEnrollmentStatus === "enrolled") ?? null;
    return {
      matched: student !== null,
      student: student ? structuredClone(student) : null,
      similarity: student ? 92.4 : null,
      framesAnalyzed: frames.length,
      agreeingFrames: student ? frames.length : 0,
      message: student ? "Aluno identificado" : "Rosto não reconhecido",
    };
  }
}

export const schoolOperations: SchoolOperations = new FixtureSchoolOperations();
