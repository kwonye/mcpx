/**
 * DaemonStateManager - Centralized daemon state management
 *
 * Provides a single source of truth for daemon running state
 * with subscription-based updates for listeners.
 */

export class DaemonStateManager {
  private running = false;
  private listeners: Set<(running: boolean) => void> = new Set();

  /**
   * Set the daemon running state and notify all listeners
   */
  setRunning(running: boolean): void {
    this.running = running;
    this.listeners.forEach((cb) => cb(running));
  }

  /**
   * Get the current daemon running state
   */
  getRunning(): boolean {
    return this.running;
  }

  /**
   * Subscribe to daemon state changes
   * @returns Unsubscribe function
   */
  subscribe(callback: (running: boolean) => void): () => void {
    this.listeners.add(callback);
    return () => {
      this.listeners.delete(callback);
    };
  }
}

// Global singleton instance
export const daemonState = new DaemonStateManager();
