import { describe, expect, it } from "vitest";
import type { EnrollmentPose, FaceCaptureFrame } from "../domain/face";
import { FixtureSchoolOperations } from "./fixtureSchoolOperations";

const fixedNow = () => new Date("2026-08-18T15:00:00.000Z");
const guidedPoses: EnrollmentPose[] = ["front", "left", "right", "up", "down"];

function guidedFrames(): FaceCaptureFrame[] {
  return guidedPoses.flatMap((pose) => Array.from({ length: 3 }, () => ({
    image: new Blob([pose], { type: "image/jpeg" }),
    pose,
  })));
}

describe("FixtureSchoolOperations", () => {
  it("busca alunos ignorando acentos e caixa", async () => {
    const adapter = new FixtureSchoolOperations({ latencyMs: 0, now: fixedNow });

    const students = await adapter.searchStudents("mariana souza");

    expect(students).toHaveLength(1);
    expect(students[0]?.name).toBe("Mariana de Souza Alves");
  });

  it("cria uma ocorrência e a inclui no histórico", async () => {
    const adapter = new FixtureSchoolOperations({ latencyMs: 0, now: fixedNow });

    const created = await adapter.createOccurrence({
      studentId: "student-pedro-rocha",
      type: "warning",
      reason: "Descumprimento de combinado",
      description: "Orientação realizada pela coordenação.",
      occurredAt: "2026-08-18T14:55:00.000Z",
      identificationSource: "manual",
    });
    const history = await adapter.getStudentHistory("student-pedro-rocha");

    expect(created.id).toBe("OCO-2026-0201");
    expect(created.createdAt).toBe("2026-08-18T15:00:00.000Z");
    expect(history[0]?.id).toBe(created.id);
  });

  it("rejeita uma ocorrência sem motivo", async () => {
    const adapter = new FixtureSchoolOperations({ latencyMs: 0, now: fixedNow });

    await expect(
      adapter.createOccurrence({
        studentId: "student-ana-clara",
        type: "late_arrival",
        reason: "   ",
        occurredAt: "2026-08-18T14:55:00.000Z",
        identificationSource: "manual",
      }),
    ).rejects.toThrow("O motivo é obrigatório.");
  });

  it("cria aluno e biometria juntos sem duplicar a matrícula", async () => {
    const adapter = new FixtureSchoolOperations({ latencyMs: 0, now: fixedNow });
    const input = {
      name: "Aluno de teste atômico",
      enrollmentCode: "2026-atomic",
      classroomId: "8º ano B-Manhã",
      frames: guidedFrames(),
    };

    const enrollment = await adapter.createStudentWithFaceEnrollment(input);

    expect(enrollment.student.faceEnrollmentStatus).toBe("enrolled");
    expect(enrollment.framesReceived).toBe(15);
    expect(enrollment.framesAccepted).toBe(10);
    await expect(adapter.createStudentWithFaceEnrollment(input)).rejects.toThrow(
      "Já existe um aluno com essa matrícula nesta escola",
    );
    expect(await adapter.searchStudents("2026-atomic")).toHaveLength(1);
  });

  it("não cria o aluno quando o conjunto guiado é inválido", async () => {
    const adapter = new FixtureSchoolOperations({ latencyMs: 0, now: fixedNow });

    await expect(adapter.createStudentWithFaceEnrollment({
      name: "Aluno sem captura completa",
      enrollmentCode: "2026-incomplete",
      classroomId: "8º ano B-Manhã",
      frames: guidedFrames().slice(0, 14),
    })).rejects.toThrow("Capture três imagens em cada uma das cinco posições.");
    expect(await adapter.searchStudents("2026-incomplete")).toHaveLength(0);
  });

  it("mantém o recadastro existente e retém duas imagens por posição", async () => {
    const adapter = new FixtureSchoolOperations({ latencyMs: 0, now: fixedNow });

    const enrollment = await adapter.enrollFace("student-ana-clara", guidedFrames());

    expect(enrollment.student.faceEnrollmentStatus).toBe("enrolled");
    expect(enrollment.framesReceived).toBe(15);
    expect(enrollment.framesAccepted).toBe(10);
  });
});
