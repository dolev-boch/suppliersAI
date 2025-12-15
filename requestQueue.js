// Request Queue Manager for Gemini API
// Implements serialized requests with exponential backoff and jitter

class RequestQueue {
  constructor() {
    this.queue = [];
    this.isProcessing = false;
    this.maxConcurrent = 1; // Serialize: only 1 request at a time
    this.currentRequests = 0;
    this.minDelay = 1000; // Minimum 1 second between requests
    this.lastRequestTime = 0;
  }

  /**
   * Add a request to the queue
   * @param {Function} requestFn - Async function that returns a promise
   * @returns {Promise} - Resolves with the request result
   */
  async enqueue(requestFn) {
    return new Promise((resolve, reject) => {
      this.queue.push({
        fn: requestFn,
        resolve,
        reject,
        attempt: 0,
        maxAttempts: 5,
      });

      // Start processing if not already running
      if (!this.isProcessing) {
        this.processQueue();
      }
    });
  }

  /**
   * Process the queue with serialization and throttling
   */
  async processQueue() {
    if (this.isProcessing || this.queue.length === 0) {
      return;
    }

    this.isProcessing = true;

    while (this.queue.length > 0 && this.currentRequests < this.maxConcurrent) {
      const item = this.queue.shift();
      this.currentRequests++;

      // Throttle: ensure minimum delay between requests
      const timeSinceLastRequest = Date.now() - this.lastRequestTime;
      if (timeSinceLastRequest < this.minDelay) {
        const waitTime = this.minDelay - timeSinceLastRequest;
        console.log(`⏳ Throttling: waiting ${waitTime}ms before next request`);
        await this.sleep(waitTime);
      }

      // Execute the request with retry logic
      await this.executeWithRetry(item);

      this.lastRequestTime = Date.now();
      this.currentRequests--;
    }

    this.isProcessing = false;

    // Continue processing if there are more items
    if (this.queue.length > 0) {
      this.processQueue();
    }
  }

  /**
   * Execute request with exponential backoff and jitter
   */
  async executeWithRetry(item) {
    try {
      const result = await item.fn();
      item.resolve(result);
    } catch (error) {
      item.attempt++;

      // Check if it's a rate limit error (429)
      const isRateLimitError =
        error.message?.includes('429') ||
        error.message?.includes('Rate limit') ||
        error.message?.includes('RESOURCE_EXHAUSTED');

      if (isRateLimitError && item.attempt < item.maxAttempts) {
        // Exponential backoff with jitter
        const baseDelay = Math.min(1000 * Math.pow(2, item.attempt), 16000); // Max 16 seconds
        const jitter = Math.random() * 1000; // 0-1 second random jitter
        const waitTime = baseDelay + jitter;

        console.log(
          `⚠️ Rate limit hit (attempt ${item.attempt}/${item.maxAttempts}). Retrying in ${Math.round(waitTime)}ms...`
        );

        await this.sleep(waitTime);

        // Re-queue the item for retry
        this.queue.unshift(item); // Add to front of queue for immediate retry
      } else {
        // Max attempts reached or non-retryable error
        console.error(
          `❌ Request failed after ${item.attempt} attempts:`,
          error.message
        );
        item.reject(error);
      }
    }
  }

  /**
   * Sleep utility
   */
  sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Get queue status
   */
  getStatus() {
    return {
      queueLength: this.queue.length,
      isProcessing: this.isProcessing,
      currentRequests: this.currentRequests,
    };
  }

  /**
   * Clear the queue (useful for testing)
   */
  clear() {
    this.queue = [];
    this.isProcessing = false;
    this.currentRequests = 0;
  }
}

// Create a global singleton instance
const geminiQueue = new RequestQueue();

// Export for use in other files
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { RequestQueue, geminiQueue };
}
