"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.RateLimiter = void 0;
/**
 * Simple rate limiter for API calls
 */
class RateLimiter {
    constructor(callsPerSecond = 1) {
        this.queue = [];
        this.processing = false;
        this.lastCallTime = 0;
        this.minInterval = 1000 / callsPerSecond; // Convert to milliseconds between calls
    }
    /**
     * Execute a function with rate limiting
     */
    async execute(task) {
        return new Promise((resolve, reject) => {
            this.queue.push({ task, resolve, reject });
            this.processQueue();
        });
    }
    /**
     * Process the queue of tasks
     */
    async processQueue() {
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
            const { task, resolve, reject } = this.queue.shift();
            try {
                this.lastCallTime = Date.now();
                const result = await task();
                resolve(result);
            }
            catch (error) {
                reject(error);
            }
        }
        this.processing = false;
    }
    /**
     * Get the number of pending tasks
     */
    getPendingCount() {
        return this.queue.length;
    }
    /**
     * Wait for all pending tasks to complete
     */
    async waitForCompletion() {
        while (this.queue.length > 0 || this.processing) {
            await new Promise(resolve => setTimeout(resolve, 50));
        }
    }
}
exports.RateLimiter = RateLimiter;
