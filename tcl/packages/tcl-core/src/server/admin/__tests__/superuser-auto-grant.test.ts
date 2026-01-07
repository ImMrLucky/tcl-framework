/**
 * Unit tests for superuser auto-grant functionality
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock supabaseAdmin
const mockSupabaseAdmin = {
  from: vi.fn(() => mockSupabaseAdmin),
  select: vi.fn(() => mockSupabaseAdmin),
  eq: vi.fn(() => mockSupabaseAdmin),
  single: vi.fn(() => mockSupabaseAdmin),
  update: vi.fn(() => mockSupabaseAdmin),
};

vi.mock('../../supabase.js', () => ({
  get supabaseAdmin() {
    return mockSupabaseAdmin;
  },
}));

vi.mock('../middleware.js', () => ({
  logAdminAction: vi.fn(() => Promise.resolve()),
}));

import { maybeGrantSuperuser } from '../superuser-auto-grant.js';

describe('Superuser Auto-Grant', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset environment
    delete process.env.NODE_ENV;
    delete process.env.ALLOW_DEV_SUPERUSER_IN_PROD;
    delete process.env.DEV_SUPERUSER_EMAILS;
    delete process.env.DEV_SUPERUSER_DOMAINS;
  });

  it('should grant superuser in non-prod when email is in allowlist', async () => {
    process.env.NODE_ENV = 'development';
    process.env.DEV_SUPERUSER_EMAILS = 'admin@protectqa.com,test@example.com';

    // Mock profile fetch - user is not superuser
    mockSupabaseAdmin.single.mockResolvedValueOnce({
      data: { id: 'user-123', role: 'USER' },
      error: null,
    });

    // Mock update
    mockSupabaseAdmin.update.mockReturnValueOnce(mockSupabaseAdmin);
    mockSupabaseAdmin.eq.mockReturnValueOnce(mockSupabaseAdmin);
    mockSupabaseAdmin.eq.mockResolvedValueOnce({ error: null });

    const result = await maybeGrantSuperuser('user-123', 'admin@protectqa.com');

    expect(result).toBe(true);
    expect(mockSupabaseAdmin.update).toHaveBeenCalledWith({ role: 'SUPERUSER' });
  });

  it('should NOT grant superuser in production when gate is false', async () => {
    process.env.NODE_ENV = 'production';
    process.env.ALLOW_DEV_SUPERUSER_IN_PROD = 'false';
    process.env.DEV_SUPERUSER_EMAILS = 'admin@protectqa.com';

    const result = await maybeGrantSuperuser('user-123', 'admin@protectqa.com');

    expect(result).toBe(false);
    expect(mockSupabaseAdmin.from).not.toHaveBeenCalled();
  });

  it('should grant superuser in production when gate is true and email matches', async () => {
    process.env.NODE_ENV = 'production';
    process.env.ALLOW_DEV_SUPERUSER_IN_PROD = 'true';
    process.env.DEV_SUPERUSER_EMAILS = 'admin@protectqa.com';

    // Mock profile fetch
    mockSupabaseAdmin.single.mockResolvedValueOnce({
      data: { id: 'user-123', role: 'USER' },
      error: null,
    });

    // Mock update
    mockSupabaseAdmin.update.mockReturnValueOnce(mockSupabaseAdmin);
    mockSupabaseAdmin.eq.mockReturnValueOnce(mockSupabaseAdmin);
    mockSupabaseAdmin.eq.mockResolvedValueOnce({ error: null });

    const result = await maybeGrantSuperuser('user-123', 'admin@protectqa.com');

    expect(result).toBe(true);
    expect(mockSupabaseAdmin.update).toHaveBeenCalledWith({ role: 'SUPERUSER' });
  });

  it('should NOT auto-demote existing superuser', async () => {
    process.env.NODE_ENV = 'development';
    process.env.DEV_SUPERUSER_EMAILS = 'admin@protectqa.com';

    // Mock profile fetch - user is already superuser
    mockSupabaseAdmin.single.mockResolvedValueOnce({
      data: { id: 'user-123', role: 'SUPERUSER' },
      error: null,
    });

    const result = await maybeGrantSuperuser('user-123', 'admin@protectqa.com');

    expect(result).toBe(false);
    expect(mockSupabaseAdmin.update).not.toHaveBeenCalled();
  });

  it('should grant superuser based on domain allowlist', async () => {
    process.env.NODE_ENV = 'development';
    process.env.DEV_SUPERUSER_DOMAINS = 'protectqa.com';

    // Mock profile fetch
    mockSupabaseAdmin.single.mockResolvedValueOnce({
      data: { id: 'user-123', role: 'USER' },
      error: null,
    });

    // Mock update
    mockSupabaseAdmin.update.mockReturnValueOnce(mockSupabaseAdmin);
    mockSupabaseAdmin.eq.mockReturnValueOnce(mockSupabaseAdmin);
    mockSupabaseAdmin.eq.mockResolvedValueOnce({ error: null });

    const result = await maybeGrantSuperuser('user-123', 'anyone@protectqa.com');

    expect(result).toBe(true);
    expect(mockSupabaseAdmin.update).toHaveBeenCalledWith({ role: 'SUPERUSER' });
  });

  it('should NOT grant superuser if email not in allowlist', async () => {
    process.env.NODE_ENV = 'development';
    process.env.DEV_SUPERUSER_EMAILS = 'admin@protectqa.com';

    const result = await maybeGrantSuperuser('user-123', 'other@example.com');

    expect(result).toBe(false);
    expect(mockSupabaseAdmin.from).not.toHaveBeenCalled();
  });

  it('should handle empty allowlists gracefully', async () => {
    process.env.NODE_ENV = 'development';
    // No DEV_SUPERUSER_EMAILS or DEV_SUPERUSER_DOMAINS set

    const result = await maybeGrantSuperuser('user-123', 'admin@protectqa.com');

    expect(result).toBe(false);
    expect(mockSupabaseAdmin.from).not.toHaveBeenCalled();
  });

  it('should handle profile fetch errors gracefully', async () => {
    process.env.NODE_ENV = 'development';
    process.env.DEV_SUPERUSER_EMAILS = 'admin@protectqa.com';

    // Mock profile fetch error
    mockSupabaseAdmin.single.mockResolvedValueOnce({
      data: null,
      error: { message: 'Profile not found' },
    });

    const result = await maybeGrantSuperuser('user-123', 'admin@protectqa.com');

    expect(result).toBe(false);
    expect(mockSupabaseAdmin.update).not.toHaveBeenCalled();
  });
});

