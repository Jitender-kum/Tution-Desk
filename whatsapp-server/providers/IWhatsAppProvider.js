'use strict';

/**
 * @typedef {'disconnected' | 'initializing' | 'qr_ready' | 'authenticated' | 'connected'} WhatsAppSessionStatus
 *
 * @typedef {Object} NormalizedSessionState
 * @property {string} centerId
 * @property {WhatsAppSessionStatus} status
 * @property {boolean} ready
 * @property {boolean} hasSavedSession
 * @property {string|null} qr
 * @property {number|null} qrGeneratedAt
 * @property {boolean} [hasClientProcess]
 * @property {string|null} [error]
 * @property {string} [updatedAt]
 *
 * @typedef {Object} SendMessageOptions
 * @property {string} centerId
 * @property {string} phone
 * @property {string} message
 *
 * @typedef {Object} SendMessageResult
 * @property {boolean} success
 * @property {string} centerId
 * @property {string} messageId
 * @property {string} recipient
 * @property {string} timestamp
 *
 * @typedef {Object} ReconnectOptions
 * @property {'refresh' | 'new_pairing'} [action]
 * @property {boolean} [forceNewPairing]
 *
 * @typedef {Object} GlobalProviderStats
 * @property {string} engine
 * @property {number} activeSessions
 * @property {number} readySessions
 * @property {number} savedSessions
 * @property {number} uptimeSeconds
 * @property {boolean} isMongoConnected
 * @property {Object} memory
 * @property {number} memory.rssMb
 * @property {number} memory.heapUsedMb
 * @property {number} memory.heapTotalMb
 * @property {number} [memory.externalMb]
 * @property {Array<Object>} sessions
 */

/**
 * Interface contract defining the standard operations required of any WhatsApp provider.
 * Concrete providers (e.g. WWebJSProvider, BaileysProvider) must implement all methods.
 */
class IWhatsAppProvider {
  /**
   * Human-readable engine identifier
   * @returns {string}
   */
  get name() {
    throw new Error('IWhatsAppProvider.name must be implemented');
  }

  /**
   * Initialize provider dependencies, database stores, and discovery scans.
   * @returns {Promise<void>}
   */
  async init() {
    throw new Error('IWhatsAppProvider.init must be implemented');
  }

  /**
   * Retrieve normalized status for a specific center.
   * @param {string} centerId
   * @returns {Promise<NormalizedSessionState>}
   */
  async getStatus(centerId) {
    throw new Error('IWhatsAppProvider.getStatus must be implemented');
  }

  /**
   * Retrieve global runtime statistics and session summaries.
   * @returns {Promise<GlobalProviderStats>}
   */
  async getGlobalStats() {
    throw new Error('IWhatsAppProvider.getGlobalStats must be implemented');
  }

  /**
   * Initialize or resume a WhatsApp session for a specific center.
   * @param {string} centerId
   * @returns {Promise<NormalizedSessionState>}
   */
  async initializeSession(centerId) {
    throw new Error('IWhatsAppProvider.initializeSession must be implemented');
  }

  /**
   * Reconnect an unlinked session or trigger a fresh pairing flow.
   * @param {string} centerId
   * @param {ReconnectOptions} [options]
   * @returns {Promise<NormalizedSessionState>}
   */
  async reconnectSession(centerId, options) {
    throw new Error('IWhatsAppProvider.reconnectSession must be implemented');
  }

  /**
   * Send an outbound text message for a center.
   * @param {SendMessageOptions} options
   * @returns {Promise<SendMessageResult>}
   */
  async sendMessage(options) {
    throw new Error('IWhatsAppProvider.sendMessage must be implemented');
  }

  /**
   * Explicitly logout and clear all stored credentials for a center.
   * @param {string} centerId
   * @returns {Promise<{ success: boolean, message: string }>}
   */
  async logoutSession(centerId) {
    throw new Error('IWhatsAppProvider.logoutSession must be implemented');
  }

  /**
   * Graceful shutdown of all active clients and database connections.
   * @returns {Promise<void>}
   */
  async shutdown() {
    throw new Error('IWhatsAppProvider.shutdown must be implemented');
  }
}

module.exports = IWhatsAppProvider;
