// ============================================================
// Async Task Dispatcher - Concurrent Queue with Retry
// ============================================================

export interface DispatcherTask<T = void> {
  id: string;
  label: string;
  execute: () => Promise<T>;
}

export interface TaskStatus<T = void> {
  id: string;
  label: string;
  status: 'pending' | 'running' | 'success' | 'failed';
  retryCount: number;
  error?: string;
  result?: T;
}

export interface DispatcherOptions<T = void> {
  /** 最大并发数 */
  concurrency: number;
  /** 最大重试次数 */
  maxRetries: number;
  /** 请求间隔 (ms)，用于 Rate Limiting */
  delayBetweenTasks: number;
  /** 单任务超时 (ms) */
  taskTimeout: number;
  /** 任务状态变更回调 */
  onStatusChange?: (statuses: TaskStatus<T>[]) => void;
}

const DEFAULT_OPTIONS: DispatcherOptions<unknown> = {
  concurrency: 2,
  maxRetries: 3,
  delayBetweenTasks: 1000,
  taskTimeout: 120000, // 2 minutes
};

/**
 * 异步任务并发调度器。
 * 支持并发上限、Rate Limiting、超时重试、单任务重跑。
 */
export class TaskDispatcher<T = void> {
  private options: DispatcherOptions<T>;
  private statuses: Map<string, TaskStatus<T>> = new Map();
  private tasks: Map<string, DispatcherTask<T>> = new Map();
  private running = 0;
  private queue: string[] = [];
  private resolveAll?: () => void;

  constructor(options?: Partial<DispatcherOptions<T>>) {
    this.options = { ...DEFAULT_OPTIONS, ...options };
  }

  /** 获取所有任务状态 */
  getStatuses(): TaskStatus<T>[] {
    return Array.from(this.statuses.values());
  }

  /** 添加任务到队列 */
  addTask(task: DispatcherTask<T>): void {
    this.tasks.set(task.id, task);
    this.statuses.set(task.id, {
      id: task.id,
      label: task.label,
      status: 'pending',
      retryCount: 0,
    });
    this.queue.push(task.id);
  }

  /** 执行所有任务 */
  async runAll(): Promise<TaskStatus<T>[]> {
    return new Promise((resolve) => {
      this.resolveAll = () => resolve(this.getStatuses());
      this.processQueue();
    });
  }

  /** 重新运行单个失败/已完成的任务 */
  async rerunTask(taskId: string): Promise<TaskStatus<T> | undefined> {
    const task = this.tasks.get(taskId);
    if (!task) return undefined;

    this.statuses.set(taskId, {
      id: taskId,
      label: task.label,
      status: 'pending',
      retryCount: 0,
    });
    this.notifyStatusChange();

    return this.executeTask(taskId);
  }

  private async processQueue(): Promise<void> {
    while (this.queue.length > 0 && this.running < this.options.concurrency) {
      const taskId = this.queue.shift();
      if (!taskId) break;

      this.running++;

      // Rate limiting delay
      if (this.options.delayBetweenTasks > 0) {
        await sleep(this.options.delayBetweenTasks);
      }

      this.executeTask(taskId).then(() => {
        this.running--;
        this.processQueue();
      });
    }

    // All done?
    if (this.running === 0 && this.queue.length === 0) {
      this.resolveAll?.();
    }
  }

  private async executeTask(
    taskId: string,
  ): Promise<TaskStatus<T> | undefined> {
    const task = this.tasks.get(taskId);
    const status = this.statuses.get(taskId);
    if (!task || !status) return undefined;

    status.status = 'running';
    this.notifyStatusChange();

    try {
      const result = await withTimeout(
        task.execute(),
        this.options.taskTimeout,
      );
      status.status = 'success';
      status.result = result;
      status.error = undefined;
    } catch (err) {
      status.retryCount++;
      const errMsg = err instanceof Error ? err.message : String(err);

      if (status.retryCount < this.options.maxRetries) {
        // Retry
        console.warn(
          `Task "${task.label}" failed (attempt ${status.retryCount}), retrying...`,
          errMsg,
        );
        status.status = 'pending';
        this.notifyStatusChange();

        await sleep(2000 * status.retryCount); // Exponential-ish backoff
        return this.executeTask(taskId);
      } else {
        status.status = 'failed';
        status.error = errMsg;
      }
    }

    this.notifyStatusChange();
    return status;
  }

  private notifyStatusChange(): void {
    this.options.onStatusChange?.(this.getStatuses());
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`Task timed out after ${ms}ms`)),
      ms,
    );
    promise
      .then((val) => {
        clearTimeout(timer);
        resolve(val);
      })
      .catch((err) => {
        clearTimeout(timer);
        reject(err);
      });
  });
}
