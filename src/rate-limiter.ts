/**
 * Simple rate limiter for API calls
 */
export class RateLimiter {
  private queue: Array<{ task: () => Promise<any>; resolve: (value: any) => void; reject: (error: any) => void }> = [];
  private processing = false;
  private lastCallTime = 0;
  private minInterval: number;

  constructor(callsPerSecond: number = 1) {
    this.minInterval = 1000 / callsPerSecond; // Convert to milliseconds between calls
  }

  /**
   * Execute a function with rate limiting
   */
  async execute<T>(task: () => Promise<T>): Promise<T> {
    return new Promise((resolve, reject) => {
      this.queue.push({ task, resolve, reject });
      this.processQueue();
    });
  }

  /**
   * Process the queue of tasks
   */
  private async processQueue(): Promise<void> {
    if (this.processing || this.queue.length === 0) {
      return;
    }

    this.processing = true;

    while (this.queue.length > 0) {
      const now = Date.now();
      const timeSinceLastCall = now - this.lastCallTime;
      
      // Wait if we need to respect the rate limit
      if (timeSinceLastCall < this.minInterval) {
        const waitTime = this.minInterval - timeSinceLastCall;
        await new Promise(resolve => setTimeout(resolve, waitTime));
      }

      const { task, resolve, reject } = this.queue.shift()!;
      
      try {
        this.lastCallTime = Date.now();
        const result = await task();
        resolve(result);
      } catch (error) {
        reject(error);
      }
    }

    this.processing = false;
  }

  /**
   * Get the number of pending tasks
   */
  getPendingCount(): number {
    return this.queue.length;
  }

  /**
   * Wait for all pending tasks to complete
   */
  async waitForCompletion(): Promise<void> {
    while (this.queue.length > 0 || this.processing) {
      await new Promise(resolve => setTimeout(resolve, 50));
    }
  }
}