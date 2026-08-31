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

export interface SchoolOperations {
  searchStudents(query: string, signal?: AbortSignal): Promise<Student[]>;
  getStudentHistory(studentId: string, signal?: AbortSignal): Promise<Occurrence[]>;
  createOccurrence(
    input: CreateOccurrenceInput,
    signal?: AbortSignal,
  ): Promise<Occurrence>;
  listClassrooms(signal?: AbortSignal): Promise<Classroom[]>;
  createStudent(input: CreateStudentInput, signal?: AbortSignal): Promise<Student>;
  createStudentWithFaceEnrollment(
    input: CreateStudentFaceEnrollmentInput,
    signal?: AbortSignal,
  ): Promise<FaceEnrollmentResult>;
  enrollFace(
    studentId: string,
    frames: FaceCaptureFrame[],
    signal?: AbortSignal,
  ): Promise<FaceEnrollmentResult>;
  identifyFace(frames: Blob[], signal?: AbortSignal): Promise<FaceRecognitionResult>;
}

import { FirebaseSchoolOperations } from "./firebaseSchoolOperations";

export const schoolOperations: SchoolOperations = new FirebaseSchoolOperations();

