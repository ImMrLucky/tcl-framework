/**
 * Concurrency Limiter for ASR Transcription
 * Prevents CPU meltdown by limiting concurrent transcription jobs
 */

export interface TranscriptionSlot {
  release: () => void;
}

class TranscriptionLimiter {
  private maxConcurrent: number;
  private current: number = 0;
  private queue: Array<() => void> = [];

  constructor(maxConcurrent: number = 1) {
    this.maxConcurrent = maxConcurrent;
  }

  /**
   * Acquire a transcription slot
   * Returns a promise that resolves when a slot is available
   * Rejects with ASR_BUSY error if limit is reached
   */
  async acquire(): Promise<TranscriptionSlot> {
    return new Promise((resolve, reject) => {
      if (this.current < this.maxConcurrent) {
        this.current++;
        resolve({
          release: () => {
            this.current--;
            if (this.queue.length > 0) {
              const next = this.queue.shift();
              if (next) next();
            }
          },
        });
      } else {
        // Queue the request
        this.queue.push(() => {
          if (this.current < this.maxConcurrent) {
            this.current++;
            resolve({
              release: () => {
                this.current--;
                if (this.queue.length > 0) {
                  const next = this.queue.shift();
                  if (next) next();
                }
              },
            });
          } else {
            reject(new Error('ASR_BUSY'));
          }
        });
      }
    });
  }

  /**
   * Execute a function with a transcription slot
   */
  async withSlot<T>(fn: () => Promise<T>): Promise<T> {
    const slot = await this.acquire();
    try {
      return await fn();
    } finally {
      slot.release();
    }
  }

  getCurrentCount(): number {
    return this.current;
  }

  getQueueLength(): number {
    return this.queue.length;
  }
}

// Singleton instance
const limiter = new TranscriptionLimiter(
  parseInt(process.env.ASR_MAX_CONCURRENCY || '1', 10)
);

/**
 * Execute a function with a transcription slot
 * Throws error with code 'ASR_BUSY' if all slots are occupied
 */
export async function withTranscriptionSlot<T>(
  fn: () => Promise<T>
): Promise<T> {
  try {
    return await limiter.withSlot(fn);
  } catch (error: any) {
    if (error.message === 'ASR_BUSY') {
      const busyError = new Error('Transcription worker is busy. Try again.') as any;
      busyError.code = 'ASR_BUSY';
      busyError.statusCode = 429;
      throw busyError;
    }
    throw error;
  }
}

