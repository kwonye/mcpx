import type { SelectedOption } from "./server-mapper";

export interface PendingAdd {
  name: string;
  option: SelectedOption;
}

/**
 * RegistryAddManager - Manages pending add operations for registry servers
 *
 * This class handles the two-phase add process (prepare + confirm) by
 * storing the selected option between calls. This replaces the module-level
 * state that was previously used.
 */
export class RegistryAddManager {
  private pendingAdd: PendingAdd | null = null;

  /**
   * Store a pending add operation
   */
  prepareAdd(name: string, option: SelectedOption): void {
    this.pendingAdd = { name, option };
  }

  /**
   * Get the current pending add operation
   */
  getPendingAdd(): PendingAdd | null {
    return this.pendingAdd;
  }

  /**
   * Confirm and consume the pending add operation
   * Returns the pending add and clears it from storage
   */
  confirmAdd(): PendingAdd {
    if (!this.pendingAdd) {
      throw new Error("No pending add operation");
    }
    const result = this.pendingAdd;
    this.pendingAdd = null;
    return result;
  }

  /**
   * Clear any pending add operation without confirming
   */
  clearPendingAdd(): void {
    this.pendingAdd = null;
  }
}

// Global singleton instance
export const registryAddManager = new RegistryAddManager();
