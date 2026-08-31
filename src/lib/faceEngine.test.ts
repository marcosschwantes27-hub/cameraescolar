import { describe, expect, it } from "vitest";
import {
  cosineSimilarity,
  matchLiveFramesAgainstEnrolledStudents,
} from "./faceEngine";

describe("faceEngine", () => {
  it("computes cosine similarity accurately between identical and orthogonal vectors", () => {
    const vecA = [1, 0, 0, 0];
    const vecB = [1, 0, 0, 0];
    const vecC = [0, 1, 0, 0];

    expect(cosineSimilarity(vecA, vecB)).toBeCloseTo(1.0, 4);
    expect(cosineSimilarity(vecA, vecC)).toBeCloseTo(0.0, 4);
  });

  it("identifies matching student when live frames match enrolled embeddings", () => {
    const student1Emb = [
      [0.8, 0.6, 0.1, 0.2],
      [0.82, 0.58, 0.1, 0.19],
    ];
    const student2Emb = [
      [-0.5, 0.2, 0.7, 0.1],
      [-0.48, 0.22, 0.68, 0.12],
    ];

    const liveFrames = [
      [0.79, 0.61, 0.09, 0.2],
      [0.81, 0.59, 0.11, 0.18],
    ];

    const candidates = [
      { id: "student-1", embeddings: student1Emb },
      { id: "student-2", embeddings: student2Emb },
    ];

    const match = matchLiveFramesAgainstEnrolledStudents(liveFrames, candidates, 0.8);
    expect(match).not.toBeNull();
    expect(match?.studentId).toBe("student-1");
    expect(match?.agreeingFrames).toBe(2);
  });

  it("returns null when no enrolled student meets similarity threshold", () => {
    const candidates = [
      {
        id: "student-1",
        embeddings: [[0, 0, 1, 0]],
      },
    ];

    const liveFrames = [[1, 0, 0, 0]];
    const match = matchLiveFramesAgainstEnrolledStudents(liveFrames, candidates, 0.7);
    expect(match).toBeNull();
  });
});
