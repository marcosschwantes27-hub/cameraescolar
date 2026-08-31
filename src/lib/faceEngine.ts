import type { FaceCaptureFrame } from "../domain/face";

function blobToCanvas(blob: Blob): Promise<HTMLCanvasElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      const canvas = document.createElement("canvas");
      canvas.width = img.width || 640;
      canvas.height = img.height || 480;
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        reject(new Error("Erro ao criar contexto 2D"));
        return;
      }
      ctx.drawImage(img, 0, 0);
      resolve(canvas);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Erro ao decodificar imagem"));
    };
    img.src = url;
  });
}

/**
 * Extracts a normalized 128-dimensional perceptual gradient vector from canvas
 */
function extractPerceptualDescriptor(canvas: HTMLCanvasElement): number[] {
  const normCanvas = document.createElement("canvas");
  normCanvas.width = 64;
  normCanvas.height = 64;
  const ctx = normCanvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return new Array(128).fill(0);

  // Focus on center 75% where the face is framed
  const srcW = canvas.width;
  const srcH = canvas.height;
  const cropX = srcW * 0.125;
  const cropY = srcH * 0.125;
  const cropW = srcW * 0.75;
  const cropH = srcH * 0.75;

  ctx.drawImage(canvas, cropX, cropY, cropW, cropH, 0, 0, 64, 64);
  const imgData = ctx.getImageData(0, 0, 64, 64);
  const data = imgData.data;

  // Grayscale matrix
  const gray = new Float32Array(64 * 64);
  for (let i = 0; i < 64 * 64; i++) {
    const r = data[i * 4];
    const g = data[i * 4 + 1];
    const b = data[i * 4 + 2];
    gray[i] = 0.299 * r + 0.587 * g + 0.114 * b;
  }

  // 8x8 grid -> 64 cells. For each cell, compute horizontal gradient, vertical gradient and mean
  const descriptor = new Float32Array(128);
  const cellSize = 8;

  for (let cy = 0; cy < 8; cy++) {
    for (let cx = 0; cx < 8; cx++) {
      let gradXSum = 0;
      let gradYSum = 0;
      let meanSum = 0;
      let count = 0;

      for (let y = cy * cellSize + 1; y < (cy + 1) * cellSize - 1; y++) {
        for (let x = cx * cellSize + 1; x < (cx + 1) * cellSize - 1; x++) {
          const idx = y * 64 + x;
          const gx = gray[idx + 1] - gray[idx - 1];
          const gy = gray[idx + 64] - gray[idx - 64];
          gradXSum += Math.abs(gx);
          gradYSum += Math.abs(gy);
          meanSum += gray[idx];
          count++;
        }
      }

      const cellIdx = cy * 8 + cx;
      const avgGx = count > 0 ? gradXSum / count : 0;
      const avgGy = count > 0 ? gradYSum / count : 0;
      const avgMean = count > 0 ? meanSum / count : 0;

      descriptor[cellIdx] = Math.sqrt(avgGx * avgGx + avgGy * avgGy);
      descriptor[cellIdx + 64] = avgMean;
    }
  }

  // Normalize L2
  let sumSq = 0;
  for (let i = 0; i < 128; i++) {
    sumSq += descriptor[i] * descriptor[i];
  }
  const norm = Math.sqrt(sumSq) || 1;
  const result: number[] = new Array(128);
  for (let i = 0; i < 128; i++) {
    result[i] = Number((descriptor[i] / norm).toFixed(6));
  }
  return result;
}

export async function extractEmbeddingFromBlob(blob: Blob): Promise<number[]> {
  try {
    const canvas = await blobToCanvas(blob);
    return extractPerceptualDescriptor(canvas);
  } catch (err) {
    console.warn("Aviso ao extrair características visuais:", err);
    return new Array(128).fill(0);
  }
}

export function cosineSimilarity(vecA: number[], vecB: number[]): number {
  if (vecA.length !== vecB.length || vecA.length === 0) return 0;
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < vecA.length; i++) {
    dot += vecA[i] * vecB[i];
    normA += vecA[i] * vecA[i];
    normB += vecB[i] * vecB[i];
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

export async function processEnrollmentFrames(
  frames: FaceCaptureFrame[]
): Promise<{ embeddings: number[][]; acceptedCount: number }> {
  const embeddings: number[][] = [];
  for (const frame of frames) {
    try {
      const emb = await extractEmbeddingFromBlob(frame.image);
      if (emb && emb.length > 0) {
        embeddings.push(emb);
      }
    } catch (err) {
      console.warn("Erro ao processar frame para biometria:", err);
    }
  }

  return {
    embeddings,
    acceptedCount: embeddings.length,
  };
}

export interface MatchScore {
  studentId: string;
  maxSimilarity: number;
  avgSimilarity: number;
  agreeingFrames: number;
}

export function matchLiveFramesAgainstEnrolledStudents(
  liveEmbeddings: number[][],
  enrolledStudentsData: Array<{ id: string; embeddings: number[][] }>,
  similarityThreshold = 0.70
): MatchScore | null {
  if (liveEmbeddings.length === 0 || enrolledStudentsData.length === 0) {
    return null;
  }

  let bestMatch: MatchScore | null = null;

  for (const student of enrolledStudentsData) {
    if (!student.embeddings || student.embeddings.length === 0) continue;

    let totalSimilarity = 0;
    let maxSim = 0;
    let agreeing = 0;

    for (const liveEmb of liveEmbeddings) {
      let bestFrameSim = 0;
      for (const refEmb of student.embeddings) {
        const sim = cosineSimilarity(liveEmb, refEmb);
        if (sim > bestFrameSim) {
          bestFrameSim = sim;
        }
      }

      totalSimilarity += bestFrameSim;
      if (bestFrameSim > maxSim) {
        maxSim = bestFrameSim;
      }
      if (bestFrameSim >= similarityThreshold) {
        agreeing++;
      }
    }

    const avgSim = totalSimilarity / liveEmbeddings.length;

    if (maxSim >= similarityThreshold && agreeing >= Math.ceil(liveEmbeddings.length * 0.4)) {
      if (!bestMatch || avgSim > bestMatch.avgSimilarity) {
        bestMatch = {
          studentId: student.id,
          maxSimilarity: maxSim,
          avgSimilarity: avgSim,
          agreeingFrames: agreeing,
        };
      }
    }
  }

  return bestMatch;
}

