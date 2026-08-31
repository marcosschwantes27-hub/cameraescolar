import {
  collection,
  doc,
  getDoc,
  getDocs,
  setDoc,
  updateDoc,
  query,
  where,
  limit,
} from "firebase/firestore";
import { db } from "../firebase/config";
import type {
  CreateOccurrenceInput,
  Occurrence,
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
import { fixtureStudents, fixtureOccurrences, fixtureClassrooms } from "./fixtures";
import {
  extractEmbeddingFromBlob,
  processEnrollmentFrames,
  matchLiveFramesAgainstEnrolledStudents,
} from "../lib/faceEngine";

function normalize(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("pt-BR")
    .trim();
}

export class FirebaseSchoolOperations implements SchoolOperations {
  private initialized = false;
  private initializingPromise: Promise<void> | null = null;

  private async ensureInitialized(): Promise<void> {
    if (this.initialized) return;
    if (this.initializingPromise) return this.initializingPromise;

    this.initializingPromise = (async () => {
      try {
        // Ensure all default classrooms exist in Firestore
        for (const c of fixtureClassrooms) {
          await setDoc(doc(db, "classrooms", c.id), c, { merge: true });
        }

        const studentsSnap = await getDocs(collection(db, "students"));
        if (studentsSnap.empty) {
          // Seed fixture students with sample perceptual embeddings
          for (const student of fixtureStudents) {
            const seedEmbeddings: number[][] = [];
            // Generate a deterministic initial feature vector based on student ID for fixture testing
            const seedVector = new Array(128).fill(0).map((_, i) => {
              const charCode = (student.name.charCodeAt(i % student.name.length) || 65) + i * 3;
              return Math.sin(charCode) * 0.1;
            });
            const norm = Math.sqrt(seedVector.reduce((a, b) => a + b * b, 0)) || 1;
            const normalizedSeed = seedVector.map((v) => Number((v / norm).toFixed(6)));
            seedEmbeddings.push(normalizedSeed);

            await setDoc(doc(db, "students", student.id), {
              ...student,
              faceTemplates: student.faceEnrollmentStatus === "enrolled"
                ? seedEmbeddings.map((vector) => ({ vector }))
                : [],
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
            });
          }

          for (const occurrence of fixtureOccurrences) {
            await setDoc(doc(db, "occurrences", occurrence.id), occurrence);
          }
        }
        this.initialized = true;
      } catch (err) {
        console.warn("Firestore initialization notice (operating with available records):", err);
        this.initialized = true;
      }
    })();

    return this.initializingPromise;
  }

  async listClassrooms(signal?: AbortSignal): Promise<Classroom[]> {
    if (signal?.aborted) throw new DOMException("Operação cancelada", "AbortError");
    try {
      this.ensureInitialized();
      const snap = await getDocs(collection(db, "classrooms"));
      if (!snap.empty) {
        const dbClassrooms = snap.docs.map((d) => d.data() as Classroom);
        const map = new Map<string, Classroom>();
        fixtureClassrooms.forEach((c) => map.set(c.id, c));
        dbClassrooms.forEach((c) => map.set(c.id, c));
        return Array.from(map.values());
      }
    } catch {
      // Return guaranteed fixture classrooms
    }
    return fixtureClassrooms;
  }

  async searchStudents(searchQuery: string, signal?: AbortSignal): Promise<Student[]> {
    if (signal?.aborted) throw new DOMException("Operação cancelada", "AbortError");
    await this.ensureInitialized();
    try {
      const snap = await getDocs(collection(db, "students"));
      const allStudents: Student[] = snap.docs.map((d) => {
        const data = d.data();
        return {
          id: data.id || d.id,
          schoolId: data.schoolId || "school-demo",
          name: data.name || "",
          preferredName: data.preferredName || null,
          enrollmentCode: data.enrollmentCode || "",
          classroom: data.classroom || "",
          shift: data.shift || "Manhã",
          status: data.status || "active",
          initials: data.initials || data.name?.slice(0, 2).toUpperCase() || "AL",
          faceEnrollmentStatus: data.faceEnrollmentStatus || "not_enrolled",
        };
      });

      const normalizedQuery = normalize(searchQuery);
      if (!normalizedQuery) {
        return allStudents.slice(0, 8);
      }

      const queryTerms = normalizedQuery.split(/\s+/).filter(Boolean);
      return allStudents.filter((student) => {
        const haystack = normalize(
          `${student.name} ${student.preferredName ?? ""} ${student.enrollmentCode} ${student.classroom}`
        );
        return queryTerms.every((term) => haystack.includes(term));
      });
    } catch (err) {
      console.error("Error searching students in Firestore:", err);
      return [];
    }
  }

  async getStudentHistory(studentId: string, signal?: AbortSignal): Promise<Occurrence[]> {
    if (signal?.aborted) throw new DOMException("Operação cancelada", "AbortError");
    await this.ensureInitialized();
    try {
      const q = query(
        collection(db, "occurrences"),
        where("studentId", "==", studentId)
      );
      const snap = await getDocs(q);
      const occurrences = snap.docs.map((d) => d.data() as Occurrence);
      return occurrences.sort((a, b) => (b.occurredAt || "").localeCompare(a.occurredAt || ""));
    } catch (err) {
      console.error("Error fetching student history:", err);
      return [];
    }
  }

  async createOccurrence(
    input: CreateOccurrenceInput,
    signal?: AbortSignal
  ): Promise<Occurrence> {
    if (signal?.aborted) throw new DOMException("Operação cancelada", "AbortError");
    await this.ensureInitialized();

    if (!input.reason.trim()) {
      throw new Error("O motivo é obrigatório.");
    }

    const studentDoc = await getDoc(doc(db, "students", input.studentId));
    if (!studentDoc.exists()) {
      throw new Error("Aluno não encontrado.");
    }
    const studentData = studentDoc.data() as Student;

    const occurrenceId = `OCO-${new Date().getFullYear()}-${Date.now().toString().slice(-4)}`;
    const occurrence: Occurrence = {
      id: occurrenceId,
      schoolId: studentData.schoolId || "school-demo",
      studentId: input.studentId,
      type: input.type,
      reason: input.reason.trim(),
      description: input.description?.trim() || null,
      responsibleName: input.responsibleName?.trim() || null,
      participants: input.participants?.trim() || null,
      attachment: input.attachment ?? null,
      occurredAt: input.occurredAt,
      createdAt: new Date().toISOString(),
      createdBy: { id: "user-marina", name: "Marina Souza" },
      identificationSource: input.identificationSource,
      status: "active",
    };

    await setDoc(doc(db, "occurrences", occurrenceId), occurrence);
    return occurrence;
  }

  private async assertEnrollmentCodeAvailable(enrollmentCode: string): Promise<void> {
    const q = query(collection(db, "students"), where("enrollmentCode", "==", enrollmentCode.trim()), limit(1));
    const snap = await getDocs(q);
    if (!snap.empty) {
      throw new Error("Já existe um aluno com essa matrícula nesta escola.");
    }
  }

  private buildStudentData(
    input: CreateStudentInput,
    classroom: Classroom,
    faceEnrollmentStatus: Student["faceEnrollmentStatus"]
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

    const studentId = `student-${Date.now()}`;
    return {
      id: studentId,
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

  async createStudent(input: CreateStudentInput, signal?: AbortSignal): Promise<Student> {
    if (signal?.aborted) throw new DOMException("Operação cancelada", "AbortError");
    await this.ensureInitialized();
    const classrooms = await this.listClassrooms(signal);
    const classroom = classrooms.find((c) => c.id === input.classroomId) || classrooms[0];
    if (!classroom) throw new Error("Turma não encontrada.");

    await this.assertEnrollmentCodeAvailable(input.enrollmentCode);

    const student = this.buildStudentData(input, classroom, "not_enrolled");
    await setDoc(doc(db, "students", student.id), {
      ...student,
      faceTemplates: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    return student;
  }

  async createStudentWithFaceEnrollment(
    input: CreateStudentFaceEnrollmentInput,
    signal?: AbortSignal
  ): Promise<FaceEnrollmentResult> {
    if (signal?.aborted) throw new DOMException("Operação cancelada", "AbortError");
    await this.ensureInitialized();
    const classrooms = await this.listClassrooms(signal);
    const classroom = classrooms.find((c) => c.id === input.classroomId) || classrooms[0];
    if (!classroom) throw new Error("Turma não encontrada.");

    await this.assertEnrollmentCodeAvailable(input.enrollmentCode);

    const { embeddings, acceptedCount } = await processEnrollmentFrames(input.frames);

    const student = this.buildStudentData(input, classroom, embeddings.length > 0 ? "enrolled" : "review_needed");
    await setDoc(doc(db, "students", student.id), {
      ...student,
      faceTemplates: embeddings.map((vector) => ({ vector })),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    return {
      student,
      framesReceived: input.frames.length,
      framesAccepted: acceptedCount,
      modelVersion: "firebase-face-biometrics-v1",
    };
  }

  async enrollFace(
    studentId: string,
    frames: FaceCaptureFrame[],
    signal?: AbortSignal
  ): Promise<FaceEnrollmentResult> {
    if (signal?.aborted) throw new DOMException("Operação cancelada", "AbortError");
    await this.ensureInitialized();
    const studentRef = doc(db, "students", studentId);
    const snap = await getDoc(studentRef);
    if (!snap.exists()) {
      throw new Error("Aluno não encontrado no banco de dados.");
    }

    const { embeddings, acceptedCount } = await processEnrollmentFrames(frames);

    const updatedStatus: Student["faceEnrollmentStatus"] = embeddings.length > 0 ? "enrolled" : "review_needed";

    await updateDoc(studentRef, {
      faceEnrollmentStatus: updatedStatus,
      faceTemplates: embeddings.map((vector) => ({ vector })),
      updatedAt: new Date().toISOString(),
    });

    const updatedStudentData: Student = {
      ...(snap.data() as Student),
      faceEnrollmentStatus: updatedStatus,
    };

    return {
      student: updatedStudentData,
      framesReceived: frames.length,
      framesAccepted: acceptedCount,
      modelVersion: "firebase-face-biometrics-v1",
    };
  }

  async identifyFace(
    frames: Blob[],
    signal?: AbortSignal
  ): Promise<FaceRecognitionResult> {
    if (signal?.aborted) throw new DOMException("Operação cancelada", "AbortError");
    await this.ensureInitialized();

    // 1. Extract embeddings for all incoming live burst frames
    const liveEmbeddings: number[][] = [];
    for (const frame of frames) {
      try {
        const emb = await extractEmbeddingFromBlob(frame);
        if (emb && emb.length > 0) {
          liveEmbeddings.push(emb);
        }
      } catch (err) {
        console.warn("Erro ao extrair características faciais do frame:", err);
      }
    }

    if (liveEmbeddings.length === 0) {
      return {
        matched: false,
        student: null,
        similarity: null,
        framesAnalyzed: frames.length,
        agreeingFrames: 0,
        message: "Nenhum rosto válido detectado nas imagens capturadas.",
      };
    }

    // 2. Fetch all enrolled students from Firestore with face templates
    const studentsSnap = await getDocs(collection(db, "students"));
    const enrolledCandidates: Array<{ student: Student; embeddings: number[][] }> = [];

    studentsSnap.forEach((d) => {
      const data = d.data();
      const templates: number[][] = [];

      if (Array.isArray(data.faceTemplates)) {
        for (const item of data.faceTemplates) {
          if (item && Array.isArray(item.vector) && item.vector.length > 0) {
            templates.push(item.vector);
          }
        }
      } else if (Array.isArray(data.faceEmbeddings)) {
        for (const item of data.faceEmbeddings) {
          if (item && Array.isArray(item.vector)) {
            templates.push(item.vector);
          } else if (Array.isArray(item)) {
            templates.push(item);
          }
        }
      }

      if (templates.length > 0) {
        const student: Student = {
          id: data.id || d.id,
          schoolId: data.schoolId || "school-demo",
          name: data.name || "",
          preferredName: data.preferredName || null,
          enrollmentCode: data.enrollmentCode || "",
          classroom: data.classroom || "",
          shift: data.shift || "Manhã",
          status: data.status || "active",
          initials: data.initials || data.name?.slice(0, 2).toUpperCase() || "AL",
          faceEnrollmentStatus: data.faceEnrollmentStatus || "enrolled",
        };
        enrolledCandidates.push({
          student,
          embeddings: templates,
        });
      }
    });

    if (enrolledCandidates.length === 0) {
      return {
        matched: false,
        student: null,
        similarity: null,
        framesAnalyzed: frames.length,
        agreeingFrames: 0,
        message: "Nenhum aluno com biometria cadastrada no sistema.",
      };
    }

    // 3. Match live embeddings against candidates
    const match = matchLiveFramesAgainstEnrolledStudents(
      liveEmbeddings,
      enrolledCandidates.map((c) => ({ id: c.student.id, embeddings: c.embeddings })),
      0.68
    );

    if (match) {
      const matchedCandidate = enrolledCandidates.find((c) => c.student.id === match.studentId);
      if (matchedCandidate) {
        const similarityPct = Math.min(99.4, Math.round(match.avgSimilarity * 1000) / 10);
        return {
          matched: true,
          student: matchedCandidate.student,
          similarity: similarityPct,
          framesAnalyzed: frames.length,
          agreeingFrames: match.agreeingFrames,
          message: `Aluno identificado (${similarityPct}% de confiança)`,
        };
      }
    }

    return {
      matched: false,
      student: null,
      similarity: null,
      framesAnalyzed: frames.length,
      agreeingFrames: 0,
      message: "Rosto não reconhecido entre os alunos matriculados.",
    };
  }
}
