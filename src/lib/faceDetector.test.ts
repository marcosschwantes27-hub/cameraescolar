import { describe, it, expect } from "vitest";
import {
  analyzeFaceInOval,
  checkPoseMatch,
  type FacePositionAssessment,
} from "./faceDetector";

describe("faceDetector in oval", () => {
  it("returns unpositioned assessment when video element is null or has 0 dimensions", () => {
    const mockVideo = { videoWidth: 0, videoHeight: 0 } as unknown as HTMLVideoElement;
    const result = analyzeFaceInOval(mockVideo);
    expect(result.detected).toBe(false);
    expect(result.insideOval).toBe(false);
    expect(result.message).toContain("oval");
  });

  it("verifies that checkPoseMatch only passes when student actually turns head to requested direction", () => {
    const mockLeftAssessment: FacePositionAssessment = {
      detected: true,
      insideOval: true,
      centered: true,
      appropriateDistance: true,
      lightingGood: true,
      confidence: 0.9,
      message: "Rosto alinhado no contorno",
      detectedPose: "left",
      poseConfidence: 0.85,
      horizontalAngleScore: 0.35,
      verticalAngleScore: 0.02,
    };

    // When requested pose is left and student is facing left -> MATCHES
    const leftMatch = checkPoseMatch(mockLeftAssessment, "left");
    expect(leftMatch.matches).toBe(true);
    expect(leftMatch.feedback).toContain("Giro para a esquerda");

    // When requested pose is right but student is still facing left -> DOES NOT MATCH
    const rightMatch = checkPoseMatch(mockLeftAssessment, "right");
    expect(rightMatch.matches).toBe(false);
    expect(rightMatch.feedback).toContain("Aguardando virar para direita");

    // When requested pose is front but student is turned left -> DOES NOT MATCH
    const frontMatch = checkPoseMatch(mockLeftAssessment, "front");
    expect(frontMatch.matches).toBe(false);
  });

  it("verifies tilt up and tilt down pose checks", () => {
    const mockUpAssessment: FacePositionAssessment = {
      detected: true,
      insideOval: true,
      centered: true,
      appropriateDistance: true,
      lightingGood: true,
      confidence: 0.9,
      message: "Rosto alinhado",
      detectedPose: "up",
      poseConfidence: 0.88,
      horizontalAngleScore: 0.01,
      verticalAngleScore: -0.32,
    };

    expect(checkPoseMatch(mockUpAssessment, "up").matches).toBe(true);
    expect(checkPoseMatch(mockUpAssessment, "down").matches).toBe(false);
  });
});
