/**
 * Unit tests for plan configuration validation
 */

import { describe, it, expect } from 'vitest';
import { validatePlanConfig, loadPlanConfig } from '../plan-config.js';
import { Capability } from '../../server/plans/capabilities.js';

describe('Plan Configuration Validation', () => {
  describe('validatePlanConfig', () => {
    it('should accept valid configuration', () => {
      const validConfig = {
        plans: {
          SANDBOX: {
            capabilities: ['ANALYZE_MANUAL_UPLOAD', 'GRAPH_VIEW'],
            limits: {
              analysesPerDay: 10,
              apiCallsPerDay: 3,
              uploadsPerDay: 10,
              maxFilesPerAnalysis: 3,
              maxBytesPerFile: 20971520,
            },
          },
          TEAM: {
            capabilities: ['ANALYZE_MANUAL_UPLOAD', 'API_ACCESS_PROD'],
            limits: {
              analysesPerDay: 500,
              apiCallsPerDay: 5000,
              uploadsPerDay: 500,
              maxFilesPerAnalysis: 10,
              maxBytesPerFile: 104857600,
            },
          },
          ENTERPRISE: {
            capabilities: ['ANALYZE_MANUAL_UPLOAD', 'CLOUD_CONNECTORS'],
            limits: {
              analysesPerDay: -1,
              apiCallsPerDay: -1,
              uploadsPerDay: -1,
              maxFilesPerAnalysis: -1,
              maxBytesPerFile: -1,
            },
          },
        },
      };

      expect(() => validatePlanConfig(validConfig)).not.toThrow();
    });

    it('should reject missing plans object', () => {
      const invalidConfig = {};

      expect(() => validatePlanConfig(invalidConfig)).toThrow(
        'Plan configuration must have a "plans" object'
      );
    });

    it('should reject missing tier', () => {
      const invalidConfig = {
        plans: {
          SANDBOX: {
            capabilities: ['ANALYZE_MANUAL_UPLOAD'],
            limits: {
              analysesPerDay: 10,
              apiCallsPerDay: 3,
              uploadsPerDay: 10,
              maxFilesPerAnalysis: 3,
              maxBytesPerFile: 20971520,
            },
          },
          // Missing TEAM and ENTERPRISE
        },
      };

      expect(() => validatePlanConfig(invalidConfig)).toThrow(
        'Missing plan configuration for tier'
      );
    });

    it('should reject invalid tier', () => {
      const invalidConfig = {
        plans: {
          SANDBOX: {
            capabilities: ['ANALYZE_MANUAL_UPLOAD'],
            limits: {
              analysesPerDay: 10,
              apiCallsPerDay: 3,
              uploadsPerDay: 10,
              maxFilesPerAnalysis: 3,
              maxBytesPerFile: 20971520,
            },
          },
          TEAM: {
            capabilities: ['ANALYZE_MANUAL_UPLOAD'],
            limits: {
              analysesPerDay: 500,
              apiCallsPerDay: 5000,
              uploadsPerDay: 500,
              maxFilesPerAnalysis: 10,
              maxBytesPerFile: 104857600,
            },
          },
          ENTERPRISE: {
            capabilities: ['ANALYZE_MANUAL_UPLOAD'],
            limits: {
              analysesPerDay: -1,
              apiCallsPerDay: -1,
              uploadsPerDay: -1,
              maxFilesPerAnalysis: -1,
              maxBytesPerFile: -1,
            },
          },
          INVALID_TIER: {
            capabilities: ['ANALYZE_MANUAL_UPLOAD'],
            limits: {
              analysesPerDay: 10,
              apiCallsPerDay: 3,
              uploadsPerDay: 10,
              maxFilesPerAnalysis: 3,
              maxBytesPerFile: 20971520,
            },
          },
        },
      };

      expect(() => validatePlanConfig(invalidConfig)).toThrow(
        'Invalid plan tiers found'
      );
    });

    it('should reject non-array capabilities', () => {
      const invalidConfig = {
        plans: {
          SANDBOX: {
            capabilities: 'not-an-array',
            limits: {
              analysesPerDay: 10,
              apiCallsPerDay: 3,
              uploadsPerDay: 10,
              maxFilesPerAnalysis: 3,
              maxBytesPerFile: 20971520,
            },
          },
          TEAM: {
            capabilities: ['ANALYZE_MANUAL_UPLOAD'],
            limits: {
              analysesPerDay: 500,
              apiCallsPerDay: 5000,
              uploadsPerDay: 500,
              maxFilesPerAnalysis: 10,
              maxBytesPerFile: 104857600,
            },
          },
          ENTERPRISE: {
            capabilities: ['ANALYZE_MANUAL_UPLOAD'],
            limits: {
              analysesPerDay: -1,
              apiCallsPerDay: -1,
              uploadsPerDay: -1,
              maxFilesPerAnalysis: -1,
              maxBytesPerFile: -1,
            },
          },
        },
      };

      expect(() => validatePlanConfig(invalidConfig)).toThrow(
        'capabilities must be an array'
      );
    });

    it('should reject invalid capability', () => {
      const invalidConfig = {
        plans: {
          SANDBOX: {
            capabilities: ['INVALID_CAPABILITY'],
            limits: {
              analysesPerDay: 10,
              apiCallsPerDay: 3,
              uploadsPerDay: 10,
              maxFilesPerAnalysis: 3,
              maxBytesPerFile: 20971520,
            },
          },
          TEAM: {
            capabilities: ['ANALYZE_MANUAL_UPLOAD'],
            limits: {
              analysesPerDay: 500,
              apiCallsPerDay: 5000,
              uploadsPerDay: 500,
              maxFilesPerAnalysis: 10,
              maxBytesPerFile: 104857600,
            },
          },
          ENTERPRISE: {
            capabilities: ['ANALYZE_MANUAL_UPLOAD'],
            limits: {
              analysesPerDay: -1,
              apiCallsPerDay: -1,
              uploadsPerDay: -1,
              maxFilesPerAnalysis: -1,
              maxBytesPerFile: -1,
            },
          },
        },
      };

      expect(() => validatePlanConfig(invalidConfig)).toThrow(
        'invalid capability'
      );
    });

    it('should reject missing limits object', () => {
      const invalidConfig = {
        plans: {
          SANDBOX: {
            capabilities: ['ANALYZE_MANUAL_UPLOAD'],
            // Missing limits
          },
          TEAM: {
            capabilities: ['ANALYZE_MANUAL_UPLOAD'],
            limits: {
              analysesPerDay: 500,
              apiCallsPerDay: 5000,
              uploadsPerDay: 500,
              maxFilesPerAnalysis: 10,
              maxBytesPerFile: 104857600,
            },
          },
          ENTERPRISE: {
            capabilities: ['ANALYZE_MANUAL_UPLOAD'],
            limits: {
              analysesPerDay: -1,
              apiCallsPerDay: -1,
              uploadsPerDay: -1,
              maxFilesPerAnalysis: -1,
              maxBytesPerFile: -1,
            },
          },
        },
      };

      expect(() => validatePlanConfig(invalidConfig)).toThrow(
        'limits must be an object'
      );
    });

    it('should reject missing limit field', () => {
      const invalidConfig = {
        plans: {
          SANDBOX: {
            capabilities: ['ANALYZE_MANUAL_UPLOAD'],
            limits: {
              analysesPerDay: 10,
              apiCallsPerDay: 3,
              uploadsPerDay: 10,
              maxFilesPerAnalysis: 3,
              // Missing maxBytesPerFile
            },
          },
          TEAM: {
            capabilities: ['ANALYZE_MANUAL_UPLOAD'],
            limits: {
              analysesPerDay: 500,
              apiCallsPerDay: 5000,
              uploadsPerDay: 500,
              maxFilesPerAnalysis: 10,
              maxBytesPerFile: 104857600,
            },
          },
          ENTERPRISE: {
            capabilities: ['ANALYZE_MANUAL_UPLOAD'],
            limits: {
              analysesPerDay: -1,
              apiCallsPerDay: -1,
              uploadsPerDay: -1,
              maxFilesPerAnalysis: -1,
              maxBytesPerFile: -1,
            },
          },
        },
      };

      expect(() => validatePlanConfig(invalidConfig)).toThrow(
        'missing limit field'
      );
    });

    it('should reject negative limit (except -1)', () => {
      const invalidConfig = {
        plans: {
          SANDBOX: {
            capabilities: ['ANALYZE_MANUAL_UPLOAD'],
            limits: {
              analysesPerDay: -5, // Invalid: negative but not -1
              apiCallsPerDay: 3,
              uploadsPerDay: 10,
              maxFilesPerAnalysis: 3,
              maxBytesPerFile: 20971520,
            },
          },
          TEAM: {
            capabilities: ['ANALYZE_MANUAL_UPLOAD'],
            limits: {
              analysesPerDay: 500,
              apiCallsPerDay: 5000,
              uploadsPerDay: 500,
              maxFilesPerAnalysis: 10,
              maxBytesPerFile: 104857600,
            },
          },
          ENTERPRISE: {
            capabilities: ['ANALYZE_MANUAL_UPLOAD'],
            limits: {
              analysesPerDay: -1,
              apiCallsPerDay: -1,
              uploadsPerDay: -1,
              maxFilesPerAnalysis: -1,
              maxBytesPerFile: -1,
            },
          },
        },
      };

      expect(() => validatePlanConfig(invalidConfig)).toThrow(
        'must be -1 (unlimited) or >= 0'
      );
    });

    it('should accept -1 as unlimited', () => {
      const validConfig = {
        plans: {
          SANDBOX: {
            capabilities: ['ANALYZE_MANUAL_UPLOAD'],
            limits: {
              analysesPerDay: 10,
              apiCallsPerDay: 3,
              uploadsPerDay: 10,
              maxFilesPerAnalysis: 3,
              maxBytesPerFile: 20971520,
            },
          },
          TEAM: {
            capabilities: ['ANALYZE_MANUAL_UPLOAD'],
            limits: {
              analysesPerDay: 500,
              apiCallsPerDay: 5000,
              uploadsPerDay: 500,
              maxFilesPerAnalysis: 10,
              maxBytesPerFile: 104857600,
            },
          },
          ENTERPRISE: {
            capabilities: ['ANALYZE_MANUAL_UPLOAD'],
            limits: {
              analysesPerDay: -1, // Unlimited
              apiCallsPerDay: -1,
              uploadsPerDay: -1,
              maxFilesPerAnalysis: -1,
              maxBytesPerFile: -1,
            },
          },
        },
      };

      expect(() => validatePlanConfig(validConfig)).not.toThrow();
    });

    it('should reject non-number limit', () => {
      const invalidConfig = {
        plans: {
          SANDBOX: {
            capabilities: ['ANALYZE_MANUAL_UPLOAD'],
            limits: {
              analysesPerDay: '10', // String instead of number
              apiCallsPerDay: 3,
              uploadsPerDay: 10,
              maxFilesPerAnalysis: 3,
              maxBytesPerFile: 20971520,
            },
          },
          TEAM: {
            capabilities: ['ANALYZE_MANUAL_UPLOAD'],
            limits: {
              analysesPerDay: 500,
              apiCallsPerDay: 5000,
              uploadsPerDay: 500,
              maxFilesPerAnalysis: 10,
              maxBytesPerFile: 104857600,
            },
          },
          ENTERPRISE: {
            capabilities: ['ANALYZE_MANUAL_UPLOAD'],
            limits: {
              analysesPerDay: -1,
              apiCallsPerDay: -1,
              uploadsPerDay: -1,
              maxFilesPerAnalysis: -1,
              maxBytesPerFile: -1,
            },
          },
        },
      };

      expect(() => validatePlanConfig(invalidConfig)).toThrow(
        'must be a number'
      );
    });
  });

  describe('loadPlanConfig', () => {
    it('should load valid configuration file', () => {
      const config = loadPlanConfig();
      
      expect(config).toBeDefined();
      expect(config.plans).toBeDefined();
      expect(config.plans.SANDBOX).toBeDefined();
      expect(config.plans.TEAM).toBeDefined();
      expect(config.plans.ENTERPRISE).toBeDefined();
      
      // Validate structure
      expect(Array.isArray(config.plans.SANDBOX.capabilities)).toBe(true);
      expect(typeof config.plans.SANDBOX.limits.analysesPerDay).toBe('number');
    });

    it('should validate loaded configuration', () => {
      const config = loadPlanConfig();
      
      // Should not throw
      expect(() => validatePlanConfig(config)).not.toThrow();
    });
  });
});

