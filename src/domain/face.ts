import type { Student } from "./school";

export interface Classroom {
  id: string;
  name: string;
  academicYear: number;
  shift: Student["shift"];
}

export interface CreateStudentInput {
  name: string;
  preferredName?: string;
  enrollmentCode: string;
  classroomId: string;
}

export type EnrollmentPose = "front" | "left" | "right" | "up" | "down";

export interface FaceCaptureFrame {
  image: Blob;
  pose: EnrollmentPose | null;
}

export interface CreateStudentFaceEnrollmentInput extends CreateStudentInput {
  frames: FaceCaptureFrame[];
}

export interface FaceEnrollmentResult {
  student: Student;
  framesReceived: number;
  framesAccepted: number;
  modelVersion: string;
}

export interface FaceRecognitionResult {
  matched: boolean;
  student: Student | null;
  similarity: number | null;
  framesAnalyzed: number;
  agreeingFrames: number;
  message: string;
}
