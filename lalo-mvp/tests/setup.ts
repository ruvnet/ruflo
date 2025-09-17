import { config } from 'dotenv';

// Load test environment variables
config({ path: '.env.test' });

// Set test defaults
process.env.NODE_ENV = 'test';
process.env.DB_MEMORY = 'true';
process.env.OPENAI_API_KEY = process.env.OPENAI_API_KEY || 'test-key';

// Mock console methods for cleaner test output
const originalConsoleLog = console.log;
const originalConsoleError = console.error;
const originalConsoleWarn = console.warn;

beforeAll(() => {
  // Only show console output if VERBOSE_TESTS is set
  if (!process.env.VERBOSE_TESTS) {
    console.log = jest.fn();
    console.error = jest.fn();
    console.warn = jest.fn();
  }
});

afterAll(() => {
  // Restore console methods
  console.log = originalConsoleLog;
  console.error = originalConsoleError;
  console.warn = originalConsoleWarn;
});

// Global test timeout
jest.setTimeout(30000);