'use strict';

/**
 * Custom error hierarchy to ensure identical HTTP status code mapping across providers.
 */

class ProviderError extends Error {
  constructor(message, statusCode = 500) {
    super(message);
    this.name = this.constructor.name;
    this.statusCode = statusCode;
  }
}

class ValidationError extends ProviderError {
  constructor(message) {
    super(message, 400);
  }
}

class NotRegisteredError extends ProviderError {
  constructor(message = 'Number not registered on WhatsApp') {
    super(message, 404);
  }
}

class ConflictError extends ProviderError {
  constructor(message = 'An operation is already in progress for this center. Please wait a moment.') {
    super(message, 409);
  }
}

class ConnectedRefusalError extends ProviderError {
  constructor(
    message = 'Cannot regenerate QR code for an active connected session. Please disconnect first if you wish to link a new number.'
  ) {
    super(message, 400);
  }
}

class ServiceUnavailableError extends ProviderError {
  constructor(message = 'WhatsApp service is currently unavailable.') {
    super(message, 503);
  }
}

module.exports = {
  ProviderError,
  ValidationError,
  NotRegisteredError,
  ConflictError,
  ConnectedRefusalError,
  ServiceUnavailableError,
};
