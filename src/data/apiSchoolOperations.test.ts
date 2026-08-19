import { afterEach, describe, expect, it, vi } from "vitest";
import type { EnrollmentPose, FaceCaptureFrame } from "../domain/face";
import { ApiSchoolOperations } from "./apiSchoolOperations";

const guidedPoses: EnrollmentPose[] = ["front", "left", "right", "up", "down"];

function guidedFrames(): FaceCaptureFrame[] {
  return guidedPoses.flatMap((pose) => Array.from({ length: 3 }, () => ({
    image: new Blob([pose], { type: "image/jpeg" }),
    pose,
  })));
}

const enrollmentResponse = {
  student: {
    id: "student-atomic",
    schoolId: "school-demo",
    name: "Aluno Atômico",
    preferredName: "Atômico",
    enrollmentCode: "2026-atomic",
    classroom: "8º ano B",
    shift: "Manhã",
    status: "active",
    initials: "AA",
    faceEnrollmentStatus: "enrolled",
  },
  framesReceived: 15,
  framesAccepted: 10,
  modelVersion: "sface-test",
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("ApiSchoolOperations", () => {
  it("envia aluno, quinze frames e poses no cadastro facial atômico", async () => {
    const fetchMock = vi.fn<typeof fetch>();
    fetchMock.mockResolvedValue(new Response(
      JSON.stringify(enrollmentResponse),
      { status: 201, headers: { "Content-Type": "application/json" } },
    ));
    vi.stubGlobal("fetch", fetchMock);
    const adapter = new ApiSchoolOperations("http://api.test");

    const enrollment = await adapter.createStudentWithFaceEnrollment({
      name: "Aluno Atômico",
      preferredName: "Atômico",
      enrollmentCode: "2026-atomic",
      classroomId: "classroom-8b",
      frames: guidedFrames(),
    });

    expect(enrollment.framesAccepted).toBe(10);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(url).toBe("http://api.test/api/v1/student-face-enrollments");
    expect(init?.method).toBe("POST");
    expect(init?.headers).toBeUndefined();
    if (!(init?.body instanceof FormData)) throw new Error("FormData não enviado.");
    expect(init.body.get("name")).toBe("Aluno Atômico");
    expect(init.body.get("preferredName")).toBe("Atômico");
    expect(init.body.get("enrollmentCode")).toBe("2026-atomic");
    expect(init.body.get("classroomId")).toBe("classroom-8b");
    expect(init.body.getAll("frames")).toHaveLength(15);
    expect(init.body.getAll("poses")).toEqual(guidedPoses.flatMap((pose) => [pose, pose, pose]));
  });

  it("preserva o detail textual de um conflito 409", async () => {
    const detail = "Já existe um aluno com essa matrícula nesta escola";
    const fetchMock = vi.fn<typeof fetch>();
    fetchMock.mockResolvedValue(new Response(
      JSON.stringify({ detail }),
      { status: 409, headers: { "Content-Type": "application/json" } },
    ));
    vi.stubGlobal("fetch", fetchMock);
    const adapter = new ApiSchoolOperations("http://api.test");

    await expect(adapter.createStudentWithFaceEnrollment({
      name: "Aluno Duplicado",
      enrollmentCode: "2026-duplicate",
      classroomId: "classroom-8b",
      frames: guidedFrames(),
    })).rejects.toThrow(detail);
  });
});
