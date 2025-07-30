/**
 * Enhanced Rate limiter for API calls with error handling and retry logic
 */
export interface QueueItem<T> {
  id: string
  fn: () => Promise<T>
  resolve: (value: T) => void
  reject: (error: any) => void
  retryCount: number
  maxRetries: number
}

export interface EmailNotificationResult {
  success: boolean
  messageId?: string
  error?: string
  recipientEmail: string
  notificationType: string
}

export class EnhancedRateLimiter {
  private queue: Array<QueueItem<any>> = []
  private processing = false
  private lastRequestTime = 0
  private readonly minInterval: number // minimum time between requests in ms
  private readonly maxRetries: number
  private readonly retryDelay: number

  constructor(requestsPerSecond: number, maxRetries: number = 3, retryDelay: number = 5000) {
    this.minInterval = 1000 / requestsPerSecond
    this.maxRetries = maxRetries
    this.retryDelay = retryDelay
  }

  async addToQueue<T>(fn: () => Promise<T>, maxRetries: number = this.maxRetries): Promise<T> {
    return new Promise((resolve, reject) => {
      const queueItem: QueueItem<T> = {
        id: this.generateId(),
        fn,
        resolve,
        reject,
        retryCount: 0,
        maxRetries
      }
      
      this.queue.push(queueItem)
      this.processQueue()
    })
  }

  private generateId(): string {
    return Date.now().toString(36) + Math.random().toString(36).substr(2)
  }

  private async processQueue() {
    if (this.processing) return
    this.processing = true

    while (this.queue.length > 0) {
      const now = Date.now()
      const timeSinceLastRequest = now - this.lastRequestTime
      
      if (timeSinceLastRequest < this.minInterval) {
        await new Promise(resolve => 
          setTimeout(resolve, this.minInterval - timeSinceLastRequest)
        )
      }

      const task = this.queue.shift()
      if (task) {
        this.lastRequestTime = Date.now()
        await this.executeTask(task)
      }
    }

    this.processing = false
  }

  private async executeTask<T>(task: QueueItem<T>) {
    try {
      const result = await task.fn()
      task.resolve(result)
    } catch (error) {
      if (task.retryCount < task.maxRetries) {
        // Retry the task
        task.retryCount++
        console.log(`Retrying task ${task.id} (attempt ${task.retryCount}/${task.maxRetries})`)
        
        // Add delay before retry
        setTimeout(() => {
          this.queue.unshift(task)
          this.processQueue()
        }, this.retryDelay)
      } else {
        // Max retries reached, reject with error
        console.error(`Task ${task.id} failed after ${task.maxRetries} retries:`, error)
        task.reject(error)
      }
    }
  }

  getQueueLength(): number {
    return this.queue.length
  }

  isProcessing(): boolean {
    return this.processing
  }
}

// Create a singleton instance for email sending with 1 email per second, 3 retries and 5 milisecond
export const emailRateLimiter = new EnhancedRateLimiter(1, 3, 5000) 